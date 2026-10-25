(async function(){
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);
  await globalThis.MSAI18n?.ready();

  const core=globalThis.MSALibraryCore,$=id=>document.getElementById(id);
  let values={},busy=false,importState=null,deckBase=null,preferredSession=new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('session')||'';
  const matchDrafts=new Map(),draftFields=['match-player','identity-confirmed','result-confirmed','match-result','match-order','match-deck'];
  let displayedSession='',deckDirty=false,reloadTimer,loading=false,pendingReload=false;
  function rememberDraft(){
    if(!displayedSession)return;
    const record=values['msa.session.'+displayedSession];
    matchDrafts.set(displayedSession,{sourcePlayer:record?.playerName||'',fields:Object.fromEntries(draftFields.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]))});
  }
  function draftLabel(){
    if($('draft-status'))$('draft-status').hidden=!matchDrafts.has(displayedSession);
  }
  const displayTime=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(globalThis.MSAI18n?.language || 'zh-TW'):l10n('時間未知');
  const short=value=>String(value||'').slice(0,12);
  const records=prefix=>Object.entries(values).filter(([key,value])=>key.startsWith(prefix)&&value&&typeof value==='object').map(([,value])=>value);
  const sessions=()=>records('msa.session.').filter(record=>record.schemaVersion===1&&Array.isArray(record.snapshots)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const decks=()=>records('msa.deck.').filter(record=>record.schemaVersion===1).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function notice(message,tone=''){const node=$('notice');node.textContent=message;node.className='notice'+(tone?' '+tone:'');node.hidden=!message;}
  function options(select,items,emptyLabel,desired){
    const current=desired===undefined?select.value:desired;
    select.replaceChildren();
    if(emptyLabel!==null){const option=element('option',emptyLabel);option.value='';select.append(option);}
    for(const item of items){const option=element('option',item.label);option.value=item.value;select.append(option);}
    if([...select.options].some(option=>option.value===current))select.value=current;
  }
  function download(value,filename){
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function action(name,payload={}){
    const result=await chrome.runtime.sendMessage({type:'MSA_LIBRARY_ACTION',action:name,...payload});
    if(!result)throw new Error(l10n('管理服務沒有回應，請重新載入擴充功能後再試。'));
    return result;
  }
  async function perform(operation){
    if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input,select,textarea')],states=controls.map(node=>[node,node.disabled]);
    controls.forEach(node=>{node.disabled=true;});document.body.setAttribute('aria-busy','true');
    try{await operation();}catch(error){notice(globalThis.MSAI18n?.message(String(error?.message||error))||String(error?.message||error),'error');}
    finally{busy=false;states.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});document.body.removeAttribute('aria-busy');updateButtons();if(pendingReload){pendingReload=false;scheduleReload();}}
  }
  function requireSuccess(result){if(!result.ok)throw new Error(result.error||l10n('操作未完成。'));return result;}
  function updateButtons(){
    $('confirm-import').disabled=busy||!importState?.previewToken||!importState.summary?.writes||Boolean(importState.capacity&&importState.capacity.projected>importState.capacity.limit);
    const main=core.parseDeck($('deck-main').value),resource=core.parseDeck($('deck-resources').value,'resources'),token=core.parseDeck($('deck-tokens').value,'tokens');
    $('save-deck').disabled=busy||!$('deck-name').value.trim()||!main.ok||!resource.ok||!token.ok;
    $('save-match').disabled=busy||!$('match-session').value;
  }
  async function load(){
    if(loading){pendingReload=true;return;}
    loading=true;
    try{
    values=await chrome.storage.local.get(null);
    const all=sessions(),versions=decks();
    $('workspace-count').textContent=l10n("{0} 段對局 · {1} 個牌組版本 · {2} 筆註記", all.length, versions.length, records('msa.note.').length);
    const deckOptions=versions.map(deck=>({value:deck.id,label:`${deck.name} · ${short(deck.contentHash)} · ${displayTime(deck.createdAt)}`}));
    options($('deck-version'),deckOptions,l10n('建立新牌組'));
    options($('match-deck'),deckOptions,l10n('尚未綁定牌組'));options($('stats-deck'),deckOptions,l10n('全部版本'));
    options($('match-session'),all.map(record=>({value:record.id,label:`${record.playerName||l10n('未辨識玩家／僅公開 Log')} · ${short(record.gameId)} · ${displayTime(record.startedAt)}`})),all.length?null:l10n('尚無本機對局'),preferredSession||undefined);
    preferredSession='';renderArchives();renderStats();renderMatch();updateButtons();
    if(globalThis.MSAStorageHealth)MSAStorageHealth.render(document,await MSAStorageHealth.measure(chrome.storage.local));
    }finally{loading=false;if(pendingReload){pendingReload=false;scheduleReload();}}
  }
  function scheduleReload(){clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>{if(busy||loading){pendingReload=true;return;}load().catch(error=>notice(error.message,'error'));},180);}
  function renderArchives(){
    const target=$('archives');target.replaceChildren();
    const archives=records('msa.import.').sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt)));
    if(!archives.length){target.append(element('p',l10n('尚無匯入原件。'),'hint'));return;}
    for(const archive of archives){
      const item=element('div',undefined,'archive-item'),label=element('div');
      label.append(element('p',archive.source?.fileName||l10n('匯入資料')),element('p',l10n("{0} · {1} 筆原始資料", displayTime(archive.importedAt), Object.keys(archive.sourceRecords||{}).length),'hint'));
      const button=element('button',l10n('下載原始資料'),'secondary');button.type='button';
      button.addEventListener('click',()=>{
        try{download(core.createArchiveBackup(values,archive),`msa-original-${short(archive.id)}.json`);notice(l10n('原始資料已產生並開始下載。'));
        }catch(error){notice(error.message,'error');}
      });item.append(label,button);target.append(item);
    }
  }
  function renderPreview(result){
    $('import-preview').hidden=false;
    $('import-source').textContent=l10n("來源：{0} · {1} · {2} KiB", result.source.fileName||l10n('未命名檔案'), result.source.kind, (result.source.bytes/1024).toFixed(1));
    const s=result.summary;
    $('import-summary').textContent=l10n("{0} 筆資料（{1} 段對局）· 新增 {2} · 衝突 {3} · 相同跳過 {4}", s.records, s.sessions, s.newRecords, s.conflicts, s.skipped);
    $('import-warnings').replaceChildren(...result.warnings.map(message=>element('li',globalThis.MSAI18n?.message(message)||message)));
    const labels={new:l10n('新增'),copy:l10n('保留本機，另存匯入副本'),'archived-conflict':l10n('保留本機，封存匯入原件'),identical:l10n('完全相同，跳過'),'identical-copy':l10n('已有相同匯入副本，跳過')};
    const rows=result.items.slice(0,200).map(item=>{const tr=element('tr');tr.append(element('td',item.key),element('td',labels[item.status]||item.status));return tr;});
    if(result.items.length>200){const tr=element('tr'),td=element('td',l10n("另有 {0} 筆；上方總數包含全部資料。", result.items.length-200));td.colSpan=2;tr.append(td);rows.push(tr);}
    $('import-items').replaceChildren(...rows);updateButtons();
  }
  function clearImport(){importState=null;$('import-preview').hidden=true;$('import-file').value='';updateButtons();}
  function renderDeckValidation(){
    const main=core.parseDeck($('deck-main').value),resources=core.parseDeck($('deck-resources').value,'resources'),tokens=core.parseDeck($('deck-tokens').value,'tokens');
    const errors=[...main.errors,...resources.errors,...tokens.errors],node=$('deck-validation');
    node.className='validation'+(!errors.length?' valid':'');
    node.textContent=errors.length?errors.slice(0,8).map(value=>globalThis.MSAI18n?.message(value)||value).join('\n'):l10n("格式檢查通過：主牌 {0} 張 · 資源 {1} 張 · Token {2} 張。賽制合法性尚未驗證。", main.total, resources.total, tokens.total);
    updateButtons();
  }
  function loadDeck(id){
    deckDirty=false;
    deckBase=values['msa.deck.'+id]||null;
    const text=cards=>(cards||[]).map(card=>`${card.count}x${card.cardCode}`).join('\n');
    $('deck-name').value=deckBase?.name||'';$('deck-main').value=text(deckBase?.main);
    $('deck-resources').value=text(deckBase?.resources);$('deck-tokens').value=text(deckBase?.tokens);
    $('deck-version-info').textContent=deckBase?l10n("目前編輯來源：{0}。保存變更會產生新版本；舊版本與已綁定對局不會覆寫。", deckBase.id):l10n('新牌組尚未保存。');
    renderDeckValidation();
  }
  function selectedSession(){return values['msa.session.'+$('match-session').value];}
  function renderMatch(){
    const record=selectedSession();
    $('match-source').textContent=record?l10n("來源段落 {0} · {1} 筆已存手牌 · {2} 筆公開事件", record.id, record.snapshots.length, record.battleLog?.events?.length||0):l10n('先匯入或記錄一場對局。');
    $('match-player').value=record?.playerName||'';$('match-player').readOnly=Boolean(record?.playerName?.trim());
    $('identity-confirmed').checked=false;$('result-confirmed').checked=false;$('match-result').value='unknown';$('match-order').value='unknown';$('match-deck').value='';$('match-saved').textContent='';
    loadMatchConfirmation();
    displayedSession=record?.id||'';
    const draft=matchDrafts.get(displayedSession);
    if(draft&&draft.sourcePlayer===(record?.playerName||''))for(const[id,value]of Object.entries(draft.fields)){
      if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;
    }else matchDrafts.delete(displayedSession);
    draftLabel();
  }
  function loadMatchConfirmation(){
    const record=selectedSession(),player=$('match-player').value.trim();if(!record||!player)return;
    const existing=core.calculateStats(values).matches.find(match=>match.gameId===record.gameId&&match.playerName===player);
    if(!existing)return;
    $('identity-confirmed').checked=true;$('result-confirmed').checked=existing.resultConfirmed===true;
    $('match-result').value=existing.result||'unknown';$('match-order').value=existing.firstPlayer||'unknown';
    $('match-deck').value=existing.deckVersionId||'';
    $('match-saved').textContent=l10n("已有人工作業確認：{0}。{1}；修改並保存會更新同一場確認，不會增加場次。", displayTime(existing.updatedAt), existing.frozenDeckVersion?l10n("綁定凍結版本「{0}」", existing.frozenDeckVersion.name):l10n('尚未綁定牌組'));
  }
  function renderStats(){
    const stats=core.calculateStats(values,{deckVersionId:$('stats-deck').value,firstPlayer:$('stats-order').value});
    const metrics=[[l10n('人工確認場次'),stats.confirmed],[l10n('勝率（含和局分母）'),stats.winRate===null?'—':(stats.winRate*100).toFixed(1)+'%'],[l10n('勝／負（含本人投降）'),`${stats.wins} / ${stats.lossesIncludingConcedes}`],[l10n('和局／未確認'),`${stats.draws} / ${stats.unconfirmed}`]];
    $('stats-summary').replaceChildren(...metrics.map(([label,value])=>{const node=element('div',undefined,'stat');node.append(element('strong',String(value)),element('span',label));return node;}));
    $('stats-denominator').textContent=l10n("樣本：{0} 場唯一對局；已確認 {1} 場、未確認 {2} 場。本人投降 {3} 場計入負場，和局計入總勝率分母。總勝率＝勝場／人工確認場次；未確認不列分母。決勝勝率（排除和局）＝{4}。資料皆由使用者確認，非自動判定。", stats.total, stats.confirmed, stats.unconfirmed, stats.concedes, stats.decisiveWinRate===null?'—':(stats.decisiveWinRate*100).toFixed(1)+'%');
    const results={win:l10n('勝'),loss:l10n('負'),draw:l10n('和局'),concede:l10n('本人投降（負）'),unknown:l10n('未確認')},orders={first:l10n('先手'),second:l10n('後手'),unknown:l10n('未確認')};
    const rows=stats.matches.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(match=>{
      const tr=element('tr'),identity=element('td',match.playerName);identity.append(element('small',short(match.gameId)));
      tr.append(identity,element('td',match.frozenDeckVersion?`${match.frozenDeckVersion.name} · ${short(match.frozenDeckVersion.contentHash)}`:l10n('未綁定')),element('td',orders[match.firstPlayer]||l10n('未確認')),element('td',match.resultConfirmed?(results[match.result]||l10n('未確認')):l10n('未確認')));return tr;
    });
    if(!rows.length){const tr=element('tr'),td=element('td',l10n('尚無符合條件的人工戰績。'));td.colSpan=4;tr.append(td);rows.push(tr);}
    $('stats-rows').replaceChildren(...rows);
  }
  $('backup').addEventListener('click',()=>perform(async()=>{
    const result=requireSuccess(await action('createBackup'));
    download(result.backup,`msa-workspace-${new Date().toISOString().slice(0,10)}.json`);notice(l10n('完整備份已產生並開始下載，請確認下載完成後再移動或清除本機資料。'));
  }));
  $('import-file').addEventListener('change',()=>perform(async()=>{
    importState=null;$('import-preview').hidden=true;const file=$('import-file').files?.[0];if(!file)return;
    if(file.size>core.LIMITS.bytes)throw new Error(l10n('檔案超過 20 MiB，請分批匯入。'));
    const text=await file.text(),result=requireSuccess(await action('previewImport',{text,fileName:file.name}));
    importState={...result,text,fileName:file.name};renderPreview(result);notice(result.summary.writes?l10n('預覽完成，尚未寫入。請核對衝突處理後按「確認匯入」。'):l10n('預覽完成：相同資料或匯入原件已存在，無需再次匯入。'));
  }));
  $('cancel-import').addEventListener('click',clearImport);
  $('confirm-import').addEventListener('click',()=>perform(async()=>{
    if(!importState)return;const {text,fileName,previewToken}=importState;
    const result=await action('applyImport',{text,fileName,previewToken,confirmed:true});
    if(result.code==='preview-stale'){
      const preview=requireSuccess(await action('previewImport',{text,fileName}));importState={...preview,text,fileName};renderPreview(preview);notice(l10n('本機資料已變更，已更新預覽；請再次核對並確認。'),'warning');return;
    }
    if(!result.ok){
      const failures=(result.failedKeys||[]).map(item=>item.key+'：'+item.error).join('\n');
      notice(l10n("{0}\n已核對保存 {1} 筆，尚待 {2} 筆。{3}", result.error||l10n('匯入未完成。'), (result.savedKeys||[]).length, (result.remainingKeys||[]).length+(result.failedKeys||[]).length, failures?'\n'+failures:''),'error');
      importState=null;$('import-preview').hidden=true;await load();return;
    }
    clearImport();await load();notice(l10n("匯入完成：已保存 {0} 筆資料，跳過 {1} 筆相同資料。既有衝突記錄保留。", result.savedKeys.length, result.skippedKeys.length));
  }));
  $('deck-version').addEventListener('change',()=>loadDeck($('deck-version').value));
  for(const id of ['deck-name','deck-main','deck-resources','deck-tokens'])$(id).addEventListener('input',renderDeckValidation);
  $('new-deck').addEventListener('click',()=>{$('deck-version').value='';loadDeck('');$('deck-name').focus();});
  $('deck-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{
    const result=requireSuccess(await action('saveDeck',{draft:{deckId:deckBase?.deckId||'',parentVersionId:deckBase?.id||null,name:$('deck-name').value,
      mainText:$('deck-main').value,resourcesText:$('deck-resources').value,tokensText:$('deck-tokens').value}}));
    await load();$('deck-version').value=result.record.id;loadDeck(result.record.id);notice(result.existing?l10n('此內容的版本已存在，保留原版本。'):l10n('新牌組版本已保存；既有版本與綁定對局未改動。'));
  });});
  $('match-session').addEventListener('change',()=>{renderMatch();});
  $('match-form').addEventListener('input',event=>{if(event.target.id!=='match-session'){rememberDraft();draftLabel();}});
  $('match-form').addEventListener('change',event=>{if(event.target.id!=='match-session'){rememberDraft();draftLabel();}});
  $('deck-form').addEventListener('input',()=>{deckDirty=true;});
  $('match-player').addEventListener('input',()=>{$('identity-confirmed').checked=false;$('result-confirmed').checked=false;$('match-saved').textContent='';});
  $('match-result').addEventListener('change',()=>{$('result-confirmed').checked=false;});
  $('match-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{
    const source=selectedSession();if(!source)throw new Error(l10n('請先選擇對局。'));
    requireSuccess(await action('saveMatch',{draft:{sourceSessionId:source.id,gameId:source.gameId,playerName:$('match-player').value,
      identityConfirmed:$('identity-confirmed').checked,deckVersionId:$('match-deck').value,firstPlayer:$('match-order').value,
      result:$('match-result').value,resultConfirmed:$('result-confirmed').checked}}));
    matchDrafts.delete(source.id);preferredSession=source.id;await load();notice(l10n('對局確認已保存。這場只計算一次；牌組版本已凍結。'));
  });});
  $('stats-deck').addEventListener('change',renderStats);$('stats-order').addEventListener('change',renderStats);
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(key=>/^msa\.(session|deck|match|note|import)\./.test(key)))scheduleReload();});
  $('refresh-library')?.addEventListener('click',()=>perform(()=>load()));
  window.addEventListener('beforeunload',event=>{if(deckDirty||matchDrafts.size){event.preventDefault();event.returnValue='';}});
  await globalThis.MSAI18n?.mount(document, () => { scheduleReload(); renderDeckValidation(); if(importState)renderPreview(importState); });
  perform(async()=>{await load();renderDeckValidation();});
})();
