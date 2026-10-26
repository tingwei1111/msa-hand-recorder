'use strict';
importScripts('i18n-data.js', 'i18n.js', 'recorder-core.js', 'export-i18n.js', 'battle-log-core.js', 'diagnostics-core.js', 'annotations-core.js',
  'library-core.js', 'library-store.js', 'card-provider.js', 'recovery-journal.js');
const queues = new Map();
const preparing = new Map();
const tabGames = new Map();
const runOwners = new Map();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const recoveryJournal=globalThis.MSARecoveryJournal?.create();
function trusted(sender) {
  try { return sender.tab && sender.frameId === 0 && new URL(sender.url).origin === 'https://mobilesuitarena.com'; }
  catch (_) { return false; }
}
function senderGameId(sender) {
  if (!trusted(sender)) return null;
  const match = new URL(sender.url).pathname.match(/^\/game\/([^/]+)\/?$/);
  return match && UUID.test(match[1]) ? match[1] : null;
}
function enqueue(key, task) {
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
function extensionSender(sender) {
  try {
    const url = new URL(sender.url);
    return sender.id === chrome.runtime.id && url.protocol === 'chrome-extension:' &&
      url.hostname === chrome.runtime.id && ['/popup.html','/review.html','/library.html'].includes(url.pathname);
  } catch (_) { return false; }
}
function timeout(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('capture-timeout')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function descriptorParts(parts){
  if(!Array.isArray(parts))return undefined;
  return parts.slice(0,12).filter(part=>part&&typeof part.source==='string'&&part.source.length<=300&&
    Array.isArray(part.params)&&part.params.length<=6).map(part=>({code:String(part.code||'').slice(0,60),source:part.source,
      params:part.params.map(value=>typeof value==='number'&&Number.isFinite(value)?value:String(value??'').slice(0,300))}));
}
function invalidObservation(payload,sender){
  const log=payload?.type==='MSA_LOG';
  if(!payload||!['MSA_RECORD','MSA_LOG'].includes(payload.type)||!UUID.test(payload.gameId||'')||!UUID.test(payload.runId||'')||
    senderGameId(sender)!==payload.gameId||
    (payload.sequence!==undefined&&(!Number.isSafeInteger(payload.sequence)||payload.sequence<1))||
    (log?!payload.batch||!Array.isArray(payload.batch.rows)||payload.batch.rows.length>12000||JSON.stringify(payload.batch).length>1500000:
      !payload.snapshot||JSON.stringify(payload.snapshot).length>20000))
    return {ok:false,retryable:false,code:'invalid-record-format',error:'無效的紀錄格式'};
  return null;
}
function summary(session){return {ok:true,id:session.id,snapshotCount:session.snapshots.length,eventCount:session.battleLog?.events?.length||0,coverage:session.battleLog?.coverage||null};}
async function writeObservations(payloads,sender){
  const first=payloads[0],id=first.gameId+'.'+first.runId,key='msa.session.'+id,tabId=sender.tab.id;
  runOwners.set(id,{tabId,documentId:sender.documentId});
  return enqueue(key,async()=>{
    const values=await chrome.storage.local.get([key,'msa.settings']);
    if(values['msa.settings']?.enabled===false)return payloads.map(()=>({ok:true,paused:true}));
    let session=values[key],changed=false;
    const results=[],saved=[];
    for(const payload of payloads){
      const invalid=invalidObservation(payload,sender);
      if(invalid){results.push(invalid);continue;}
      if(payload.gameId!==first.gameId||payload.runId!==first.runId){results.push({ok:false,retryable:false,code:'context-mismatch',error:'對局頁面或記錄段落不符。'});continue;}
      if(session?.captureSource&&(session.captureSource.tabId!==tabId||session.captureSource.documentId!==sender.documentId)){
        results.push({ok:false,retryable:false,code:'source-mismatch',error:'對局頁面或記錄段落不符。'});continue;
      }
      if(session?.playerName&&payload.playerName&&session.playerName!==payload.playerName){results.push({ok:false,retryable:false,code:'player-mismatch',error:'同一紀錄不可混入不同玩家手牌'});continue;}
      // This checkpoint lives in the same atomic storage.set as its snapshots.
      // A lost batch acknowledgement can therefore be retried without replaying
      // an earlier A -> B -> A sequence or duplicating public-log captures.
      if(payload.sequence&&payload.sequence<=(session?.captureWriteSequence||0)){results.push({ok:true});saved.push(payload);continue;}
      const log=payload.type==='MSA_LOG';
      const current=session||MSARecorderCore.createSession({id,gameId:first.gameId,playerName:String(payload.playerName||'').slice(0,100),startedAt:log?payload.batch.observedAt:payload.snapshot.timestamp});
      try{
        const next=log?MSABattleLogCore.ingest(current,payload.batch):MSARecorderCore.appendSnapshot(current,payload.snapshot);
        if(!next.captureSource)next.captureSource={tabId,documentId:sender.documentId};
        if(!next.playerName&&payload.playerName)next.playerName=String(payload.playerName).slice(0,100);
        if(payload.sequence)next.captureWriteSequence=payload.sequence;
        session=next;changed=true;saved.push(payload);results.push({ok:true});
      }catch(error){results.push({ok:false,retryable:false,code:'invalid-record-format',error:String(error.message||'無效的紀錄格式')});}
    }
    if(changed)await chrome.storage.local.set({[key]:session});
    let recoveryCleanupPending=false;
    if(saved.length&&recoveryJournal){try{await recoveryJournal.complete(saved);}catch(_){recoveryCleanupPending=true;}}
    if(session&&saved.length){
      const latest=saved[saved.length-1],eventCount=session.battleLog?.events?.length||0;
      const messageParts=[{code:'saved-hand',source:'已保存 {0} 筆手牌',params:[session.snapshots.length]},
        {code:'saved-log',source:'Log {0} 筆',params:[eventCount]}];
      await enqueue('tab:'+tabId,()=>tabGames.get(tabId)!==first.gameId?undefined:chrome.storage.local.set({['msa.status.'+tabId]:{
        updatedAt:new Date().toISOString(),gameId:first.gameId,runId:first.runId,playerName:session.playerName,
        quality:latest.type==='MSA_LOG'?'public-log':latest.snapshot.quality,messageParts,
        message:`已保存 ${session.snapshots.length} 筆手牌 · Log ${eventCount} 筆`
      }})).catch(()=>{});
    }
    return results.map(result=>result.ok&&session?{...summary(session),recoveryCleanupPending}:result);
  });
}
async function rescueBackup(){
  let persisted={records:[]},journalError='',pageReply=null,pageError='';
  try{if(!recoveryJournal)throw new Error('recovery-unavailable');persisted=await recoveryJournal.backup();}
  catch(error){journalError=String(error.message||error);}
  try{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tabs[0]?.id)throw new Error('no-active-tab');
    pageReply=await timeout(chrome.tabs.sendMessage(tabs[0].id,{type:'MSA_RESCUE_QUERY'},{frameId:0}),5000);
    if(!pageReply?.ok||!Array.isArray(pageReply.backup?.records))throw new Error('no-recovery-page');
  }catch(error){pageError=String(error.message||error);}
  if(journalError&&pageError)return {ok:false,error:'無法讀取持久化救援或原分頁暫存；請保留原分頁並重試。'};
  const groups=new Map();
  for(const record of pageReply?.backup?.records||[]){
    if(!UUID.test(record.gameId||'')||!UUID.test(record.runId||''))continue;
    groups.set(record.gameId+'.'+record.runId,{...record,journal:[]});
  }
  for(const entry of persisted.records){
    const key=entry.gameId+'.'+entry.runId;
    if(!groups.has(key))groups.set(key,{gameId:entry.gameId,runId:entry.runId,playerName:entry.playerName,pending:[],quarantined:[],journal:[]});
    groups.get(key).journal.push(entry);
  }
  return {ok:true,backup:{format:'msa-unsaved-rescue',schemaVersion:2,exportedAt:new Date().toISOString(),records:[...groups.values()],
    limits:globalThis.MSARecoveryJournal?.LIMITS||null,retention:'download-does-not-clear-no-eviction',
    recovery:{available:!journalError,durableRecordCount:persisted.records.length,error:journalError},page:{available:!pageError,error:pageError,scope:'active-tab-only'},
    warning:'持久化救援涵蓋所有記錄頁；頁面記憶體僅來自目前分頁。原件可能已保存，不可自動重播或當作完整對局；其他頁面未確認持久化的暫存須切回原分頁另行下載。'}};
}
async function waitForGameWrites(gameId) {
  while (true) {
    const pending = [...queues].filter(([key]) => key.startsWith(`msa.session.${gameId}.`)).map(([, promise]) => promise);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  }
}
const partial = (gameId, code, reason, extra = {}) => ({ok:true, refreshed:false, partial:true, gameId, code, reason, ...extra});
const cardCache = new Map(), cardPending = new Map();
let cardCacheBytes = 0;
function officialCardCaller(sender) {
  if(extensionSender(sender))return true;
  return Boolean(senderGameId(sender));
}
async function lookupCard(message) {
  const provider=globalThis.MSACardProvider;
  if(!provider)return {status:'error',reason:'卡片資料模組未載入。'};
  const code=provider.normalizeCardCode(message.cardCode),locale=message.locale==='en'?'en':'zh-tw';
  if(!code)return {status:'error',reason:'卡號格式不符。'};
  const key=locale+':'+code,hit=cardCache.get(key);
  if(hit&&Date.now()-hit.at<600000){cardCache.delete(key);cardCache.set(key,hit);return hit.value;}
  if(hit){cardCacheBytes-=hit.bytes;cardCache.delete(key);}
  if(cardPending.has(key))return cardPending.get(key);
  if(cardPending.size>=4)return {status:'error',cardCode:code,reason:'目前查卡請求較多，請稍候再試。'};
  const pending=(async()=>{
    const metadata=await provider.lookupCard(code,{fetch:globalThis.fetch,locale});
    let value={...metadata};
    if(metadata.status==='ok'&&metadata.imageUrl){
      const image=await provider.fetchCardImage(metadata.imageUrl,{fetch:globalThis.fetch,cardCode:code});
      if(image.status==='ok')value.imageDataUrl=image.dataUrl;
      else value.imageReason=image.reason||'卡圖未能載入，文字資料仍可閱讀。';
    }
    if(value.status!=='error'){
      const bytes=JSON.stringify(value).length;
      while(cardCache.size&&(cardCacheBytes+bytes>10*1024*1024||cardCache.size>=80)){
        const oldest=cardCache.keys().next().value;cardCacheBytes-=cardCache.get(oldest).bytes;cardCache.delete(oldest);
      }
      cardCache.set(key,{value,bytes,at:Date.now()});cardCacheBytes+=bytes;
    }
    return value;
  })().catch(error=>({status:'error',cardCode:code,locale,reason:String(error.message||error)}))
    .finally(()=>cardPending.delete(key));
  cardPending.set(key,pending);return pending;
}
async function diagnosticsForActivePage() {
  const extensionVersion=chrome.runtime.getManifest?.().version||MSARecorderCore.VERSION||'';
  let page=null,reason='';
  try{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tabs[0]?.id)throw new Error('目前沒有可檢查的 MSA 對局分頁。');
    page=await timeout(chrome.tabs.sendMessage(tabs[0].id,{type:'MSA_DIAGNOSTICS_QUERY'},{frameId:0}),5000);
    if(page?.connected&&UUID.test(page.gameId||'')&&UUID.test(page.runId||'')){
      try{
        const id=page.gameId+'.'+page.runId,key='msa.session.'+id;
        const stored=(await chrome.storage.local.get(key))[key];
        const valid=stored&&stored.id===id&&stored.gameId===page.gameId&&Array.isArray(stored.snapshots)&&
          (!stored.playerName||stored.playerName===page.playerName)&&stored.captureSource?.tabId===tabs[0].id;
        page={...page,snapshotCount:valid?stored.snapshots.length:0,
          eventCount:valid&&Array.isArray(stored.battleLog?.events)?stored.battleLog.events.length:0,
          publicLogComplete:Boolean(valid&&stored.battleLog?.coverage?.publicLogComplete),
          lastSavedAt:valid?page.lastSavedAt:'',storageCheck:valid?'verified':stored?'mismatch':'missing'};
      }catch(_){page={...page,snapshotCount:0,eventCount:0,publicLogComplete:false,lastSavedAt:'',storageCheck:'error'};}
    }
  }catch(_){reason='目前分頁沒有回應新版記錄器。請切到 MSA 對局頁，更新後重新整理該頁。';}
  return {ok:true,report:MSADiagnosticsCore.report({extensionVersion,page,reason})};
}
async function openLibrary(message,sender) {
  const fromExtension=extensionSender(sender);
  if(!fromExtension&&senderGameId(sender)!==message.gameId)return {ok:false,reason:'不允許的對局來源。'};
  const url=new URL(chrome.runtime.getURL('library.html'));
  if(UUID.test(message.gameId||''))url.searchParams.set('gameId',message.gameId);
  if(UUID.test(message.gameId||'')&&UUID.test(message.runId||''))url.searchParams.set('id',message.gameId+'.'+message.runId);
  if(fromExtension&&typeof message.sessionId==='string'&&message.sessionId.length<200)url.searchParams.set('id',message.sessionId);
  await chrome.tabs.create({url:url.href});return {ok:true,opened:true};
}
async function noteAction(message,sender) {
  const notes=globalThis.MSAAnnotationsCore;
  if(!notes)return {ok:false,reason:'筆記模組尚未載入。'};
  if(message.action==='create'){
    const internal=extensionSender(sender);
    const id=internal?String(message.sourceSessionId||''):`${message.gameId}.${message.runId}`;
    if(!id||id.length>220||(!internal&&(!UUID.test(message.gameId||'')||!UUID.test(message.runId||'')||senderGameId(sender)!==message.gameId)))return {ok:false,reason:'筆記來源不符。'};
    const stored=await chrome.storage.local.get('msa.session.'+id),session=stored['msa.session.'+id];
    if(!session||!Array.isArray(session.snapshots)||session.id!==id||!session.playerName)return {ok:false,reason:'找不到來源相符的本人已存記錄。'};
    if(!internal&&(session.gameId!==message.gameId||session.playerName!==message.playerName||
      session.captureSource?.tabId!==sender.tab.id||session.captureSource?.documentId!==sender.documentId))return {ok:false,reason:'無法核對筆記所屬的玩家與分頁。'};
    const snapshot=session.snapshots.find(item=>item?.id===message.payload?.snapshotId);
    if(!snapshot)return {ok:false,reason:'指定手牌快照尚未存入或已不存在。'};
    const note=notes.create(session,snapshot,message.payload);
    await chrome.storage.local.set({[notes.PREFIX+note.id]:note});return {ok:true,bookmark:note};
  }
  if(!extensionSender(sender)||message.action!=='update')return {ok:false,reason:'只能在本機回顧頁編輯筆記。'};
  const id=String(message.noteId||'');
  if(!UUID.test(id))return {ok:false,reason:'筆記 ID 不符。'};
  const key=notes.PREFIX+id,values=await chrome.storage.local.get(key);
  if(!values[key])return {ok:false,reason:'筆記已不存在。'};
  const updated=notes.update(values[key],message.payload);
  await chrome.storage.local.set({[key]:updated});return {ok:true,bookmark:updated};
}
async function libraryAction(message) {
  const allowed=['previewImport','applyImport','saveDeck','saveMatch','createBackup'];
  if(!allowed.includes(message.action)||!globalThis.MSALibraryStore)return {ok:false,error:'不支援的資料管理操作。'};
  const store=MSALibraryStore.create({storage:chrome.storage.local,withKeyLock:(key,task)=>enqueue(key,task)});
  return store[message.action](message);
}
async function bindLiveDeck(message, sender) {
  const {gameId,runId,playerName,deckVersionId} = message;
  if (message.confirmed !== true || senderGameId(sender) !== gameId ||
      !UUID.test(gameId || '') || !UUID.test(runId || '') ||
      !Number.isInteger(sender.tab?.id) || typeof sender.documentId !== 'string' || !sender.documentId ||
      typeof playerName !== 'string' || !playerName.trim() || playerName.length > 200 ||
      typeof deckVersionId !== 'string' || !deckVersionId || deckVersionId.length > 256) {
    return {ok:false,reason:'請在本場小窗明確確認牌組與本人身分。'};
  }
  if (!globalThis.MSALibraryCore || !globalThis.MSALibraryStore) return {ok:false,reason:'牌組管理模組尚未載入。'};
  const sourceId = gameId + '.' + runId;
  const values = await chrome.storage.local.get(null), source = values['msa.session.' + sourceId];
  if (!source || source.schemaVersion !== 1 || source.id !== sourceId || source.gameId !== gameId ||
      source.playerName !== playerName || !Array.isArray(source.snapshots) || !source.snapshots.length ||
      source.captureSource?.tabId !== sender.tab.id || source.captureSource?.documentId !== sender.documentId) {
    return {ok:false,reason:'找不到與目前玩家、分頁及記錄段落相符的已存手牌。'};
  }
  const deckKey = 'msa.deck.' + deckVersionId, deck = values[deckKey];
  if (!deck || deck.id !== deckVersionId) return {ok:false,reason:'找不到選取的牌組版本，請重新選擇。'};
  MSALibraryCore.validateRecords({[deckKey]:deck});
  const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
  const matches = Object.entries(values).filter(([key, record]) => {
    if (!record || key !== 'msa.match.' + record.id || record.schemaVersion !== 1 ||
        record.gameId !== gameId || record.playerName !== playerName ||
        record.source !== 'manual' || record.identityConfirmed !== true) return false;
    try { MSALibraryCore.validateRecords({[key]:record}); return true; } catch (_) { return false; }
  }).map(([,record]) => record).sort((a,b) => time(b.updatedAt) - time(a.updatedAt) || String(b.id).localeCompare(String(a.id)));
  const existing = matches[0];
  if (existing?.deckVersionId === deckVersionId) return {ok:true,record:existing,existing:true};
  if (existing?.resultConfirmed === true) {
    return {ok:false,reason:'本場已有人工確認結果；如需更換凍結牌組，請到「資料與牌組」核對後修改。'};
  }
  const store = MSALibraryStore.create({storage:chrome.storage.local,withKeyLock:(key,task)=>enqueue(key,task)});
  return store.saveMatch({draft:{sourceSessionId:sourceId,gameId,playerName,identityConfirmed:true,deckVersionId,
    firstPlayer:existing?.firstPlayer || 'unknown',result:existing?.result || 'unknown',
    resultConfirmed:existing?.resultConfirmed === true}});
}
async function showLivePanel() {
  const tabs = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tabs[0]?.id) return {ok:false,reason:'請先切換到 MSA 對局頁面。'};
  try {
    const result = await timeout(chrome.tabs.sendMessage(tabs[0].id, {type:'MSA_LIVE_PANEL_SHOW'}, {frameId:0}), 5000);
    if (!result?.ok || !result.opened || !UUID.test(result.gameId || '')) return {ok:false,reason:result?.reason || '目前分頁沒有可開啟的對戰小窗。'};
    return {ok:true,opened:true,gameId:result.gameId};
  } catch (_) { return {ok:false,reason:'請先切到 MSA 對局頁；更新擴充功能後，請重新整理該分頁。'}; }
}
async function openLiveReview(message, sender) {
  const {gameId,runId} = message;
  if (!UUID.test(gameId || '') || !UUID.test(runId || '') || senderGameId(sender) !== gameId) {
    return {ok:false,reason:'對局頁面或記錄段落不符。'};
  }
  const id = `${gameId}.${runId}`, key = `msa.session.${id}`;
  const values = await chrome.storage.local.get(key);
  const session = values[key], source = session?.captureSource;
  if (!session || session.id !== id || session.gameId !== gameId || !source ||
      source.tabId !== sender.tab.id || source.documentId !== sender.documentId ||
      (message.playerName && session.playerName && message.playerName !== session.playerName)) {
    return {ok:false,reason:'本段尚無可確認來源的已存記錄，請稍後再試。'};
  }
  await chrome.tabs.create({url:chrome.runtime.getURL('review.html') + '?id=' + encodeURIComponent(id)});
  return {ok:true,opened:true,sessionId:id};
}
async function prepareExport(message) {
  const gameId = message.gameId;
  const playerName = String(message.playerName || '').trim();
  if (!UUID.test(gameId || '')) return {ok:false, refreshed:false, partial:true, reason:'無效的對局 ID'};
  const values = await chrome.storage.local.get(null);
  if (values['msa.settings']?.enabled === false) return partial(gameId, 'paused', '記錄已暫停；匯出目前已儲存資料');
  // No tabs/host permission is needed: query only IDs, never URLs. Status is
  // registered by the matching content script and revalidated before any UI use.
  const tabs = await chrome.tabs.query({});
  const openTabs = new Map(tabs.map(tab => [tab.id, tab]));
  const candidates = Object.entries(values).filter(([key, value]) =>
    key.startsWith('msa.status.') && value?.gameId === gameId &&
    (!playerName || !value.playerName || value.playerName === playerName) && openTabs.has(Number(key.slice(11))))
    .map(([key, value]) => ({tab:openTabs.get(Number(key.slice(11))), status:value}))
    .sort((a,b) => Number(Boolean(b.tab.active))-Number(Boolean(a.tab.active)) || String(b.status.updatedAt).localeCompare(String(a.status.updatedAt)));
  if (!candidates.length) return partial(gameId, 'no-matching-tab', '找不到本場已連線頁面；請回到該場頁面，必要時重新整理後重試');
  const attempts = [];
  for (const {tab} of candidates.slice(0,3)) {
    try {
      const result = await timeout(chrome.tabs.sendMessage(tab.id, {
        type:'MSA_CAPTURE_NOW', gameId, playerName, reason:'export', requestId:`${Date.now()}-${tab.id}`
      }, {frameId:0}), 14000);
      if (!result || typeof result.refreshed !== 'boolean' || result.gameId !== gameId) throw new Error('content-version-mismatch');
      await timeout(waitForGameWrites(gameId), 3000);
      attempts.push({tabId:tab.id, code:result.code, refreshed:result.refreshed});
      if (result.refreshed) {
        const saved = await chrome.storage.local.get(null);
        const captureIssues = Object.entries(saved).filter(([key,session]) => key.startsWith('msa.session.') &&
          session?.gameId === gameId && (!playerName || !session.playerName || session.playerName === playerName))
          .flatMap(([,session]) => (session.captureIssues || []).map(issue => ({...issue,sourceSessionId:session.id})));
        return {...result, ok:true, partial:result.partial || captureIssues.length > 0, gameId, attempts,captureIssues,
          reasonParts:[...(result.reasonParts||[{code:result.code||'capture',source:result.reason||'已更新公開 Log',params:[]}]),
            ...(captureIssues.length?[{code:'persisted-capture-gap',source:'既有紀錄含暫存缺口，請查看報告警告',params:[]}]:[])],
          reason:(result.reason || '已更新公開 Log') + (captureIssues.length ? '；既有紀錄含暫存缺口，請查看報告警告' : ''), preparedAt:new Date().toISOString()};
      }
      attempts[attempts.length-1].reason = result.reason;
    } catch (error) {
      const code = String(error.message || error);
      attempts.push({tabId:tab.id, code, refreshed:false, reason:code === 'capture-timeout' ?
        '等待本場收錄逾時；匯出目前已儲存資料' : '無法連線本場記錄器；請重新整理該頁後重試'});
      if (code === 'capture-timeout') break;
    }
  }
  const last = attempts.at(-1);
  return partial(gameId, last?.code || 'capture-failed', last?.reason || '無法更新公開 Log', {attempts, preparedAt:new Date().toISOString()});
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(message?.type==='MSA_CARD_LOOKUP'){
    if(!officialCardCaller(sender)){respond({status:'error',reason:'不允許的查卡來源。'});return false;}
    lookupCard(message).then(respond,error=>respond({status:'error',reason:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_RUN_DIAGNOSTICS'){
    if(!extensionSender(sender)){respond({ok:false,error:'不允許的自檢來源。'});return false;}
    diagnosticsForActivePage().then(respond,error=>respond({ok:false,error:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_GET_RESCUE'){
    if(!extensionSender(sender)){respond({ok:false,error:'不允許的救援備份來源。'});return false;}
    rescueBackup().then(respond,error=>respond({ok:false,error:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_STAGE_RECORD'){
    if(!trusted(sender)||senderGameId(sender)!==message.payload?.gameId){respond({durable:false,error:'recovery-invalid-source'});return false;}
    if(!recoveryJournal){respond({durable:false,error:'recovery-unavailable'});return false;}
    recoveryJournal.stage(message.payload,{tabId:sender.tab.id,documentId:sender.documentId})
      .then(result=>respond({ok:true,...result}),error=>respond({ok:false,durable:false,error:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_RECORD_BATCH'){
    const payloads=message.observations;
    if(!trusted(sender)||!Array.isArray(payloads)||!payloads.length||payloads.length>16||
      !UUID.test(message.gameId||'')||!UUID.test(message.runId||'')||senderGameId(sender)!==message.gameId||
      payloads.some((payload,index)=>!payload||payload.gameId!==message.gameId||payload.runId!==message.runId||
        !Number.isSafeInteger(payload.sequence)||payload.sequence<1||(index&&payload.sequence<=payloads[index-1].sequence))){
      respond({ok:false,error:'無效的紀錄格式'});return false;
    }
    tabGames.set(sender.tab.id,message.gameId);
    writeObservations(payloads,sender).then(results=>respond({ok:true,results}),error=>respond({ok:false,results:payloads.map(()=>({ok:false,error:String(error.message||error)}))}));return true;
  }
  if(message?.type==='MSA_OPEN_LIBRARY'){
    if(!extensionSender(sender)&&!trusted(sender)){respond({ok:false,reason:'不允許的管理入口來源。'});return false;}
    openLibrary(message,sender).then(respond,error=>respond({ok:false,reason:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_NOTE_ACTION'){
    if(!extensionSender(sender)&&!trusted(sender)){respond({ok:false,reason:'不允許的筆記來源。'});return false;}
    enqueue('workspace',()=>noteAction(message,sender)).then(respond,error=>respond({ok:false,reason:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_LIBRARY_ACTION'){
    if(!extensionSender(sender)){respond({ok:false,error:'只能從本機資料管理頁操作。'});return false;}
    enqueue('workspace',()=>libraryAction(message)).then(respond,error=>respond({ok:false,error:String(error.message||error)}));return true;
  }
  if(message?.type==='MSA_BIND_LIVE_DECK'){
    if(!senderGameId(sender)){respond({ok:false,reason:'只能從目前 MSA 對局小窗綁定牌組。'});return false;}
    enqueue('workspace',()=>bindLiveDeck(message,sender)).then(respond,error=>respond({ok:false,reason:String(error.message||error)}));return true;
  }
  if (message?.type === 'MSA_SHOW_LIVE_PANEL') {
    if (!extensionSender(sender)) { respond({ok:false,reason:'不允許的小窗操作來源。'}); return false; }
    showLivePanel().then(respond, error => respond({ok:false,reason:String(error.message || error)}));
    return true;
  }
  if (message?.type === 'MSA_OPEN_LIVE_REVIEW') {
    if (!trusted(sender)) { respond({ok:false,reason:'不允許的對戰來源。'}); return false; }
    openLiveReview(message,sender).then(respond, error => respond({ok:false,reason:String(error.message || error)}));
    return true;
  }
  if (message?.type === 'MSA_PREPARE_EXPORT') {
    if (!extensionSender(sender)) { respond({ok:false, refreshed:false, partial:true, reason:'不允許的匯出來源'}); return false; }
    const key = `${message.gameId}|${String(message.playerName || '').trim()}`;
    let pending = preparing.get(key);
    if (!pending) {
      pending = prepareExport(message);
      preparing.set(key, pending);
      pending.finally(() => { if (preparing.get(key) === pending) preparing.delete(key); }).catch(() => {});
    }
    pending.then(respond, error => respond(partial(message.gameId, 'prepare-failed', String(error.message || error))));
    return true;
  }
  if (!trusted(sender) || !message || !['MSA_RECORD', 'MSA_LOG', 'MSA_STATUS','MSA_CAPTURE_GAP'].includes(message.type)) return false;
  const tabId = sender.tab.id;
  const statusKey = `msa.status.${tabId}`;
  const senderGame = senderGameId(sender);
  if (message.type === 'MSA_CAPTURE_GAP') {
    const id = `${message.gameId}.${message.runId}`, key = `msa.session.${id}`;
    const owner = runOwners.get(id);
    if (owner && (owner.tabId !== tabId || owner.documentId !== sender.documentId)) {
      respond({ok:false,error:'無法確認舊紀錄來源'}); return false;
    }
    enqueue(key, async () => {
      const values = await chrome.storage.local.get([key]);
      if (!values[key]) return {ok:false,error:'舊紀錄尚未建立'};
      const session = values[key];
      const source = owner || session.captureSource;
      if (!source || source.tabId !== tabId || source.documentId !== sender.documentId) return {ok:false,error:'無法確認舊紀錄來源'};
      const overflow = message.issue?.code === 'buffer-full', rejected = message.issue?.code === 'record-rejected';
      const issue = {code:rejected ? 'record-rejected' : overflow ? 'buffer-full' : 'context-changed-pending',observedAt:new Date().toISOString(),
        pendingCount:Math.max(1,Math.min(512,Number(message.issue?.pendingCount) || 1)),
        reason:rejected ? '部分觀察格式被拒絕，已隔離原件；有效觀察繼續保存，請在原分頁下載救援備份' : overflow ? '暫存已滿，部分已觀察狀態未能排入儲存佇列' : '頁面或記錄設定切換時仍有觀察尚未確認存妥；舊暫存已隔離，未送往其他對局'};
      session.captureIssues = [...(session.captureIssues || []),issue];
      await chrome.storage.local.set({[key]:session}); return {ok:true};
    }).then(respond,error => respond({ok:false,error:error.message}));
    return true;
  }
  const previousGame = tabGames.get(tabId);
  if (previousGame !== senderGame) tabGames.set(tabId, senderGame);
  if (message.type === 'MSA_STATUS') {
    const status = message.status || {};
    if (!UUID.test(status.gameId || '') || status.gameId !== senderGame) { respond({ok:false,error:'對局頁面不符'}); return false; }
    enqueue(`tab:${tabId}`, () => tabGames.get(tabId) !== senderGame ? undefined : chrome.storage.local.set({[statusKey]: {
      updatedAt: new Date().toISOString(), message: String(status.message || '').slice(0, 300),
      quality: String(status.quality || 'unavailable').slice(0, 30),
      version:String(status.version||'').slice(0,30),runId:UUID.test(status.runId||'')?status.runId:'',
      pendingCount:Math.max(0,Math.min(512,Number(status.pendingCount)||0)),lastSavedAt:String(status.lastSavedAt||'').slice(0,40),
      quarantinedCount:Math.max(0,Math.min(512,Number(status.quarantinedCount)||0)),messageParts:descriptorParts(status.messageParts),
      recovery:status.recovery&&{durableCount:Math.max(0,Math.min(512,Number(status.recovery.durableCount)||0)),
        pendingCount:Math.max(0,Math.min(512,Number(status.recovery.pendingCount)||0)),unprotectedCount:Math.max(0,Math.min(512,Number(status.recovery.unprotectedCount)||0)),
        error:String(status.recovery.error||'').slice(0,100)},
      gameId: String(status.gameId || '').slice(0, 40), playerName: String(status.playerName || '').slice(0, 100)
    }})).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
    return true;
  }
  const invalid=invalidObservation(message,sender);
  if(invalid){respond(invalid);return false;}
  writeObservations([message],sender).then(results=>respond(results[0]),error=>respond({ok:false,error:String(error.message||'儲存失敗')}));
  return true;
});
