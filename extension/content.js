(function () {
  'use strict';
  const defaults = {enabled:true,playerName:'',handSide:'auto',autoCollectLog:true};
  let settings = {...defaults}, ready = false, current = null, sampling = false;
  let badge, badgeText, interactionVersion = 0, lastInteractionAt = 0, pointerDown = false, activeCapture = null;
  let livePanelController = null;
  const contexts = new Map();
  const gameId = () => location.pathname.match(/^\/game\/([a-f0-9-]{36})(?:\/|$)/i)?.[1] || null;
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const sameContext = ctx => current === ctx && gameId() === ctx.gameId;
  const observationSignature = snapshot => globalThis.MSADiagnosticsCore?.signature(snapshot) || JSON.stringify({...snapshot,timestamp:undefined});
  function refreshHealth(ctx) {
    if (!ctx || !globalThis.MSADiagnosticsCore) return;
    ctx.healthAlerts = MSADiagnosticsCore.alerts({enabled:settings.enabled,writeError:ctx.writeError || (ctx.connectionError?'記錄器連線中斷':''),
      writeErrorSince:ctx.writeErrorSince || ctx.connectionErrorSince,changedAt:ctx.changedAt,
      observedSignature:ctx.observedSignature,savedSignature:ctx.savedSignature,handExpected:ctx.handExpected,
      startedAt:ctx.handExpectedAt,snapshotCount:ctx.snapshotCount,eventCount:ctx.eventCount,
      endObservedAt:ctx.endObservedAt,publicLogComplete:ctx.coverage?.publicLogComplete,dismissed:ctx.healthDismissed},Date.now());
    ctx.healthSignature = JSON.stringify(ctx.healthAlerts);
  }
  function syncLivePanel() {
    if (!ready || !globalThis.MSALivePanelController || !globalThis.MSALivePanelCore || !globalThis.MSALivePanelUI) return false;
    try {
      if (!livePanelController) livePanelController = MSALivePanelController.create({
        storage:chrome.storage,
        getContext:() => current && sameContext(current) ? {
          gameId:current.gameId,runId:current.runId,playerName:current.playerName,
          enabled:settings.enabled,pendingCount:current.writer.state().pendingCount,
          writeError:current.writeError || (current.connectionError ? '記錄器連線中斷，請重新整理此頁' : ''),
          captureNote:current.captureNote,statusMessage:current.statusMessage || '',quality:current.lastQuality
          ,healthAlerts:current.healthAlerts || [],endObserved:Boolean(current.endObservedAt)
        } : null,
        project:MSALivePanelCore.project,
        createUI:MSALivePanelUI.create,
        onCapture:async requested => {
          const ctx = current;
          if (!ctx || !sameContext(ctx) || ctx.runId !== requested.runId) return {ok:false,refreshed:false,reason:'對局已切換。'};
          // An explicit panel click is still trusted player input. Wait for the
          // normal idle guard instead of bypassing input/dialog protections.
          await sleep(900);
          if (!sameContext(ctx) || ctx.runId !== requested.runId || ctx.playerName !== requested.playerName) return {ok:false,refreshed:false,reason:'對局或玩家已切換，請重新操作。'};
          return requestCapture(ctx,{reason:'live-panel',playerName:ctx.playerName});
        },
        onReview:requested => chrome.runtime.sendMessage({type:'MSA_OPEN_LIVE_REVIEW',
          gameId:requested.gameId,runId:requested.runId,playerName:requested.playerName}),
        onBookmark:(requested,payload) => chrome.runtime.sendMessage({type:'MSA_NOTE_ACTION',action:'create',
          gameId:requested.gameId,runId:requested.runId,playerName:requested.playerName,payload}),
        onCardLookup:cardCode => chrome.runtime.sendMessage({type:'MSA_CARD_LOOKUP',cardCode,locale:'zh-tw'}),
        onManage:requested => chrome.runtime.sendMessage({type:'MSA_OPEN_LIBRARY',gameId:requested.gameId,
          runId:requested.runId,playerName:requested.playerName}),
        onDismissAlert:(requested,code) => {
          if(!current || !sameContext(current) || current.runId!==requested.runId)return {ok:false,reason:'對局已切換。'};
          const alert=current.healthAlerts?.find(item=>item.code===code);
          if(alert){current.healthDismissed[code]=alert.observedAt;refreshHealth(current);publish(current,'已確認記錄提醒');}
          return {ok:true};
        }
      });
      livePanelController.sync();
      badge?.remove();
      return true;
    } catch (_) { return false; }
  }
  function mountBadge() {
    if (badge?.isConnected) return;
    badge = document.createElement('div'); badge.id = 'msa-hand-recorder-indicator';
    const shadow = badge.attachShadow({mode:'closed'}), style = document.createElement('style');
    style.textContent = ':host{position:fixed;right:8px;top:8px;z-index:2147483646;pointer-events:none}span{display:block;max-width:300px;padding:5px 9px;border:1px solid #466059;border-radius:8px;background:#0b1f20ec;color:#d9f5eb;font:11px/1.5 system-ui,sans-serif;box-shadow:0 2px 8px #0003}';
    badgeText = document.createElement('span'); shadow.append(style,badgeText); document.documentElement.append(badge);
  }
  function publish(ctx, message, quality = ctx?.lastQuality || 'unavailable') {
    if (!ctx || !sameContext(ctx)) return;
    const pending = ctx.writer.state().pendingCount;
    const text = `${message} · Log ${ctx.eventCount} 筆${pending ? ` · 待存 ${pending} 筆` : ''}${ctx.writeError ? ` · 儲存失敗：${ctx.writeError}` : ''}${ctx.captureNote ? ` · ${ctx.captureNote}` : ''}`;
    refreshHealth(ctx);
    const signature = `${text}|${quality}|${ctx.playerName}|${ctx.healthSignature || ''}`;
    if (signature === ctx.statusSignature) return;
    ctx.statusSignature = signature; ctx.statusMessage = text;
    if (!syncLivePanel()) { mountBadge(); badgeText.textContent = `🃏 ${text}`; }
    chrome.runtime.sendMessage({type:'MSA_STATUS',status:{message:text,quality,gameId:ctx.gameId,playerName:ctx.playerName,
      version:globalThis.MSARecorderCore?.VERSION || '',runId:ctx.runId,pendingCount:pending,lastSavedAt:ctx.lastSavedAt || ''}})
      .catch(() => {
        if (!sameContext(ctx)) return;
        if(!ctx.connectionError)ctx.connectionErrorSince=Date.now();ctx.connectionError = true;refreshHealth(ctx);
        if (!syncLivePanel()) { mountBadge(); badgeText.textContent = '🃏 記錄器連線中斷，請重新整理此頁'; }
      });
  }
  const createWriter = () => MSACaptureCoordinator.createWriteQueue({
    write: payload => chrome.runtime.sendMessage(payload),
    onResult(payload,result) {
      const ctx = contexts.get(payload.runId); if (!ctx) return;
      ctx.snapshotCount = result.snapshotCount || 0; ctx.eventCount = result.eventCount || 0;
      if (result.coverage) ctx.coverage = result.coverage;
      if (result.id) ctx.sessionIds.add(result.id);
      if(payload.type==='MSA_RECORD'){ctx.savedSignature=observationSignature(payload.snapshot);ctx.lastSavedAt=new Date().toISOString();}
      ctx.writeError = ''; ctx.writeErrorSince=0;ctx.connectionError = false; publish(ctx, `已保存 ${ctx.snapshotCount} 筆手牌`);
      if (ctx.rejectedCount > ctx.persistedRejectedCount && !ctx.persistingGap) persistOverflow(ctx);
    },
    onError(payload,error) {
      const ctx = contexts.get(payload.runId); if (!ctx) return;
      const nextError=String(error.message || error).slice(0,80);
      if(ctx.writeError!==nextError)ctx.writeErrorSince=Date.now();
      ctx.writeError = nextError; publish(ctx, '暫存保留，稍後重試');
    }
  });
  function reset(id) {
    if (current) {
      const previous = current, pending = previous.writer.suspend('game-navigation');
      if (pending.pendingCount) {
        // Keep the old queue quarantined in memory, never send it with the new
        // page's identity, and persist a warning on its original session.
        chrome.runtime.sendMessage({type:'MSA_CAPTURE_GAP',gameId:previous.gameId,runId:previous.runId,
          issue:{code:'navigation-pending',observedAt:new Date().toISOString(),pendingCount:pending.pendingCount,
            reason:'頁面／設定切換時仍有觀察尚未確認存妥；已隔離舊暫存'}})
          .then(result => { if (!result?.ok && current) { current.captureNote = '舊段暫存缺口未能寫入，請保留此頁'; publish(current,'記錄有缺口'); } })
          .catch(() => { if (current) { current.captureNote = '舊段暫存缺口未能寫入，請保留此頁'; publish(current,'記錄有缺口'); } });
      }
    }
    if (!id) { current = null; badge?.remove(); livePanelController?.sync(); return null; }
    const ctx = {gameId:id,runId:crypto.randomUUID(),lockedSide:null,observedTurn:0,activeSide:null,anchor:null,lastLogTurn:null,
      handSignature:'',logSignature:'',lastLogScan:0,started:false,endedAt:null,handEnded:false,playerName:'',
      snapshotCount:0,eventCount:0,lastQuality:'unavailable',sessionIds:new Set(),coverage:null,statusSignature:'',
      captureNote:'',writeError:'',healthAlerts:[],healthDismissed:{},healthSignature:'',writeErrorSince:0,
      changedAt:0,observedSignature:'',savedSignature:'',lastSavedAt:'',handExpected:false,handExpectedAt:0,endObservedAt:0,
      rejectedCount:0,persistedRejectedCount:0,persistingGap:false,nextGapAttemptAt:0,lastRejectedSignature:'',autoStartDone:false,autoEndDone:false,autoAttempts:{start:0,end:0},nextAutoAt:0,writer:createWriter()};
    current = ctx; contexts.set(ctx.runId,ctx); publish(ctx, '已連線，等待可見手牌／公開 Log'); return ctx;
  }
  function enqueue(ctx,type,data) {
    const result = ctx.writer.enqueue({type,gameId:ctx.gameId,runId:ctx.runId,playerName:ctx.playerName || settings.playerName.trim(),...data});
    if (!result.accepted) {
      const signature = JSON.stringify(type === 'MSA_RECORD' ? {...data.snapshot,timestamp:undefined} : {...data.batch,observedAt:undefined});
      if (signature !== ctx.lastRejectedSignature) { ctx.rejectedCount += 1; ctx.lastRejectedSignature = signature; }
      if (!ctx.persistingGap) persistOverflow(ctx);
      publish(ctx,'暫存已滿；部分觀察未存，請先匯出');
    }
    return result.accepted;
  }
  function persistOverflow(ctx) {
    if (ctx.rejectedCount <= ctx.persistedRejectedCount || Date.now() < ctx.nextGapAttemptAt) return;
    const count = ctx.rejectedCount, difference = count-ctx.persistedRejectedCount;
    ctx.persistingGap = true; ctx.nextGapAttemptAt = Date.now()+2000;
    chrome.runtime.sendMessage({type:'MSA_CAPTURE_GAP',gameId:ctx.gameId,runId:ctx.runId,issue:{code:'buffer-full',pendingCount:difference}})
      .then(result => { if (result?.ok) ctx.persistedRejectedCount = count; })
      .catch(() => {}).finally(() => { ctx.persistingGap = false; });
  }
  function updateTurn(ctx,view) {
    if (view.activeSide && view.activeSide !== ctx.activeSide) {
      ctx.observedTurn = ctx.activeSide ? ctx.observedTurn + 1 : Math.max(1,ctx.observedTurn); ctx.activeSide = view.activeSide;
    }
    if (view.logTurn && view.logTurn !== ctx.lastLogTurn) {
      ctx.observedTurn = Math.max(1,ctx.observedTurn); ctx.anchor = {turn:view.logTurn,observedTurn:ctx.observedTurn}; ctx.lastLogTurn = view.logTurn;
    }
  }
  function captureHand(ctx,view) {
    if (view.ended && !ctx.started) return;
    if (view.ended && ctx.endedAt === null) ctx.endedAt = Date.now();
    const hand = MSARecorderDOM.selectHand(view,settings,ctx.lockedSide);
    ctx.handExpected=Boolean(hand?.playerName&&hand.knownCount>0);
    if(ctx.handExpected&&!ctx.handExpectedAt)ctx.handExpectedAt=Date.now();
    if (hand?.playerName && ctx.playerName && hand.playerName !== ctx.playerName) { publish(ctx,'玩家身分已改變，停止混入此段'); return; }
    if (!ctx.started && (!hand || hand.animating || hand.quality !== 'complete' || (!hand.knownCount && !settings.playerName))) return;
    const turn = ctx.anchor ? ctx.anchor.turn + ctx.observedTurn - ctx.anchor.observedTurn : null;
    const quality = hand?.animating && hand.quality === 'complete' ? 'partial' : hand?.quality || 'unavailable';
    const snapshot = {timestamp:new Date().toISOString(),turn,
      turnSource:turn !== null && view.logTurn === turn ? 'log' : ctx.observedTurn ? 'phase-observed' : 'unknown',
      observedTurn:Math.max(1,ctx.observedTurn),activePlayer:view.activePlayer,phase:view.phase || '',
      hand:hand?.hand || [],expectedCount:hand?.expectedCount ?? null,unknownCount:hand?.unknownCount ?? null,quality,
      reason:hand?.animating ? 'animation-observed' : !hand ? 'hand-container-missing' : view.ended ? 'game-ended' : hand.reason,
      resources:hand?.resources || null};
    const signature = JSON.stringify({...snapshot,timestamp:undefined});
    const observed=observationSignature(snapshot);
    if(observed!==ctx.observedSignature){ctx.observedSignature=observed;ctx.changedAt=Date.now();}
    if (signature !== ctx.handSignature) {
      if (!ctx.lockedSide && hand?.quality === 'complete' && hand.knownCount > 0 && !hand.animating) ctx.lockedSide = hand.side;
      if (hand?.playerName) ctx.playerName = hand.playerName;
      if (enqueue(ctx,'MSA_RECORD',{snapshot})) { ctx.handSignature = signature; ctx.started = true; ctx.lastQuality = quality; }
    }
  }
  function captureLog(ctx,view,force = false) {
    if (!force && Date.now()-ctx.lastLogScan < 500) return null;
    ctx.lastLogScan = Date.now();
    const batch = MSARecorderDOM.readBattleLog(document);
    if (!batch?.rows?.length) return batch;
    const signature = JSON.stringify({...batch,observedAt:undefined});
    if (signature !== ctx.logSignature) {
      const own = MSARecorderDOM.selectHand(view,settings,ctx.lockedSide);
      if (!ctx.playerName && !view.ended && own?.quality === 'complete' && own.knownCount > 0) ctx.playerName = own.playerName;
      if (enqueue(ctx,'MSA_LOG',{batch})) ctx.logSignature = signature;
    }
    return batch;
  }
  function inputBusy() {
    let element = document.activeElement;
    while(element?.shadowRoot?.activeElement)element=element.shadowRoot.activeElement;
    return pointerDown || Date.now()-lastInteractionAt < 800 || Boolean(element && (
      /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName || '') || element.isContentEditable || element.closest?.('[contenteditable="true"]')));
  }
  function sample(options = {}) {
    if (sampling) return;
    sampling = true;
    try {
      const id = gameId(); if (!id) { reset(null); return; }
      if (current?.gameId !== id) reset(id);
      const ctx = current;
      if (!ready) return;
      if (!settings.enabled) { publish(ctx,'已暫停；恢復後會建立新紀錄'); return; }
      const view = MSARecorderDOM.readDocument(document);
      if(view.ended&&!ctx.endObservedAt)ctx.endObservedAt=Date.now();
      if(!view.ended)ctx.endObservedAt=0;
      updateTurn(ctx,view); captureHand(ctx,view); captureLog(ctx,view,options.forceLog);
      void ctx.writer.retry();
      publish(ctx,ctx.started ? `已保存 ${ctx.snapshotCount} 筆手牌` : view.ended ? '已結束；可收錄公開 Log，無法補回手牌' : '等待自己的可見手牌');
      if (!options.skipAuto) scheduleAuto(ctx,view);
    } catch (error) { publish(current,`觀察失敗：${String(error.message || error).slice(0,100)}`); }
    finally { sampling = false; }
  }
  const reasons = {
    captured:'已更新可見公開 Log；完整範圍依覆蓋標記判定',paused:'記錄已暫停',
    'game-changed':'頁面已切換對局，未繼續操作','player-mismatch':'本頁玩家與匯出玩家不符',
    'input-busy':'玩家正在操作或輸入；請停止操作後再更新',
    'action-in-progress':'正在攻擊／選擇動作；請回主階段後再更新',
    'control-unavailable':'找不到已驗證的 Battle Log 控制項，請手動開啟 L 後重試',
    'another-dialog-open':'其他視窗開啟中，未操作 Battle Log',
    'user-interacted':'收錄期間偵測到操作，已停止自動控制',
    'log-unavailable':'未讀到可見公開 Log，請手動開啟 L 後重試',
    'log-unstable':'公開 Log 仍在更新，這次範圍尚未確認',
    'end-marker-missing':'尚未讀到 Game ended!，不能確認結尾完整',
    'storage-pending':'暫存尚未全部寫入；本次只能匯出已存資料'
  };
  async function performCapture(ctx,request) {
    let code = '', captured = false, settled = false, observedRows = 0, lastBatch = null;
    let opened = false, ownedClose = null, restored = true;
    const version = interactionVersion;
    const initialControls = MSARecorderDOM.getBattleLogControls(document);
    const initiallyOpen = initialControls.isOpen;
    const contextValid = () => sameContext(ctx) && settings.enabled;
    let requireEnd = request.reason === 'end';
    try {
      if (!contextValid()) code = settings.enabled ? 'game-changed' : 'paused';
      else if (request.playerName && ctx.playerName && request.playerName !== ctx.playerName) code = 'player-mismatch';
      if (!code) {
        const view = MSARecorderDOM.readDocument(document); requireEnd ||= view.ended;
        if (!initiallyOpen) {
          if (inputBusy()) code = 'input-busy';
          else if (initialControls.blockedReason) code = initialControls.blockedReason === 'another-dialog-open' ? 'another-dialog-open' : 'control-unavailable';
          else if (!view.ended && /BATTLE|ATTACK|ACTION|BLOCK|DAMAGE|SELECT|CHOOSE/i.test(view.phase || '')) code = 'action-in-progress';
          else if (!initialControls.openButton) code = 'control-unavailable';
          else { initialControls.openButton.click(); opened = true; restored = false; }
        }
      }
      if (!code) {
        let previousSignature = '', stableSince = Date.now();
        const deadline = Date.now() + (requireEnd ? 4500 : 3200);
        while (Date.now() < deadline) {
          if (!contextValid()) { code = settings.enabled ? 'game-changed' : 'paused'; break; }
          if (opened && interactionVersion !== version) { code = 'user-interacted'; break; }
          const controls = MSARecorderDOM.getBattleLogControls(document);
          if (opened && controls.isOpen && !ownedClose) ownedClose = controls.closeButton;
          if (opened && controls.blockedReason === 'another-dialog-open') { code = 'another-dialog-open'; break; }
          const view = MSARecorderDOM.readDocument(document);
          updateTurn(ctx,view); captureHand(ctx,view);
          const batch = captureLog(ctx,view,true);
          if (batch?.rows?.length) {
            captured = true; observedRows = batch.rows.length; lastBatch = batch;
            const signature = JSON.stringify({...batch,observedAt:undefined});
            if (signature !== previousSignature) { previousSignature = signature; stableSince = Date.now(); }
            if (Date.now()-stableSince >= 300 && (!requireEnd || batch.ended)) { settled = true; break; }
          }
          await sleep(100);
        }
        if (!code && !captured) code = 'log-unavailable';
        else if (!code && requireEnd && !lastBatch?.ended) code = 'end-marker-missing';
        else if (!code && !settled) code = 'log-unstable';
      }
    } finally {
      // Only close the exact drawer opened by this operation. User input, a
      // replaced dialog, navigation or a pause revokes that ownership.
      if (opened && sameContext(ctx)) {
        const controls = MSARecorderDOM.getBattleLogControls(document);
        if (!controls.isOpen) restored = true;
        else if (settings.enabled && interactionVersion === version && !controls.blockedReason && ownedClose && controls.closeButton === ownedClose && ownedClose.isConnected !== false) {
          ownedClose.click();
          const closeDeadline = Date.now()+800;
          do {
            await sleep(80);
            if (!sameContext(ctx) || !settings.enabled || interactionVersion !== version) break;
            restored = !MSARecorderDOM.getBattleLogControls(document).isOpen;
          } while (!restored && Date.now() < closeDeadline);
        }
      }
    }
    const flush = await ctx.writer.flush(6500);
    if (!flush.ok) code = 'storage-pending';
    if (!code) code = 'captured';
    const result = {ok:true,gameId:ctx.gameId,runId:ctx.runId,refreshed:captured && flush.ok,
      partial:!ctx.coverage?.publicLogComplete || !settled || !flush.ok || !restored || ctx.rejectedCount > 0 || code !== 'captured',
      code,reason:reasons[code] || code,observedRows,restored,initiallyOpen,pendingCount:flush.pendingCount,
      unbufferedObservationCount:ctx.rejectedCount,sessionIds:[...ctx.sessionIds],coverage:ctx.coverage,
      capturedAt:new Date().toISOString()};
    if (!restored) result.reason += '；自動開啟的視窗未恢復（操作權已改變）';
    if (ctx.rejectedCount) result.reason += `；暫存滿時有 ${ctx.rejectedCount} 筆觀察未保存`;
    if (sameContext(ctx)) { ctx.captureNote = result.reason; publish(ctx,`已保存 ${ctx.snapshotCount} 筆手牌`); }
    return result;
  }
  function requestCapture(ctx,request) {
    if (request.playerName && ctx.playerName && request.playerName !== ctx.playerName) {
      return Promise.resolve({ok:true,refreshed:false,partial:true,gameId:ctx.gameId,code:'player-mismatch',reason:reasons['player-mismatch']});
    }
    if (activeCapture) {
      if (activeCapture.ctx === ctx && activeCapture.reason === request.reason) return activeCapture.promise;
      return activeCapture.promise.catch(() => {}).then(() => requestCapture(ctx,request));
    }
    const operation = {ctx,reason:request.reason,promise:null};
    operation.promise = performCapture(ctx,request).finally(() => { if (activeCapture === operation) activeCapture = null; });
    activeCapture = operation; return operation.promise;
  }
  function scheduleAuto(ctx,view) {
    if (!settings.autoCollectLog || activeCapture || Date.now() < ctx.nextAutoAt || inputBusy()) return;
    const kind = view.ended && !ctx.autoEndDone ? 'end' : !view.ended && ctx.started && view.activeSide && !ctx.autoStartDone ? 'start' : null;
    if (!kind || ctx.autoAttempts[kind] >= 3) return;
    const controls = MSARecorderDOM.getBattleLogControls(document);
    // Transient interaction/dialog states do not consume the bounded attempts.
    if (!controls.isOpen && (controls.blockedReason === 'another-dialog-open' || /BATTLE|ATTACK|ACTION|BLOCK|DAMAGE|SELECT|CHOOSE/i.test(view.phase || ''))) return;
    ctx.autoAttempts[kind] += 1; ctx.nextAutoAt = Date.now() + 6000;
    requestCapture(ctx,{reason:kind,playerName:ctx.playerName}).then(result => {
      if (kind === 'end' && result.refreshed && result.coverage?.gameEnded) ctx.autoEndDone = true;
      if (kind === 'start' && result.refreshed && ctx.lastLogTurn) ctx.autoStartDone = true;
      ctx.nextAutoAt = Date.now() + 6000;
    }).catch(error => { ctx.captureNote = String(error.message || error); ctx.nextAutoAt = Date.now() + 6000; });
  }
  function interacted(event) {
    if (event.isTrusted === false) return;
    interactionVersion += 1; lastInteractionAt = Date.now();
    if (event.type === 'pointerdown') pointerDown = true;
    if (event.type === 'pointerup' || event.type === 'pointercancel') pointerDown = false;
  }
  for (const name of ['pointerdown','pointerup','pointercancel','keydown','input','wheel']) document.addEventListener(name,interacted,{capture:true,passive:true});
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if(message?.type==='MSA_DIAGNOSTICS_QUERY'){
      if(!chrome.runtime.id||sender?.id!==chrome.runtime.id)return false;
      sample({skipAuto:true});
      const ctx=current;
      respond({connected:Boolean(ctx&&sameContext(ctx)),version:globalThis.MSARecorderCore?.VERSION || '',
        ready,enabled:settings.enabled,gameId:gameId(),runId:ctx?.runId || '',playerName:ctx?.playerName || '',
        pendingCount:ctx?.writer.state().pendingCount || 0,writeError:ctx?.writeError || (ctx?.connectionError?'記錄器連線中斷':''),quality:ctx?.lastQuality || 'unavailable',
        snapshotCount:ctx?.snapshotCount || 0,eventCount:ctx?.eventCount || 0,lastSavedAt:ctx?.lastSavedAt || '',
        publicLogComplete:Boolean(ctx?.coverage?.publicLogComplete),healthAlerts:ctx?.healthAlerts || []});
      return false;
    }
    if (message?.type === 'MSA_LIVE_PANEL_SHOW') {
      if (!chrome.runtime.id || sender?.id !== chrome.runtime.id) return false;
      const id = gameId();
      if (!id || (message.gameId && message.gameId !== id)) { respond({ok:false,reason:'請先切換到 MSA 對局頁面。'}); return false; }
      if (!ready) { respond({ok:false,reason:'記錄器設定載入中，請稍後再試。'}); return false; }
      if (current?.gameId !== id) reset(id);
      if (!syncLivePanel()) { respond({ok:false,reason:'小窗模組尚未載入，請在更新後重新整理 MSA 分頁。'}); return false; }
      respond(livePanelController.show());
      return false;
    }
    if (message?.type !== 'MSA_CAPTURE_NOW') return false;
    if (sender?.id && chrome.runtime.id && sender.id !== chrome.runtime.id) return false;
    if (!ready) { respond({ok:true,refreshed:false,partial:true,gameId:gameId(),code:'settings-loading',reason:'記錄器設定載入中，請稍後重試'}); return false; }
    if (message.gameId !== gameId()) { respond({ok:true,refreshed:false,partial:true,gameId:gameId(),code:'game-changed',reason:reasons['game-changed']}); return false; }
    if (current?.gameId !== message.gameId) reset(message.gameId);
    requestCapture(current,{reason:message.reason || 'export',playerName:String(message.playerName || '').trim()})
      .then(respond,error => respond({ok:false,refreshed:false,partial:true,gameId:message.gameId,code:'capture-error',reason:String(error.message || error)}));
    return true;
  });
  reset(gameId());
  chrome.storage.local.get('msa.settings').then(values => { settings = {...defaults,...values['msa.settings']}; ready = true; sample(); })
    .catch(error => publish(current,`無法讀取設定：${error.message}`));
  chrome.storage.onChanged.addListener((changes,area) => {
    if (area !== 'local' || !changes['msa.settings']) return;
    const next = {...defaults,...changes['msa.settings'].newValue};
    const changedContext = next.enabled !== settings.enabled || next.playerName !== settings.playerName || next.handSide !== settings.handSide;
    settings = next; if (changedContext) reset(gameId()); sample();
  });
  setInterval(sample,150);
  new MutationObserver(() => sample()).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
  document.addEventListener('visibilitychange',() => sample());
})();
