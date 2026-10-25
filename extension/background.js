'use strict';
importScripts('recorder-core.js', 'battle-log-core.js');
const queues = new Map();
const preparing = new Map();
const tabGames = new Map();
const runOwners = new Map();
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function trusted(sender) {
  try { return sender.tab && sender.frameId === 0 && new URL(sender.url).origin === 'https://mobilesuitarena.com'; }
  catch (_) { return false; }
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
      url.hostname === chrome.runtime.id && ['/popup.html','/review.html'].includes(url.pathname);
  } catch (_) { return false; }
}
function timeout(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('capture-timeout')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
async function waitForGameWrites(gameId) {
  while (true) {
    const pending = [...queues].filter(([key]) => key.startsWith(`msa.session.${gameId}.`)).map(([, promise]) => promise);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  }
}
const partial = (gameId, code, reason, extra = {}) => ({ok:true, refreshed:false, partial:true, gameId, code, reason, ...extra});
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
  if (!UUID.test(gameId || '') || !UUID.test(runId || '') || new URL(sender.url).pathname.split('/')[2] !== gameId) {
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
  const senderGame = new URL(sender.url).pathname.split('/')[2];
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
      const overflow = message.issue?.code === 'buffer-full';
      const issue = {code:overflow ? 'buffer-full' : 'context-changed-pending',observedAt:new Date().toISOString(),
        pendingCount:Math.max(1,Math.min(512,Number(message.issue?.pendingCount) || 1)),
        reason:overflow ? '暫存已滿，部分已觀察狀態未能排入儲存佇列' : '頁面或記錄設定切換時仍有觀察尚未確認存妥；舊暫存已隔離，未送往其他對局'};
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
      gameId: String(status.gameId || '').slice(0, 40), playerName: String(status.playerName || '').slice(0, 100)
    }})).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
    return true;
  }
  const {gameId, runId, playerName, snapshot, batch} = message;
  const isLog = message.type === 'MSA_LOG';
  if (!UUID.test(gameId || '') || !UUID.test(runId || '') ||
      new URL(sender.url).pathname.split('/')[2] !== gameId ||
      (isLog ? !batch || !Array.isArray(batch.rows) || batch.rows.length > 12000 || JSON.stringify(batch).length > 1500000 :
        !snapshot || JSON.stringify(snapshot).length > 20000)) {
    respond({ok:false,error:'無效的紀錄格式'}); return false;
  }
  const id = `${gameId}.${runId}`;
  runOwners.set(id,{tabId,documentId:sender.documentId});
  const key = `msa.session.${id}`;
  enqueue(key, async () => {
    const values = await chrome.storage.local.get([key, 'msa.settings']);
    if (values['msa.settings']?.enabled === false) return {ok:true,paused:true};
    const existing = values[key] || MSARecorderCore.createSession({id,gameId,playerName:String(playerName || '').slice(0,100),startedAt:isLog ? batch.observedAt : snapshot.timestamp});
    if (!existing.captureSource) existing.captureSource = {tabId,documentId:sender.documentId};
    if (existing.playerName && playerName && existing.playerName !== playerName) throw new Error('同一紀錄不可混入不同玩家手牌');
    // A public-log-only capture can precede the first visible own hand.
    if (!existing.playerName && playerName) existing.playerName=String(playerName).slice(0,100);
    const session = isLog ? MSABattleLogCore.ingest(existing,batch) : MSARecorderCore.appendSnapshot(existing,snapshot);
    const eventCount=session.battleLog?.events?.length || 0;
    await chrome.storage.local.set({[key]:session});
    // A delayed old-page write must not overwrite the new page's registration.
    await enqueue(`tab:${tabId}`, () => tabGames.get(tabId) !== gameId ? undefined : chrome.storage.local.set({[statusKey]:{
      updatedAt:new Date().toISOString(),gameId,playerName:session.playerName,quality:isLog ? 'public-log' : snapshot.quality,
      message:isLog ? `已儲存 ${eventCount} 筆公開 Log · ${session.snapshots.length} 筆手牌` :
        `已儲存 ${session.snapshots.length} 筆手牌；${snapshot.turn === null ? '觀察回合 '+snapshot.observedTurn : (snapshot.turnSource==='log'?'T':'推計 T')+snapshot.turn} · Log ${eventCount} 筆`
    }})).catch(() => {});
    return {ok:true,id,snapshotCount:session.snapshots.length,eventCount,coverage:session.battleLog?.coverage || null};
  }).then(respond,error=>respond({ok:false,error:error.message || '儲存失敗'}));
  return true;
});
