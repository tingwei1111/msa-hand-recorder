(function (root, factory) {
  'use strict';
  const commonJS = typeof module === 'object' && module.exports;
  const api = factory(commonJS ? require('./recorder-core.js') : root.MSARecorderCore,
    commonJS ? require('./battle-log-core.js') : root.MSABattleLogCore,
    commonJS ? require('./deck-tracker-core.js') : root.MSADeckTrackerCore);
  if (commonJS) module.exports = api;
  if (root) root.MSALivePanelCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, battle, tracker) {
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);

  const PREFIX = 'msa.session.';
  const text = value => typeof value === 'string' ? value : '';
  const name = value => text(value).trim();
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const detailKey = value => text(value).replace(/\s+/g, '').replace(/[。.!！]+$/, '');
  const statusPart = (code, source, ...params) => ({code, source, params});
  const renderPart = part => typeof globalThis.MSAI18n?.status === 'function' ?
    globalThis.MSAI18n.status({messageParts:[part]}) : l10n(part.source, ...(Array.isArray(part.params) ? part.params : []));
  function recoveryState(context) {
    const recovery = context.recovery || {};
    return {durable:count(recovery.durableCount) || 0, pending:count(recovery.pendingCount) || 0,
      unprotected:count(recovery.unprotectedCount) || 0, error:text(recovery.error).trim()};
  }
  function recoveryParts(context) {
    const recovery = recoveryState(context), parts = [], quarantined = count(context.quarantinedCount) || 0;
    if (quarantined) parts.push(statusPart('quarantined','{0} 筆格式異常已隔離；請下載救援備份，有效觀察繼續保存',quarantined));
    if (recovery.durable) parts.push(statusPart('recovery-durable','救援原件已持久化 {0} 筆',recovery.durable));
    if (recovery.pending) parts.push(statusPart('recovery-pending','救援暫存確認中 {0} 筆',recovery.pending));
    if (recovery.unprotected || recovery.error) parts.push(statusPart('recovery-unconfirmed',recovery.error === 'recovery-journal-full' ?
      '救援暫存已滿，下載不會清除；一般記錄仍會嘗試保存，請保留原分頁。' : '救援暫存未確認持久化；請保留原分頁。'));
    return parts;
  }
  function appendStatusDetails(details, context) {
    const add = value => {
      const key = detailKey(value);
      if (key && !details.some(existing => detailKey(existing).includes(key))) details.push(value);
    };
    const counters = new Set(['saved-hand','saved-log','pending']);
    const addPart = part => {
      if (counters.has(part.code) || (part.code === 'write-error' && text(context.writeError).trim())) return;
      if ((context.recovery && text(part.code).startsWith('recovery-')) ||
          (context.quarantinedCount !== undefined && part.code === 'quarantined')) return;
      add(renderPart(part));
    };
    for (const [parts, legacy] of [[context.captureNoteParts,context.captureNote], [context.statusMessageParts,context.statusMessage]]) {
      const structured = Array.isArray(parts) ? parts.filter(part => part && typeof part.source === 'string') : [];
      if (structured.length) { structured.forEach(addPart); continue; }
      // Only old, unstructured badges are split. A structured parameter may
      // contain separators or UI-like words and must remain literal.
      for (const fragment of text(legacy).split(/[·•]/).map(value => value.trim()).filter(Boolean)) {
        if (/^已保存\s*\d+\s*[筆笔](?:手牌|快照)?[。.!！]?$/.test(fragment) ||
            /^Log\s*\d+\s*[筆笔][。.!！]?$/i.test(fragment) || /^待存\s*\d+\s*[筆笔][。.!！]?$/.test(fragment) ||
            /^Saved\s+\d+\s+hands[.!]?$/i.test(fragment) || /^\d+\s+pending[.!]?$/i.test(fragment)) continue;
        if (text(context.writeError).trim() && /^(?:儲存失敗|保存失败|Save failed)\s*[:：]/i.test(fragment)) continue;
        add(globalThis.MSAI18n?.message(fragment) || fragment);
      }
    }
    // The state is authoritative even when its latest published badge predates
    // an asynchronous journal acknowledgement or error.
    recoveryParts(context).forEach(part => add(renderPart(part)));
  }
  const qualityLabels = {complete:'辨識完整', partial:'部分辨識', unavailable:'手牌未知'};
  const eventSignature = event => JSON.stringify([
    text(event.rawText).replace(/\s+/g, ' ').trim(), name(event.actor), event.cards || []
  ]);

  function validSession(key, session, gameId) {
    return key.startsWith(PREFIX) && session && typeof session === 'object' &&
      session.schemaVersion === 1 && session.gameId === gameId &&
      key === PREFIX + session.id && Array.isArray(session.snapshots);
  }

  function publicOnly(session) {
    // Hand observations from previous runs never enter the live projection.
    // Original capture issues stay available independently of public coverage.
    return copy({...session, snapshots:[]});
  }

  function eventsOf(session) {
    return Array.isArray(session?.battleLog?.events) ? session.battleLog.events.filter(event =>
      event && typeof event === 'object' && !Array.isArray(event)) : [];
  }

  // combineSessions regenerates its event IDs. Match entire source sequences
  // back to that accepted order so displayed IDs still identify stored evidence.
  // Mapping by sequence preserves two legal, identical consecutive plays.
  function originalEvents(events, sources) {
    const signatures = events.map(eventSignature);
    const originals = Array(events.length).fill(null);
    const ordered = sources.slice().sort((a,b) => text(a.startedAt).localeCompare(text(b.startedAt)));
    for (const source of ordered) {
      const rows = eventsOf(source), wanted = rows.map(eventSignature);
      if (!rows.length) continue;
      let bestStart = -1, bestScore = -1, tied = false;
      for (let start = 0; start <= events.length - rows.length; start += 1) {
        if (!wanted.every((signature,index) => signature === signatures[start+index])) continue;
        const score = rows.reduce((sum,event,index) => sum + Number(
          count(event.sourceIndex) !== null && event.sourceIndex === events[start+index].sourceIndex), 0);
        if (score > bestScore) { bestScore = score; bestStart = start; tied = false; }
        else if (score === bestScore) tied = true;
      }
      if (bestStart >= 0 && !tied) {
        rows.forEach((event,index) => {
          if (!originals[bestStart+index]) originals[bestStart+index] = {event, sourceSessionId:source.id};
        });
      } else {
        // A later capture can fill gaps between an older source's indices.
        // Only uniquely matching indexed rows are safe to attribute in this case.
        rows.forEach(event => {
          if (count(event.sourceIndex) === null) return;
          const matches = events.map((candidate,index) => ({candidate,index})).filter(({candidate,index}) =>
            candidate.sourceIndex === event.sourceIndex && signatures[index] === eventSignature(event));
          if (matches.length === 1 && !originals[matches[0].index]) {
            originals[matches[0].index] = {event, sourceSessionId:source.id};
          }
        });
      }
    }
    return originals;
  }

  function projectHand(snapshot, identityConfirmed, mismatch) {
    const result = {latestSnapshot:null, handCards:[], quality:'unavailable', qualityLabel:l10n('尚無本段快照'),
      handSummary:identityConfirmed ? l10n('本段尚無已存手牌觀察；不使用其他段落的舊手牌。') : l10n('玩家身分尚未確認，不顯示存檔手牌。'),
      currentTurnLabel:l10n('回合未確認'), resourcesText:l10n('資源未辨識')};
    if (mismatch) result.handSummary = l10n('本段存檔玩家與目前玩家不符，未顯示其手牌。');
    if (!snapshot || !identityConfirmed || mismatch) return result;
    result.latestSnapshot = copy(snapshot);
    const counts = new Map();
    let invalid = !Array.isArray(snapshot.hand);
    for (const card of Array.isArray(snapshot.hand) ? snapshot.hand : []) {
      const code = core?.normalizeCardCode(card?.cardCode);
      if (!code || count(card?.count) === null || card.count === 0) { invalid = true; continue; }
      counts.set(code, (counts.get(code) || 0) + card.count);
    }
    result.handCards = [...counts].map(([cardCode, amount]) => ({cardCode, count:amount}));
    const known = result.handCards.reduce((sum,card) => sum + card.count, 0);
    const expected = count(snapshot.expectedCount), unknown = count(snapshot.unknownCount);
    result.quality = Object.hasOwn(qualityLabels, snapshot.quality) ? snapshot.quality : 'unavailable';
    if (result.quality === 'complete' && (invalid || unknown === null || unknown > 0 || (expected !== null && expected !== known))) {
      result.quality = 'partial';
    }
    result.qualityLabel = l10n(qualityLabels[result.quality]);
    if (result.quality === 'complete' && known === 0 && unknown === 0 && (expected === null || expected === 0)) {
      result.handSummary = l10n('已觀察到空手（0 張）；這是最近一次已存觀察。');
    } else if (result.quality === 'complete') {
      result.handSummary = l10n("最近已存手牌 {0} 張；請與當前畫面核對。", known);
    } else if (result.quality === 'unavailable') {
      result.handSummary = known ? l10n("可確認 {0} 張卡號，但這次手牌無法完整辨識；總數不能視為 {1} 張。", known, known) :
        l10n('這次手牌未知，不能視為 0 張或空手。');
    } else {
      result.handSummary = l10n("已辨識 {0} 張 · 預期 {1} 張 · 未辨識 {2} 張；資料不完整。", known, expected === null ? l10n('未知') : expected, unknown === null ? l10n('未知') : unknown);
    }
    const turn = count(snapshot.turn), observed = count(snapshot.observedTurn);
    if (turn && snapshot.turnSource === 'log') result.currentTurnLabel = l10n("T{0}（Log 確認）", turn);
    else if (turn && snapshot.turnSource === 'phase-observed') result.currentTurnLabel = l10n("推計 T{0}", turn);
    else if (observed) result.currentTurnLabel = l10n("觀察回合 {0}", observed);
    if (snapshot.resources && typeof core?.resourceText === 'function') result.resourcesText = core.resourceText(snapshot.resources);
    return result;
  }

  function project(values, context, cache) {
    context = context || {};
    const gameId = text(context.gameId), playerName = name(context.playerName);
    const identityConfirmed = Boolean(playerName);
    const currentId = gameId && text(context.runId) ? `${gameId}.${context.runId}` : '';
    const entries = gameId ? Object.entries(values && typeof values === 'object' ? values : {})
      .filter(([key,session]) => validSession(key,session,gameId)).map(([,session]) => session) : [];
    const current = entries.find(session => session.id === currentId) || null;
    const mismatch = Boolean(identityConfirmed && current && name(current.playerName) !== playerName);
    const handSession = identityConfirmed && current && !mismatch ? current : null;
    const latest = handSession?.snapshots.at(-1);
    const hand = projectHand(latest && typeof latest === 'object' ? latest : null, identityConfirmed, mismatch);
    let handDelta = {comparable:false,added:[],removed:[],reason:l10n('尚無可比較的前一筆完整觀察。')};
    const previous = handSession?.snapshots.at(-2);
    if(previous && latest && identityConfirmed && !mismatch){
      const before=projectHand(previous,true,false);
      if(before.quality==='complete'&&hand.quality==='complete'&&
          (previous.sourceSessionId||handSession.id)===handSession.id&&
          (latest.sourceSessionId||handSession.id)===handSession.id&&
          Number.isFinite(Date.parse(previous.timestamp))&&Number.isFinite(Date.parse(latest.timestamp))&&
          Date.parse(previous.timestamp)<=Date.parse(latest.timestamp)&&text(previous.id).trim()&&
          text(latest.id).trim()&&previous.id!==latest.id){
        const amounts=new Map(before.handCards.map(card=>[card.cardCode,-card.count]));
        hand.handCards.forEach(card=>amounts.set(card.cardCode,(amounts.get(card.cardCode)||0)+card.count));
        handDelta={comparable:true,added:[],removed:[],reason:l10n('相鄰完整觀察的張數差，不推定抽牌、出牌或棄牌原因。')};
        for(const [cardCode,difference]of amounts){
          if(difference>0)handDelta.added.push({cardCode,count:difference});
          if(difference<0)handDelta.removed.push({cardCode,count:-difference});
        }
      }else handDelta.reason=l10n('前後觀察不完整、順序待確認或跨段落，未推算張數差。');
    }
    // An anonymous source is compatible only when it never recorded a hand.
    // Without a current identity, only this run's public evidence is admitted.
    const sources = identityConfirmed ? entries.filter(session => name(session.playerName) === playerName ||
      (!name(session.playerName) && session.snapshots.length === 0)) : current ? [current] : [];
    const publicKey=cache?JSON.stringify([currentId,playerName,sources.map(source=>({id:source.id,gameId:source.gameId,
      playerName:source.playerName,startedAt:source.startedAt,battleLog:source.battleLog,captureIssues:source.captureIssues}))]):'';
    let merged = null, mergeProblem = '', timeline=null, events, originals;
    if(cache?.publicKey===publicKey){
      ({merged,mergeProblem,timeline,events,originals}=cache.evidence);
    }else{
    try {
      if (sources.length === 1) merged = publicOnly(sources[0]);
      else if (sources.length > 1 && typeof battle?.combineSessions === 'function') {
        merged = battle.combineSessions(sources.map(publicOnly));
      } else if (sources.length > 1) {
        mergeProblem = '公開紀錄合併模組未載入，僅顯示目前記錄段。';
      }
    } catch (_) { mergeProblem = '部分公開紀錄無法合併，僅顯示目前記錄段。'; }
    if (!merged && current && sources.includes(current)) merged = publicOnly(current);
    try { if (merged && typeof battle?.buildTimeline === 'function') timeline = battle.buildTimeline(merged); }
    catch (_) { mergeProblem = '公開紀錄摘要無法確認，請開啟回顧頁檢查原文。'; }
    events = eventsOf(merged);
    originals = originalEvents(events, sources);
    if(cache){cache.publicKey=publicKey;cache.evidence={merged,mergeProblem,timeline,events,originals};}
    }
    const plays = events.filter(event => event?.isPlay === true);
    const knownPlayers = new Set((Array.isArray(merged?.battleLog?.players) ? merged.battleLog.players : []).map(name).filter(Boolean));
    const recentPlays = [];
    for (let index = events.length-1; index >= 0 && recentPlays.length < 20; index -= 1) {
      const event = events[index]; if (event?.isPlay !== true && event?.action !== 'deploy-token') continue;
      const original = originals[index];
      const actor = name(event.actor), primary = event.primaryCard;
      // A nonempty label alone is not proof that it is the opposing player.
      const actorSide = !identityConfirmed || !actor ? 'unknown' : actor === playerName ? 'own' :
        knownPlayers.has(actor) ? 'opponent' : 'unknown';
      recentPlays.push({id:text(original?.event.id || event.id), idSource:original?.event.id ? 'stored' : 'combined',
        sourceSessionId:original?.sourceSessionId || null,
        action:text(event.action), actor, cardCode:primary?.cardCode || null, cardName:text(primary?.name),
        rawText:text(event.rawText), turn:count(event.turn) || null, actorSide});
    }
    const coverage = timeline?.coverage || merged?.battleLog?.coverage || {};
    let coverageLabel = l10n('尚未收錄公開 Log'), coverageTone = 'neutral';
    if (mergeProblem) { coverageLabel = l10n('公開 Log 合併待確認'); coverageTone = 'warning'; }
    else if (events.length) {
      coverageTone = 'warning';
      if (coverage.hasGaps || coverage.unmergedCaptureCount) coverageLabel = l10n('公開 Log 有待確認缺口');
      else if (coverage.publicLogComplete) { coverageLabel = l10n('公開 Log 已見開局與結束'); coverageTone = 'success'; }
      else coverageLabel = coverage.completeFromStart ? l10n('公開 Log 從開局收錄中') : l10n('僅收錄部分公開 Log');
    }
    const captureIssues = copy(timeline?.handCaptureIssues || merged?.captureIssues || []);
    if (!hand.latestSnapshot) {
      const lastTurn = events.slice().reverse().find(event => count(event?.turn) > 0)?.turn;
      if (lastTurn) hand.currentTurnLabel = l10n("公開 Log 至 T{0}", lastTurn);
    }
    const model = {gameId, playerName, identityConfirmed,
      sessionId:current && (handSession || current.snapshots.length === 0) && sources.includes(current) ? current.id : null,
      ...hand, snapshotCount:handSession?.snapshots.length || 0,
      publicEventCount:events.length, publicPlayCount:plays.length, recentPlays, coverageLabel, coverageTone,
      captureIssues, handDelta,healthAlerts:copy(Array.isArray(context.healthAlerts)?context.healthAlerts:[]),
      endObserved:Boolean(context.endObserved),statusLabel:l10n('等待已存資料'), statusTone:'neutral', statusDetail:'',statusDetailLocalized:true};
    if (tracker?.project) {
      try { model.deckTracker = tracker.project({values,context,handModel:hand,events,players:[...knownPlayers],coverage}); }
      catch (_) {
        const engine=tracker.engineStatus?.();
        const loading=engine?.state==='loading';
        model.deckTracker={state:loading?'loading':'error',gameId,playerName,contextKey:currentId,sessionId:null,canBind:false,
          deck:null,availableDecks:[],rows:[],publicCards:{own:[],opponent:[],unknown:[],tokens:[]},warnings:[],
          stateDetail:loading?l10n('牌組核心載入中；手牌與公開 Log 照常記錄。'):l10n('牌組資料核心暫時無法使用，請重新載入擴充功能後重整 MSA；既有手牌與 Log 仍保留。')};
      }
    }
    const pending = count(context.pendingCount) || 0, writeError = text(context.writeError).trim();
    const recovery = recoveryState(context), recoveryUncertain = recovery.pending || recovery.unprotected || recovery.error;
    const details = [];
    if (writeError) {
      model.statusLabel = l10n('儲存需要處理'); model.statusTone = 'error';
      details.push(l10n("儲存失敗：{0}。下方僅顯示已存資料。", writeError));
      if (context.enabled === false) details.push(l10n('新記錄已暫停。'));
    } else if (recoveryUncertain || context.quarantinedCount > 0) {
      model.statusLabel = l10n('紀錄涵蓋待確認'); model.statusTone = 'warning';
      if (context.enabled === false) details.push(l10n('新記錄已暫停。'));
    } else if (context.enabled === false) {
      model.statusLabel = l10n('記錄已暫停'); details.push(l10n('既有資料仍保留；暫停期間不新增觀察。'));
    } else if (pending) {
      model.statusLabel = l10n("等待儲存 {0} 筆", pending); model.statusTone = 'warning';
      details.push(l10n('尚未寫入的觀察不會提前顯示為已存快照。'));
    } else if (mismatch) {
      model.statusLabel = l10n('玩家資料不符'); model.statusTone = 'warning'; details.push(hand.handSummary);
    } else if (!identityConfirmed) {
      model.statusLabel = l10n('玩家身分待確認'); model.statusTone = 'warning'; details.push(l10n('僅顯示本段公開事件，不判定自己或對手。'));
    } else if (mergeProblem || captureIssues.length) {
      model.statusLabel = l10n('紀錄涵蓋待確認'); model.statusTone = 'warning';
    } else if (hand.latestSnapshot && hand.quality !== 'complete') {
      model.statusLabel = l10n('已存手牌待核對'); model.statusTone = 'warning'; details.push(hand.handSummary);
    } else if (hand.latestSnapshot && ['partial','unavailable'].includes(context.quality)) {
      model.statusLabel = l10n('目前畫面待辨識'); model.statusTone = 'warning';
      details.push(l10n('目前畫面尚未完整辨識；下方保留最近已存觀察，請勿視為此刻完整手牌。'));
    } else if (hand.latestSnapshot) {
      model.statusLabel = l10n('已有本段手牌觀察'); model.statusTone = 'success'; details.push(l10n('僅顯示最近已存觀察；未涵蓋所有瞬間。'));
    } else if (events.length) {
      model.statusLabel = l10n('已存公開 Log'); details.push(l10n('本段尚無已存手牌，公開 Log 不能補回過去手牌。'));
    } else details.push(l10n('尚未收到本場已儲存的資料。啟用開關不代表已記錄成功。'));
    if (pending && writeError) details.push(l10n("仍有 {0} 筆觀察待存。", pending));
    // Cached evidence outlives language changes; localize its authored source
    // only when composing the current view, without reprocessing user data.
    if (mergeProblem) details.push(l10n(mergeProblem));
    if (captureIssues.length) details.push(l10n("有 {0} 筆手牌擷取缺口；公開 Log 的完整性不能補回缺口。", captureIssues.length));
    appendStatusDetails(details,context);
    model.statusDetail = details.join(' ');
    return model;
  }
  // Collapsed launchers need saved counts and health, not merged event history
  // or a Wasm deck projection. Read only the current identity's saved segment.
  function projectSummary(values, context = {}) {
    context = context || {};
    const gameId=text(context.gameId), playerName=name(context.playerName), id=`${gameId}.${text(context.runId)}`;
    const stored=values?.[PREFIX+id];
    const current=validSession(PREFIX+id,stored,gameId)?stored:null;
    const mismatch=Boolean(playerName && current && name(current.playerName)!==playerName);
    const own=playerName && !mismatch ? current : null;
    const snapshotCount=own?.snapshots.length || 0, latest=own?.snapshots.at(-1);
    const pending=count(context.pendingCount)||0, quarantined=count(context.quarantinedCount)||0;
    const writeError=text(context.writeError).trim(), recovery=recoveryState(context);
    const healthAlerts=copy(Array.isArray(context.healthAlerts)?context.healthAlerts:[]);
    const captureIssues=[];
    for(const [key,record] of Object.entries(values || {})) {
      if(!validSession(key,record,gameId))continue;
      if(playerName ? name(record.playerName)!==playerName && (name(record.playerName)||record.snapshots.length) : record!==current)continue;
      for(const issue of Array.isArray(record.captureIssues)?record.captureIssues:[])captureIssues.push(copy(issue));
    }
    let statusLabel=l10n('等待已存資料'), statusTone='neutral';
    if(writeError){statusLabel=l10n('儲存需要處理');statusTone='error';}
    else if(quarantined || captureIssues.length || healthAlerts.length || recovery.pending || recovery.unprotected || recovery.error){
      statusLabel=l10n('紀錄涵蓋待確認');statusTone=healthAlerts.some(alert=>alert?.level==='error')?'error':'warning';
    }
    else if(context.enabled===false)statusLabel=l10n('記錄已暫停');
    else if(pending){statusLabel=l10n('等待儲存 {0} 筆',pending);statusTone='warning';}
    else if(mismatch){statusLabel=l10n('玩家資料不符');statusTone='warning';}
    else if(!playerName){statusLabel=l10n('玩家身分待確認');statusTone='warning';}
    else if(snapshotCount && (!latest || typeof latest!=='object' || projectHand(latest,true,false).quality!=='complete')){statusLabel=l10n('已存手牌待核對');statusTone='warning';}
    else if(latest && ['partial','unavailable'].includes(context.quality)){statusLabel=l10n('目前畫面待辨識');statusTone='warning';}
    else if(latest){statusLabel=l10n('已有本段手牌觀察');statusTone='success';}
    else if(!mismatch && current?.battleLog?.events?.length)statusLabel=l10n('已存公開 Log');
    const details=[];
    if(writeError)details.push(l10n('儲存失敗：{0}。下方僅顯示已存資料。',writeError));
    appendStatusDetails(details,context);
    return {summaryOnly:true,gameId,playerName,identityConfirmed:Boolean(playerName),
      sessionId:current && !mismatch && (playerName || !current.snapshots.length)?id:null,
      snapshotCount,healthAlerts,captureIssues,statusLabel,statusTone,
      statusDetail:details.join(' '),statusDetailLocalized:true,
      latestSnapshot:null,handCards:[],recentPlays:[],endObserved:Boolean(context.endObserved)};
  }
  function createProjector(){
    const cache={};
    return (values,context)=>context?.panelExpanded===false ? projectSummary(values,context) : project(values,context,cache);
  }
  return Object.freeze({project,projectSummary,createProjector});
});
