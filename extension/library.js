(function(){
  'use strict';
  const core=globalThis.MSALibraryCore,$=id=>document.getElementById(id);
  let values={},busy=false,importState=null,deckBase=null,preferredSession=new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('session')||'';
  const displayTime=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-TW'):'時間未知';
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
    if(!result)throw new Error('管理服務沒有回應，請重新載入擴充功能後再試。');
    return result;
  }
  async function perform(operation){
    if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input,select,textarea')],states=controls.map(node=>[node,node.disabled]);
    controls.forEach(node=>{node.disabled=true;});document.body.setAttribute('aria-busy','true');
    try{await operation();}catch(error){notice(String(error?.message||error),'error');}
    finally{busy=false;states.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});document.body.removeAttribute('aria-busy');updateButtons();}
  }
  function requireSuccess(result){if(!result.ok)throw new Error(result.error||'操作未完成。');return result;}
  function updateButtons(){
    $('confirm-import').disabled=busy||!importState?.previewToken||!importState.summary?.writes;
    const main=core.parseDeck($('deck-main').value),resource=core.parseDeck($('deck-resources').value,'resources'),token=core.parseDeck($('deck-tokens').value,'tokens');
    $('save-deck').disabled=busy||!$('deck-name').value.trim()||!main.ok||!resource.ok||!token.ok;
    $('save-match').disabled=busy||!$('match-session').value;
  }
  async function load(){
    values=await chrome.storage.local.get(null);
    const all=sessions(),versions=decks();
    $('workspace-count').textContent=`${all.length} 段對局 · ${versions.length} 個牌組版本 · ${records('msa.note.').length} 筆註記`;
    const deckOptions=versions.map(deck=>({value:deck.id,label:`${deck.name} · ${short(deck.contentHash)} · ${displayTime(deck.createdAt)}`}));
    options($('deck-version'),deckOptions,'建立新牌組');
    options($('match-deck'),deckOptions,'尚未綁定牌組');options($('stats-deck'),deckOptions,'全部版本');
    options($('match-session'),all.map(record=>({value:record.id,label:`${record.playerName||'未辨識玩家／僅公開 Log'} · ${short(record.gameId)} · ${displayTime(record.startedAt)}`})),all.length?null:'尚無本機對局',preferredSession||undefined);
    preferredSession='';renderArchives();renderStats();renderMatch();updateButtons();
  }
  function renderArchives(){
    const target=$('archives');target.replaceChildren();
    const archives=records('msa.import.').sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt)));
    if(!archives.length){target.append(element('p','尚無匯入原件。','hint'));return;}
    for(const archive of archives){
      const item=element('div',undefined,'archive-item'),label=element('div');
      label.append(element('p',archive.source?.fileName||'匯入資料'),element('p',`${displayTime(archive.importedAt)} · ${Object.keys(archive.sourceRecords||{}).length} 筆原始資料`,'hint'));
      const button=element('button','下載原始資料','secondary');button.type='button';
      button.addEventListener('click',()=>{
        try{download(core.createArchiveBackup(values,archive),`msa-original-${short(archive.id)}.json`);notice('原始資料已產生並開始下載。');
        }catch(error){notice(error.message,'error');}
      });item.append(label,button);target.append(item);
    }
  }
  function renderPreview(result){
    $('import-preview').hidden=false;
    $('import-source').textContent=`來源：${result.source.fileName||'未命名檔案'} · ${result.source.kind} · ${(result.source.bytes/1024).toFixed(1)} KiB`;
    const s=result.summary;
    $('import-summary').textContent=`${s.records} 筆資料（${s.sessions} 段對局）· 新增 ${s.newRecords} · 衝突 ${s.conflicts} · 相同跳過 ${s.skipped}`;
    $('import-warnings').replaceChildren(...result.warnings.map(message=>element('li',message)));
    const labels={new:'新增',copy:'保留本機，另存匯入副本','archived-conflict':'保留本機，封存匯入原件',identical:'完全相同，跳過','identical-copy':'已有相同匯入副本，跳過'};
    const rows=result.items.slice(0,200).map(item=>{const tr=element('tr');tr.append(element('td',item.key),element('td',labels[item.status]||item.status));return tr;});
    if(result.items.length>200){const tr=element('tr'),td=element('td',`另有 ${result.items.length-200} 筆；上方總數包含全部資料。`);td.colSpan=2;tr.append(td);rows.push(tr);}
    $('import-items').replaceChildren(...rows);updateButtons();
  }
  function clearImport(){importState=null;$('import-preview').hidden=true;$('import-file').value='';updateButtons();}
  function renderDeckValidation(){
    const main=core.parseDeck($('deck-main').value),resources=core.parseDeck($('deck-resources').value,'resources'),tokens=core.parseDeck($('deck-tokens').value,'tokens');
    const errors=[...main.errors,...resources.errors,...tokens.errors],node=$('deck-validation');
    node.className='validation'+(!errors.length?' valid':'');
    node.textContent=errors.length?errors.slice(0,8).join('\n'):`格式檢查通過：主牌 ${main.total} 張 · 資源 ${resources.total} 張 · Token ${tokens.total} 張。賽制合法性尚未驗證。`;
    updateButtons();
  }
  function loadDeck(id){
    deckBase=values['msa.deck.'+id]||null;
    const text=cards=>(cards||[]).map(card=>`${card.count}x${card.cardCode}`).join('\n');
    $('deck-name').value=deckBase?.name||'';$('deck-main').value=text(deckBase?.main);
    $('deck-resources').value=text(deckBase?.resources);$('deck-tokens').value=text(deckBase?.tokens);
    $('deck-version-info').textContent=deckBase?`目前編輯來源：${deckBase.id}。保存變更會產生新版本；舊版本與已綁定對局不會覆寫。`:'新牌組尚未保存。';
    renderDeckValidation();
  }
  function selectedSession(){return values['msa.session.'+$('match-session').value];}
  function renderMatch(){
    const record=selectedSession();
    $('match-source').textContent=record?`來源段落 ${record.id} · ${record.snapshots.length} 筆已存手牌 · ${record.battleLog?.events?.length||0} 筆公開事件`:'先匯入或記錄一場對局。';
    $('match-player').value=record?.playerName||'';$('match-player').readOnly=Boolean(record?.playerName?.trim());
    $('identity-confirmed').checked=false;$('result-confirmed').checked=false;$('match-result').value='unknown';$('match-order').value='unknown';$('match-deck').value='';$('match-saved').textContent='';
    loadMatchConfirmation();
  }
  function loadMatchConfirmation(){
    const record=selectedSession(),player=$('match-player').value.trim();if(!record||!player)return;
    const existing=core.calculateStats(values).matches.find(match=>match.gameId===record.gameId&&match.playerName===player);
    if(!existing)return;
    $('identity-confirmed').checked=true;$('result-confirmed').checked=existing.resultConfirmed===true;
    $('match-result').value=existing.result||'unknown';$('match-order').value=existing.firstPlayer||'unknown';
    $('match-deck').value=existing.deckVersionId||'';
    $('match-saved').textContent=`已有人工作業確認：${displayTime(existing.updatedAt)}。${existing.frozenDeckVersion?`綁定凍結版本「${existing.frozenDeckVersion.name}」`:'尚未綁定牌組'}；修改並保存會更新同一場確認，不會增加場次。`;
  }
  function renderStats(){
    const stats=core.calculateStats(values,{deckVersionId:$('stats-deck').value,firstPlayer:$('stats-order').value});
    const metrics=[['人工確認場次',stats.confirmed],['勝率（含和局分母）',stats.winRate===null?'—':(stats.winRate*100).toFixed(1)+'%'],['勝／負（含本人投降）',`${stats.wins} / ${stats.lossesIncludingConcedes}`],['和局／未確認',`${stats.draws} / ${stats.unconfirmed}`]];
    $('stats-summary').replaceChildren(...metrics.map(([label,value])=>{const node=element('div',undefined,'stat');node.append(element('strong',String(value)),element('span',label));return node;}));
    $('stats-denominator').textContent=`樣本：${stats.total} 場唯一對局；已確認 ${stats.confirmed} 場、未確認 ${stats.unconfirmed} 場。本人投降 ${stats.concedes} 場計入負場，和局計入總勝率分母。總勝率＝勝場／人工確認場次；未確認不列分母。決勝勝率（排除和局）＝${stats.decisiveWinRate===null?'—':(stats.decisiveWinRate*100).toFixed(1)+'%'}。資料皆由使用者確認，非自動判定。`;
    const results={win:'勝',loss:'負',draw:'和局',concede:'本人投降（負）',unknown:'未確認'},orders={first:'先手',second:'後手',unknown:'未確認'};
    const rows=stats.matches.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).map(match=>{
      const tr=element('tr'),identity=element('td',match.playerName);identity.append(element('small',short(match.gameId)));
      tr.append(identity,element('td',match.frozenDeckVersion?`${match.frozenDeckVersion.name} · ${short(match.frozenDeckVersion.contentHash)}`:'未綁定'),element('td',orders[match.firstPlayer]||'未確認'),element('td',match.resultConfirmed?(results[match.result]||'未確認'):'未確認'));return tr;
    });
    if(!rows.length){const tr=element('tr'),td=element('td','尚無符合條件的人工戰績。');td.colSpan=4;tr.append(td);rows.push(tr);}
    $('stats-rows').replaceChildren(...rows);
  }
  $('backup').addEventListener('click',()=>perform(async()=>{
    const result=requireSuccess(await action('createBackup'));
    download(result.backup,`msa-workspace-${new Date().toISOString().slice(0,10)}.json`);notice('完整備份已產生並開始下載，請確認下載完成後再移動或清除本機資料。');
  }));
  $('import-file').addEventListener('change',()=>perform(async()=>{
    importState=null;$('import-preview').hidden=true;const file=$('import-file').files?.[0];if(!file)return;
    if(file.size>core.LIMITS.bytes)throw new Error('檔案超過 20 MiB，請分批匯入。');
    const text=await file.text(),result=requireSuccess(await action('previewImport',{text,fileName:file.name}));
    importState={...result,text,fileName:file.name};renderPreview(result);notice(result.summary.writes?'預覽完成，尚未寫入。請核對衝突處理後按「確認匯入」。':'預覽完成：相同資料或匯入原件已存在，無需再次匯入。');
  }));
  $('cancel-import').addEventListener('click',clearImport);
  $('confirm-import').addEventListener('click',()=>perform(async()=>{
    if(!importState)return;const {text,fileName,previewToken}=importState;
    const result=await action('applyImport',{text,fileName,previewToken,confirmed:true});
    if(result.code==='preview-stale'){
      const preview=requireSuccess(await action('previewImport',{text,fileName}));importState={...preview,text,fileName};renderPreview(preview);notice('本機資料已變更，已更新預覽；請再次核對並確認。','warning');return;
    }
    if(!result.ok){
      const failures=(result.failedKeys||[]).map(item=>item.key+'：'+item.error).join('\n');
      notice(`${result.error||'匯入未完成。'}\n已核對保存 ${(result.savedKeys||[]).length} 筆，尚待 ${(result.remainingKeys||[]).length+(result.failedKeys||[]).length} 筆。${failures?'\n'+failures:''}`,'error');
      importState=null;$('import-preview').hidden=true;await load();return;
    }
    clearImport();await load();notice(`匯入完成：已保存 ${result.savedKeys.length} 筆資料，跳過 ${result.skippedKeys.length} 筆相同資料。既有衝突記錄保留。`);
  }));
  $('deck-version').addEventListener('change',()=>loadDeck($('deck-version').value));
  for(const id of ['deck-name','deck-main','deck-resources','deck-tokens'])$(id).addEventListener('input',renderDeckValidation);
  $('new-deck').addEventListener('click',()=>{$('deck-version').value='';loadDeck('');$('deck-name').focus();});
  $('deck-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{
    const result=requireSuccess(await action('saveDeck',{draft:{deckId:deckBase?.deckId||'',parentVersionId:deckBase?.id||null,name:$('deck-name').value,
      mainText:$('deck-main').value,resourcesText:$('deck-resources').value,tokensText:$('deck-tokens').value}}));
    await load();$('deck-version').value=result.record.id;loadDeck(result.record.id);notice(result.existing?'此內容的版本已存在，保留原版本。':'新牌組版本已保存；既有版本與綁定對局未改動。');
  });});
  $('match-session').addEventListener('change',renderMatch);
  $('match-player').addEventListener('input',()=>{$('identity-confirmed').checked=false;$('result-confirmed').checked=false;$('match-saved').textContent='';});
  $('match-result').addEventListener('change',()=>{$('result-confirmed').checked=false;});
  $('match-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{
    const source=selectedSession();if(!source)throw new Error('請先選擇對局。');
    requireSuccess(await action('saveMatch',{draft:{sourceSessionId:source.id,gameId:source.gameId,playerName:$('match-player').value,
      identityConfirmed:$('identity-confirmed').checked,deckVersionId:$('match-deck').value,firstPlayer:$('match-order').value,
      result:$('match-result').value,resultConfirmed:$('result-confirmed').checked}}));
    preferredSession=source.id;await load();notice('對局確認已保存。這場只計算一次；牌組版本已凍結。');
  });});
  $('stats-deck').addEventListener('change',renderStats);$('stats-order').addEventListener('change',renderStats);
  perform(async()=>{await load();renderDeckValidation();});
})();
