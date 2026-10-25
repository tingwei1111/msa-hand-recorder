(function(root){
  'use strict';
  // Preview-only storage. Nothing here reads Chrome extension storage or MSA.
  const STORE='msa.preview.workspace.v06',ACTIVE='msa.preview.active-client.v06';
  const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  function create(options={}){
    const shared=options.isolated!==true,clientId=crypto.randomUUID(),database={},listeners=new Set(),messageListeners=[];
    const pending=new Map(),cardPending=new Map(),cardCache=new Map();
    let queue=Promise.resolve(),libraryStore=null;
    const channel=shared&&typeof BroadcastChannel==='function'?new BroadcastChannel('msa-preview-workspace-v06'):null;
    function parsed(){const raw=localStorage.getItem(STORE);if(raw===null)return null;const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('合成預覽資料格式錯誤；請使用「清除所有合成資料」。');return value;}
    function replace(next){for(const key of Object.keys(database))delete database[key];Object.assign(database,copy(next));}
    function difference(before,after){const changes={};for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[key])!==JSON.stringify(after[key]))changes[key]={oldValue:copy(before[key]),newValue:copy(after[key])};return changes;}
    function emit(changes){if(Object.keys(changes).length)for(const listener of listeners)listener(changes,'local');}
    function refresh(){if(shared){const saved=parsed();if(saved)replace(saved);}return database;}
    function persist(next){if(shared)localStorage.setItem(STORE,JSON.stringify(next));const changes=difference(database,next);replace(next);emit(changes);}
    try{const stored=shared?parsed():null;replace(stored||options.seed||{});if(shared&&!stored)localStorage.setItem(STORE,JSON.stringify(database));}
    catch(error){replace(options.seed||{});options.initialStorageError=String(error.message||error);}
    const storage={local:{
      async get(keys){if(options.scenario==='storage-error'||options.initialStorageError)throw new Error(options.initialStorageError||'合成測試：無法讀取本機儲存空間');refresh();
        if(keys==null)return copy(database);const names=Array.isArray(keys)?keys:typeof keys==='object'?Object.keys(keys):[keys];
        return Object.fromEntries(names.filter(key=>Object.hasOwn(database,key)||typeof keys==='object'&&!Array.isArray(keys)).map(key=>[key,copy(Object.hasOwn(database,key)?database[key]:keys[key]) ]));},
      async set(values){if(options.scenario==='settings-error')throw new Error('合成測試：設定儲存失敗');const next={...refresh(),...copy(values)};persist(next);},
      async remove(keys){const next={...refresh()};for(const key of Array.isArray(keys)?keys:[keys])delete next[key];persist(next);},
      async clear(){persist({});}
    },onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)}};
    if(shared)root.addEventListener('storage',event=>{if(event.key===STORE){try{const next=event.newValue?JSON.parse(event.newValue):{};const changes=difference(database,next);replace(next);emit(changes);}catch(_){/* A later read reports invalid data. */}}});
    const currentGame=()=>location.pathname.match(/^\/game\/([a-f0-9-]{36})/i)?.[1]||null;
    function markActive(){if(shared&&currentGame())localStorage.setItem(ACTIVE,clientId);}
    root.addEventListener('focus',markActive);
    function dispatch(message){return new Promise(resolve=>{
      let done=false;const timer=setTimeout(()=>{if(!done){done=true;resolve({ok:true,refreshed:false,partial:true,reason:'合成對局頁沒有及時回應。'});}},12000);
      const respond=value=>{if(!done){done=true;clearTimeout(timer);resolve(value);}};
      if(!messageListeners.length){clearTimeout(timer);resolve(null);return;}
      for(const listener of messageListeners){try{listener(message,{id:'synthetic-extension'},respond);}catch(error){respond({ok:false,reason:String(error.message||error)});}}
    });}
    function pageRequest(message){
      if(messageListeners.length&&currentGame()&&(!message.gameId||message.gameId===currentGame()))return dispatch(message);
      if(!channel)return Promise.resolve(null);
      const id=crypto.randomUUID(),target=localStorage.getItem(ACTIVE);
      return new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(id);resolve(null);},13000);pending.set(id,{resolve,timer});channel.postMessage({kind:'request',id,clientId,target,message});});
    }
    if(channel)channel.addEventListener('message',async event=>{
      const data=event.data;if(!data||data.clientId===clientId)return;
      if(data.kind==='reply'&&pending.has(data.id)){const task=pending.get(data.id);clearTimeout(task.timer);pending.delete(data.id);task.resolve(data.result);return;}
      if(data.kind!=='request'||!messageListeners.length||!currentGame()||(data.target&&data.target!==clientId)||
        (data.message?.gameId&&data.message.gameId!==currentGame()))return;
      const result=await dispatch(data.message);channel.postMessage({kind:'reply',id:data.id,clientId,result});
    });
    function previewUrl(file){const [name,query='']=String(file).split('?');const page={'review.html':'review-preview.html','popup.html':'popup-preview.html','library.html':'library-preview.html'}[name];
      return new URL((page?'/demo/'+page:'/extension/'+name)+(query?'?'+query:''),location.origin).href;}
    function openPage(file,parameters={}){const url=new URL(previewUrl(file));for(const[key,value]of Object.entries(parameters))if(value)url.searchParams.set(key,value);
      const opened=root.open(url.href,'_blank');if(!opened)return {ok:false,reason:'瀏覽器阻擋了預覽分頁，請允許此本機頁面開啟分頁。'};
      opened.opener=null;return {ok:true,opened:true};}
    const enqueue=operation=>{const next=queue.catch(()=>{}).then(operation);queue=next;return next;};
    async function cardLookup(message){
      const code=String(message.cardCode||''),locale=message.locale==='en'?'en':'zh-tw';
      if(!/^(?:(?:GD|ST|EB|SC|SLB)\d{2,3}|PR|P|R|T|EXB|EXR)-\d{3}$/.test(code))return {status:'error',reason:'卡號格式不符。'};
      const key=locale+':'+code,hit=cardCache.get(key);if(hit&&Date.now()-hit.at<600000)return copy(hit.value);
      if(cardPending.has(key))return cardPending.get(key);
      const operation=(async()=>{try{
        const response=await fetch('/__msa_preview/card?'+new URLSearchParams({cardCode:code,locale}),{signal:AbortSignal.timeout(28000),credentials:'omit',referrerPolicy:'no-referrer'});
        const value=await response.json();if(value.status!=='error'){if(cardCache.size>=16)cardCache.delete(cardCache.keys().next().value);cardCache.set(key,{at:Date.now(),value});}return value;
      }catch(_){return {status:'error',cardCode:code,reason:'本機官方查卡服務無法使用；請以 npm run preview 啟動新版預覽伺服器。'};}finally{cardPending.delete(key);}})();
      cardPending.set(key,operation);return operation;
    }
    async function noteAction(message){
      if(options.writeFailure?.())throw new Error('合成測試：筆記尚未儲存。');
      const values=await storage.local.get(null),core=root.MSAAnnotationsCore;
      if(!core)throw new Error('合成筆記模組尚未載入。');let record;
      if(message.action==='create'){
        const id=message.sourceSessionId||`${message.gameId}.${message.runId}`,source=values['msa.session.'+id];
        if(!source||source.id!==id||(message.gameId&&message.gameId!==source.gameId)||(message.playerName&&message.playerName!==source.playerName))throw new Error('合成筆記來源不符。');
        const snapshot=source.snapshots?.find(item=>item.id===message.payload?.snapshotId);if(!snapshot)throw new Error('找不到已存來源快照。');
        record=core.create(source,snapshot,message.payload);
      }else if(message.action==='update'){
        record=core.update(values['msa.note.'+message.noteId],message.payload);
      }else throw new Error('不支援的筆記操作。');
      await storage.local.set({['msa.note.'+record.id]:record});return {ok:true,bookmark:record};
    }
    async function sendMessage(message){
      try{
        if(typeof options.onMessage==='function'){const result=await options.onMessage(message);if(result!==undefined)return result;}
        if(message.type==='MSA_CARD_LOOKUP')return cardLookup(message);
        if(message.type==='MSA_NOTE_ACTION')return await enqueue(()=>noteAction(message));
        if(message.type==='MSA_BIND_LIVE_DECK')return await enqueue(async()=>{
          if(message.confirmed!==true||message.gameId!==currentGame()||!message.playerName)throw new Error('請在本場合成對局確認牌組。');
          const values=await storage.local.get(null),source=values['msa.session.'+message.gameId+'.'+message.runId];
          if(!source?.snapshots?.length||source.playerName!==message.playerName)throw new Error('本段尚無來源相符的已存手牌。');
          const prior=root.MSALibraryCore.calculateStats(values).matches.find(item=>item.gameId===message.gameId&&item.playerName===message.playerName);
          if(prior?.resultConfirmed&&prior.deckVersionId!==message.deckVersionId)throw new Error('本場已確認結果，請到資料管理頁修改牌組。');
          if(prior?.deckVersionId===message.deckVersionId)return {ok:true,record:prior,existing:true};
          if(!libraryStore)libraryStore=root.MSALibraryStore.create({storage:storage.local});
          return libraryStore.saveMatch({draft:{sourceSessionId:source.id,gameId:source.gameId,playerName:source.playerName,
            identityConfirmed:true,deckVersionId:message.deckVersionId,result:prior?.result||'unknown',
            resultConfirmed:prior?.resultConfirmed===true,firstPlayer:prior?.firstPlayer||'unknown'}});
        });
        if(message.type==='MSA_LIBRARY_ACTION')return await enqueue(async()=>{
          if(['applyImport','saveDeck','saveMatch'].includes(message.action)&&options.writeFailure?.())throw new Error('合成測試：管理資料尚未儲存。');
          if(!libraryStore)libraryStore=root.MSALibraryStore.create({storage:storage.local});
          if(!['previewImport','applyImport','saveDeck','saveMatch','createBackup'].includes(message.action))throw new Error('不支援的管理操作。');
          return libraryStore[message.action](message);
        });
        if(message.type==='MSA_OPEN_LIBRARY')return openPage('library.html',{id:message.sessionId||(message.gameId&&message.runId?message.gameId+'.'+message.runId:''),gameId:message.gameId});
        if(message.type==='MSA_OPEN_LIVE_REVIEW')return {ok:false,reason:'此訊息只由原合成對局 callback 處理；不提供替代導航。'};
        if(message.type==='MSA_SHOW_LIVE_PANEL')return await pageRequest({type:'MSA_LIVE_PANEL_SHOW'})||{ok:false,reason:'請先開啟 demo/index.html 合成對局頁。'};
        if(message.type==='MSA_PREPARE_EXPORT'){
          if(options.scenario==='export-success')return {ok:true,refreshed:true,eventCount:Object.values(database).find(value=>value?.gameId===message.gameId&&value.battleLog)?.battleLog.events?.length||0,reason:'合成匯出成功情境'};
          if(options.isolated)return {ok:true,refreshed:false,partial:true,reason:'此為隔離合成情境，沒有對局頁可刷新。'};
          return await pageRequest({type:'MSA_CAPTURE_NOW',gameId:message.gameId,playerName:message.playerName,reason:'export'})||{ok:true,refreshed:false,partial:true,reason:'沒有回應的合成對局頁；僅匯出本機已存合成資料。'};
        }
        if(message.type==='MSA_RUN_DIAGNOSTICS'){
          const page=await pageRequest({type:'MSA_DIAGNOSTICS_QUERY'});
          return {ok:true,report:root.MSADiagnosticsCore.report({extensionVersion:root.MSARecorderCore?.VERSION||'0.7.0',page,reason:'請開啟 demo/index.html 合成對局頁；這不是實際 MSA 檢查。'})};
        }
        return {ok:false,reason:'尚未支援的合成預覽訊息。'};
      }catch(error){return {ok:false,reason:String(error.message||error),error:String(error.message||error)};}
    }
    root.chrome=root.chrome||{};
    root.chrome.storage=storage;root.chrome.runtime={id:'synthetic-extension',getURL:previewUrl,getManifest:()=>({version:root.MSARecorderCore?.VERSION||'0.7.0'}),sendMessage,
      onMessage:{addListener(listener){messageListeners.push(listener);markActive();},removeListener(listener){const index=messageListeners.indexOf(listener);if(index>=0)messageListeners.splice(index,1);}}};
    return {database,storage,messageListeners,sendMessage,reset:async()=>{persist(copy(options.seed||{}));},storeKey:STORE};
  }
  root.MSAPreviewWorkspace=Object.freeze({create,STORE});
})(globalThis);
