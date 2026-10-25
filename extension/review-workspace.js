(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./annotations-core.js') : root.MSAAnnotationsCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSAReviewWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, annotations) {
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);

  const NOTE = 'msa.note.', MATCH = 'msa.match.', DECK = 'msa.deck.', SESSION = 'msa.session.';
  const text = value => typeof value === 'string' ? value : '';
  const copy = value => JSON.parse(JSON.stringify(value));
  function sourceIds(current) {
    if (!current) return [];
    const ids = current.isCombined || Array.isArray(current.sourceSessions) ?
      (current.sourceSessions || []).map(source => typeof source === 'string' ? source : source?.id) : [current.id];
    return [...new Set(ids.filter(id => typeof id === 'string' && id.trim()))];
  }
  function selection(current) {
    const ids = sourceIds(current), playerName = text(current?.playerName).trim(), gameId = text(current?.gameId);
    return gameId && playerName && ids.length ? {gameId,playerName,sourceIds:ids} : null;
  }
  function recordsForSession(current, values, options = {}) {
    const selected = selection(current);
    // annotations.list deliberately supports an empty-player wildcard. A review
    // never uses that wildcard to expose a different player's private notes.
    if (!selected) return [];
    if (typeof annotations?.list !== 'function') throw new Error(l10n('筆記模組尚未載入，請重新載入擴充功能。'));
    return annotations.list(values || {}, {...selected,includeDeleted:options.includeDeleted === true});
  }
  function exportRecords(current, values) {
    const selected = selection(current), records = {};
    if (!selected) return records;
    for (const note of recordsForSession(current,values,{includeDeleted:true})) records[NOTE + note.id] = copy(note);
    for (const [key,match] of Object.entries(values || {})) {
      if (!key.startsWith(MATCH) || !match || match.schemaVersion !== 1 || !text(match.id) || key !== MATCH + match.id ||
        match.gameId !== selected.gameId || match.playerName !== selected.playerName ||
        match.source !== 'manual' || match.identityConfirmed !== true) continue;
      records[key] = copy(match);
      const deckId = text(match.deckVersionId), deck = values?.[DECK + deckId];
      if (deckId && deck && deck.schemaVersion === 1 && deck.id === deckId) records[DECK + deckId] = copy(deck);
    }
    return records;
  }
  function turnLabel(anchor) {
    const positive = value => Number.isSafeInteger(value) && value > 0;
    if (anchor?.turnSource === 'log' && positive(anchor.turn)) return l10n('Log 校準 · T') + anchor.turn;
    if (anchor?.turnSource === 'phase-observed' && positive(anchor.turn)) return l10n('推計回合 · T') + anchor.turn;
    return (positive(anchor?.observedTurn) ? l10n('觀察 ') + anchor.observedTurn + ' · ' : '') + l10n('回合未校準');
  }
  function sourceSnapshot(current, values, snapshotId, sourceSessionId) {
    if (!text(snapshotId) || !text(sourceSessionId)) return null;
    const selected = selection(current), source = values?.[SESSION + sourceSessionId];
    if (!selected || !selected.sourceIds.includes(sourceSessionId) || !source || source.id !== sourceSessionId ||
      source.gameId !== selected.gameId || source.playerName !== selected.playerName || !Array.isArray(source.snapshots)) return null;
    const snapshot = source.snapshots.find(item => item?.id === snapshotId);
    return snapshot ? {source, snapshot} : null;
  }

  function create(options) {
    const {container,getCurrent,getValues} = options;
    if (!container?.ownerDocument || typeof getCurrent !== 'function' || typeof getValues !== 'function') {
      throw new TypeError(l10n('回顧筆記需要容器與目前資料來源。'));
    }
    const doc = container.ownerDocument, rows = new Map(), busyNotes = new Set(), acknowledged = new Map();
    let editing = null, saving = false, managing = false, priorSelection = '', returnFocus = null;
    function element(tag,content,className) {
      const node = doc.createElement(tag);
      if (content !== undefined) node.textContent = String(content);
      if (className) node.className = className;
      return node;
    }
    function button(label,action) {
      const node=element('button',label,'button subtle');node.type='button';node.dataset.action=action;return node;
    }
    function say(message,error=false) {
      localNotice.textContent=message;localNotice.hidden=!message;localNotice.classList.toggle('error',Boolean(error));
      if(typeof options.notice==='function')options.notice(message,error);
    }
    function valuesForDisplay() {
      const values={...(getValues() || {})};
      // A successful service response is already persisted. Keep it visible
      // while a caller's storage.onChanged render is still catching up.
      for(const [key,note]of acknowledged){
        const stored=values[key];
        if(stored&&(JSON.stringify(stored)===JSON.stringify(note)||Date.parse(stored.updatedAt)>Date.parse(note.updatedAt)))acknowledged.delete(key);
        else values[key]=note;
      }
      return values;
    }
    function selectionKey(current) { return JSON.stringify([current?.gameId,current?.playerName,sourceIds(current)]); }
    function dateLabel(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(root.MSAI18n?.language || 'zh-TW') : l10n('時間未知'); }
    async function send(message) {
      if(typeof root.chrome?.runtime?.sendMessage!=='function')throw new Error(l10n('本機筆記服務無法使用，請在擴充功能回顧頁操作。'));
      const result=await root.chrome.runtime.sendMessage(message);
      if(!result?.ok)throw new Error(result?.reason||result?.error||l10n('未收到操作成功的確認，請稍後再試。'));
      if(result.bookmark?.schemaVersion===1 && text(result.bookmark.id))acknowledged.set(NOTE+result.bookmark.id,copy(result.bookmark));
      return result;
    }
    function anchorExists(note,current,values) { return Boolean(sourceSnapshot(current,values,note.snapshotId,note.sourceSessionId)); }

    container.classList.add('review-workspace');
    const heading=element('div',undefined,'workspace-heading'),titles=element('div');
    const countLabel=element('p',l10n('尚無筆記'),'workspace-caption');
    titles.append(element('h2',l10n('書籤與筆記')),countLabel);
    const manageButton=button(l10n('資料與牌組管理'),'workspace-manage');
    heading.append(titles,manageButton);
    const controls=element('div',undefined,'workspace-controls'),deletedLabel=element('label');
    const showDeleted=element('input');showDeleted.type='checkbox';showDeleted.dataset.action='workspace-show-deleted';
    deletedLabel.append(showDeleted,doc.createTextNode(l10n('顯示已刪除筆記')));
    controls.append(deletedLabel,element('p',l10n('在手牌快照按「新增筆記」，可保留當時的來源錨點。'),'workspace-caption'));
    const localNotice=element('p','','workspace-notice');localNotice.hidden=true;localNotice.setAttribute('role','status');
    const list=element('div',undefined,'workspace-note-list');list.setAttribute('aria-label',l10n('本次選取來源的筆記'));
    const empty=element('p','','workspace-empty');
    container.append(heading,controls,localNotice,list,empty);

    // Keep the native dialog outside the changing list. A live storage refresh
    // or a new review selection must not rewrite an in-progress draft.
    const dialog=element('dialog',undefined,'workspace-note-dialog');
    const form=element('form'),dialogTitle=element('h2',l10n('新增筆記'));
    const dialogAnchor=element('p','','workspace-dialog-anchor'),selectionWarning=element('p','','workspace-notice error');selectionWarning.hidden=true;
    const noteLabel=element('label',l10n('筆記（最多 1,500 字）')),noteInput=element('textarea');noteInput.maxLength=1500;noteInput.rows=7;noteInput.dataset.field='review-note';noteLabel.append(noteInput);
    const tagLabel=element('label',l10n('標籤（最多 40 字）')),tagInput=element('input');tagInput.type='text';tagInput.maxLength=40;tagInput.dataset.field='review-tag';tagInput.placeholder=l10n('例如：攻擊順序、資源、待確認');tagLabel.append(tagInput);
    const dialogStatus=element('p','','workspace-dialog-status');dialogStatus.setAttribute('role','status');
    const dialogActions=element('div',undefined,'workspace-dialog-actions'),cancelButton=button(l10n('取消'),'note-cancel'),saveButton=button(l10n('儲存筆記'),'note-save');
    saveButton.type='submit';saveButton.className='button primary';dialogActions.append(cancelButton,saveButton);
    form.append(dialogTitle,dialogAnchor,selectionWarning,noteLabel,tagLabel,dialogStatus,dialogActions);dialog.append(form);doc.body.append(dialog);
    dialog.setAttribute('aria-label',l10n('編輯來源固定的對局筆記'));

    function setSaving(value) {
      saving=value;noteInput.disabled=value;tagInput.disabled=value;cancelButton.disabled=value;saveButton.disabled=value;
      form.setAttribute('aria-busy',String(value));saveButton.textContent=value?l10n('儲存中…'):l10n('儲存筆記');
    }
    function openEditor(state,trigger) {
      if(saving || dialog.open){say(l10n('請先儲存或取消目前的筆記草稿。'),true);return;}
      editing=copy(state);returnFocus=trigger || doc.activeElement;
      dialogTitle.textContent=state.noteId?l10n('編輯筆記'):l10n('新增筆記');
      dialogAnchor.textContent=l10n("{0} · {1}\n來源段落 {2}\n來源快照 {3}。編輯文字不會改變錨點。", state.playerName, turnLabel(state), state.sourceSessionId, state.snapshotId);
      noteInput.value=state.note || '';tagInput.value=state.tag || '';dialogStatus.textContent='';selectionWarning.hidden=true;
      try{dialog.showModal();noteInput.focus();}catch(error){editing=null;say(l10n('無法開啟筆記表單：')+String(error?.message||error),true);}
    }
    function closeEditor() {
      dialog.close();editing=null;dialogStatus.textContent='';
      if(returnFocus?.isConnected&&!returnFocus.disabled)returnFocus.focus({preventScroll:true});
      else if(manageButton.isConnected&&!manageButton.disabled)manageButton.focus({preventScroll:true});
      returnFocus=null;
    }
    cancelButton.addEventListener('click',()=>{if(!saving)closeEditor();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(!saving)closeEditor();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||!editing)return;
      const frozen=copy(editing),payload={note:noteInput.value,tag:tagInput.value};
      if(payload.note.length>1500||payload.tag.length>40){dialogStatus.textContent=l10n('筆記或標籤超過字數限制，請縮短後再試。');return;}
      setSaving(true);dialogStatus.textContent=l10n('正在保存至原來源記錄…');
      try{
        await send(frozen.noteId?{type:'MSA_NOTE_ACTION',action:'update',noteId:frozen.noteId,payload}:
          {type:'MSA_NOTE_ACTION',action:'create',sourceSessionId:frozen.sourceSessionId,payload:{snapshotId:frozen.snapshotId,...payload}});
        closeEditor();render();say(l10n('筆記已保存，來源快照與回合錨點保留。'));
      }catch(error){dialogStatus.textContent=l10n('未保存：')+String(error?.message||error);}
      finally{setSaving(false);}
    });

    async function changeDeleted(note,deleted) {
      if(busyNotes.has(note.id))return;
      busyNotes.add(note.id);render();
      try{await send({type:'MSA_NOTE_ACTION',action:'update',noteId:note.id,payload:{deleted}});
        say(deleted?l10n('筆記已移至已刪除；勾選「顯示已刪除筆記」可恢復。'):l10n('筆記已恢復，原來源錨點保留。'));
      }catch(error){say(String(error?.message||error),true);}
      finally{busyNotes.delete(note.id);render();}
    }
    function makeRow() {
      const item=element('article',undefined,'workspace-note'),head=element('div',undefined,'workspace-note-head');
      const title=element('h3'),alignment=element('span','','workspace-alignment');head.append(title,alignment);
      const body=element('p','','workspace-note-text'),meta=element('p','','workspace-caption'),source=element('p','','workspace-source'),missing=element('p','','workspace-note-missing');
      const actions=element('div',undefined,'workspace-note-actions');
      const jump=button(l10n('跳到快照'),'note-jump'),edit=button(l10n('編輯'),'note-edit'),remove=button(l10n('移至已刪除'),'note-delete'),restore=button(l10n('恢復筆記'),'note-restore');
      actions.append(jump,edit,remove,restore);item.append(head,body,meta,source,missing,actions);
      const row={element:item,title,alignment,body,meta,source,missing,jump,edit,remove,restore,note:null};
      jump.addEventListener('click',()=>{
        let jumped=false;
        try{jumped=typeof options.onJump==='function'&&options.onJump(copy(row.note))===true;}catch(error){say(String(error?.message||error),true);return;}
        if(!jumped)say(l10n('來源快照未在本次檢視範圍；請選擇原段落或合併相容記錄。'),true);
      });
      edit.addEventListener('click',()=>openEditor({...row.note,noteId:row.note.id,selectionKey:selectionKey(getCurrent())},edit));
      remove.addEventListener('click',()=>changeDeleted(copy(row.note),true));
      restore.addEventListener('click',()=>changeDeleted(copy(row.note),false));
      return row;
    }
    function render() {
      const current=getCurrent(),key=selectionKey(current),focus=doc.activeElement;
      if(priorSelection && priorSelection!==key){localNotice.hidden=true;rows.clear();list.replaceChildren();}
      priorSelection=key;
      if(editing){selectionWarning.hidden=editing.selectionKey===key;selectionWarning.textContent=l10n('目前檢視已切換；此草稿仍固定原玩家、來源段落與快照。');}
      manageButton.disabled=managing;
      let notes=[],displayValues;
      try{displayValues=valuesForDisplay();notes=recordsForSession(current,displayValues,{includeDeleted:showDeleted.checked}).reverse();}
      catch(error){empty.textContent=String(error?.message||error);empty.hidden=false;list.replaceChildren();rows.clear();countLabel.textContent=l10n('筆記無法讀取');return;}
      const active=notes.filter(note=>!note.deletedAt).length;
      countLabel.textContent=l10n("{0} 筆筆記{1} · 只含本次選取的來源段落", active, showDeleted.checked?' · '+(notes.length-active)+l10n(' 筆已刪除'):'');
      empty.hidden=notes.length>0;
      empty.textContent=!current?l10n('請先選擇一段對局記錄。'):!selection(current)?l10n('玩家身分未確認，不會列出其他玩家的筆記。'):showDeleted.checked?l10n('這些來源段落尚無筆記。'):l10n('尚無筆記。可從任一已存手牌快照建立書籤。');
      const seen=new Set();
      notes.forEach((note,index)=>{
        seen.add(note.id);let row=rows.get(note.id);if(!row){row=makeRow();rows.set(note.id,row);}
        row.note=note;row.element.dataset.noteId=note.id;row.element.classList.toggle('deleted',Boolean(note.deletedAt));
        row.title.textContent=note.tag||l10n('未設標籤');row.alignment.textContent=turnLabel(note);row.body.textContent=note.note||l10n('（未填寫筆記）');
        row.meta.textContent=l10n("建立 {0} · 更新 {1}{2}", dateLabel(note.createdAt), dateLabel(note.updatedAt), note.deletedAt?l10n(' · 已刪除'):'');
        row.source.textContent=l10n("來源段落 {0}\n來源快照 {1}", note.sourceSessionId, note.snapshotId);
        row.missing.hidden=anchorExists(note,current,displayValues);row.missing.textContent=l10n('原來源快照目前不在本機選取資料中；筆記保留原錨點，不改接其他回合。');
        row.restore.hidden=!note.deletedAt;row.remove.hidden=Boolean(note.deletedAt);row.edit.disabled=Boolean(note.deletedAt)||busyNotes.has(note.id);
        row.remove.disabled=busyNotes.has(note.id);row.restore.disabled=busyNotes.has(note.id);row.jump.disabled=busyNotes.has(note.id);
        row.element.setAttribute('aria-busy',String(busyNotes.has(note.id)));
        if(list.children[index]!==row.element)list.insertBefore(row.element,list.children[index]||null);
      });
      for(const [id,row]of rows)if(!seen.has(id)){row.element.remove();rows.delete(id);}
      if(focus?.isConnected && doc.activeElement!==focus && !focus.disabled)focus.focus({preventScroll:true});
    }
    showDeleted.addEventListener('change',render);
    manageButton.addEventListener('click',async()=>{
      if(managing)return;const current=getCurrent(),id=sourceIds(current)[0];managing=true;manageButton.disabled=true;
      try{await send({type:'MSA_OPEN_LIBRARY',...(current?.gameId?{gameId:current.gameId}:{}),...(id?{sessionId:id}:{})});}
      catch(error){say(String(error?.message||error),true);}
      finally{managing=false;manageButton.disabled=false;}
    });
    function buttonForSnapshot(snapshot) {
      const current=getCurrent(),sourceSessionId=snapshot?.sourceSessionId||current?.id;
      const action=button(l10n('新增筆記'),'snapshot-note');action.classList.add('workspace-snapshot-note');
      const found=sourceSnapshot(current,getValues(),snapshot?.id,sourceSessionId);
      action.disabled=!found;
      if(!found)action.title=l10n('需有來源相符、玩家已確認且仍在本機的快照，才能新增筆記。');
      action.addEventListener('click',()=>{
        const checked=sourceSnapshot(getCurrent(),getValues(),snapshot?.id,sourceSessionId);
        if(!checked){say(l10n('原來源快照未在本次選取範圍或已不存在，未建立筆記。'),true);return;}
        openEditor({...copy(checked.snapshot),snapshotId:checked.snapshot.id,sourceSessionId:checked.source.id,
          gameId:checked.source.gameId,playerName:checked.source.playerName,selectionKey:selectionKey(getCurrent()),note:'',tag:''},action);
      });
      return action;
    }
    const unbindLanguage = root.MSAI18n?.captureStatic(container);
    const unbindDialogLanguage = root.MSAI18n?.captureStatic(dialog);
    const unsubscribeLanguage = root.MSAI18n?.subscribe(() => {
      render();setSaving(saving);
      if(editing){dialogTitle.textContent=editing.noteId?l10n('編輯筆記'):l10n('新增筆記');
        dialogAnchor.textContent=l10n("{0} · {1}\n來源段落 {2}\n來源快照 {3}。編輯文字不會改變錨點。", editing.playerName, turnLabel(editing), editing.sourceSessionId, editing.snapshotId);}
    });
    render();
    return {render,buttonForSnapshot,exportRecords,destroy(){unbindLanguage?.();unbindDialogLanguage?.();unsubscribeLanguage?.();}};
  }
  return Object.freeze({create,recordsForSession,exportRecords,turnLabel});
});
