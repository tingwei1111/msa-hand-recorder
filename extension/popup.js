(async () => {
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);
  await globalThis.MSAI18n?.ready();


  const SESSION_PREFIX = 'msa.session.';
  const STATUS_PREFIX = 'msa.status.';
  const SETTINGS_KEY = 'msa.settings';
  const defaults = { enabled: true, playerName: '', handSide: 'auto', autoCollectLog: true };
  const $ = (id) => document.getElementById(id);
  const qualityLabels = { complete: '辨識完整', partial: '部分辨識', unavailable: '無法辨識' };
  const reasonLabels = {
    'visible-hand-dom-slots': '依可見手牌欄位辨識，請與自己的實際手牌張數核對。',
    'visible-hand-counter': '已與畫面上的手牌張數標記核對。',
    'layout-transition': '畫面正在變動，手牌欄位與張數尚未一致。',
    'card-back-or-unreadable': '部分牌仍是背面，或目前無法辨識卡號。',
    'animation-observed': '畫面動畫中的觀察；張數可能仍在變動，請核對之後的快照。',
    'hand-container-missing': '這次未找到手牌欄位，不能視為沒有手牌。',
    'game-ended': '對局結束時觀察到的手牌。'
  };

  let sessions = [];
  let selectedKey = '';
  let settings = { ...defaults };
  let formDirty = false;
  let reloadTimer;
  let loadSequence = 0;
  let exportBusy = false;
  let settingsBusy = false;
  let toggleBusy = false;
  let deleteBusy = false;
  let refreshBusy = false;
  let dataLoaded = false;
  let panelBusy = false;
  let diagnosticsBusy = false;
  let latestStatus = null;
  let activePageReport=null,pageReportPromise;
  const actionLabels = {
    'export-json': '下載 JSON', 'export-csv': '手牌 CSV', 'sync-log': '更新 Log',
    'delete-session': '刪除此段紀錄', 'open-review': '開啟對局回顧', 'refresh': '重新整理'
  };

  function timeValue(value) {
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function dateText(value) {
    const timestamp = timeValue(value);
    return timestamp ? new Intl.DateTimeFormat(globalThis.MSAI18n?.language || 'zh-TW', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp)) : l10n('時間未知');
  }

  function countText(value) {
    return Number.isInteger(value) && value >= 0 ? String(value) : l10n('未知');
  }

  function showNotice(message, error = false) {
    $('notice').setAttribute('role', error ? 'alert' : 'status');
    $('notice').setAttribute('aria-live', error ? 'assertive' : 'polite');
    $('notice').textContent = message;
    $('notice').className = error ? 'notice error' : 'notice';
    $('notice').hidden = !message;
  }

  function reportError(message, error) {
    const detail = error && typeof error.message === 'string' ? ` ${(globalThis.MSAI18n?.message(error.message)||error.message)}` : '';
    showNotice(message + detail, true);
  }

  function selectedSession() {
    return sessions.find((entry) => entry.key === selectedKey)?.session || null;
  }

  function sessionLabel(session) {
    return [session.playerName || l10n('公開紀錄'), String(session.gameId || session.id || '').slice(0, 8)].filter(Boolean).join(' · ');
  }

  function updateControls() {
    const recordBusy = exportBusy || deleteBusy || refreshBusy;
    const available = Boolean(selectedSession());
    for (const id of ['export-json', 'export-csv', 'sync-log', 'delete-session', 'open-review']) {
      $(id).disabled = recordBusy || !available || (id === 'export-csv' && typeof globalThis.MSARecorderCore?.toCSV !== 'function');
    }
    $('session-select').disabled = recordBusy || sessions.length === 0;
    $('refresh').disabled = recordBusy || refreshBusy;
    $('recording-enabled').disabled = !dataLoaded || recordBusy || toggleBusy || settingsBusy;
    $('save-settings').disabled = !dataLoaded || recordBusy || settingsBusy || toggleBusy;
    for (const id of ['player-name', 'hand-side', 'auto-collect-log']) {
      $(id).disabled = !dataLoaded || settingsBusy || toggleBusy;
    }
    $('session-content').setAttribute('aria-busy', String(recordBusy));
    $('show-live-panel').disabled = recordBusy || panelBusy;
    $('run-diagnostics').disabled = diagnosticsBusy || recordBusy;
  }

  function setRecordBusy(busy, action) {
    exportBusy = busy;
    for (const [id, label] of Object.entries(actionLabels)) {
      $(id).textContent = busy && id === action ? (id === 'sync-log' ? l10n('更新中…') : l10n('準備下載…')) : l10n(label);
      $(id).setAttribute('aria-busy', String(busy && id === action));
    }
    updateControls();
  }

  function sideHelp() {
    $('side-help').textContent = $('hand-side').value === 'auto'
      ? l10n('自動僅辨識下方本人手牌；旁觀或舊對局只能收錄公開 Log。')
      : l10n('請確認這一側是你自己的手牌。此設定不會讀取或還原蓋牌。');
  }

  function renderSettings() {
    $('recording-enabled').checked = settings.enabled;
    $('toggle-label').textContent = settings.enabled ? l10n('自動記錄') : l10n('已暫停');
    if (!formDirty) {
      $('player-name').value = settings.playerName;
      $('hand-side').value = settings.handSide;
      $('auto-collect-log').checked = settings.autoCollectLog;
      sideHelp();
    }
    updateControls();
  }

  function renderStatus(status) {
    const savedHands = sessions.reduce((total, entry) => total + entry.session.snapshots.length, 0);
    const savedEvents = sessions.reduce((total, entry) => total + (entry.session.battleLog?.events?.length || 0), 0);
    const hasSaved = savedHands + savedEvents > 0;
    const message = typeof status?.message === 'string' ? status.message : '';
    const reportedError = /失敗|中斷|暫存已滿|未能|未儲存|無法讀取|缺口|invalid record|\berror\b/i.test(message);
    const needsCheck = status?.quality === 'partial' || status?.quality === 'unavailable';
    let label, summary, tone = '';
    if (!settings.enabled) {
      label = l10n('新觀察已暫停');
      summary = hasSaved ? l10n('已儲存的資料仍可回顧與備份。') : l10n('啟用後，請在開局前重新整理 MSA 分頁。');
    } else if (activePageReport?.pageType==='lobby' && !activePageReport.hasErrors) {
      label=l10n('大廳待命中');tone='saved';summary=l10n('已連線至 MSA；進入對局後開始記錄，既有對局可隨時回顧。');
    } else if (reportedError) {
      label = l10n('最近分頁需要處理'); tone = 'error';
      summary = hasSaved ? l10n('已有本機資料；最近分頁回報異常，請展開核對。') : l10n('尚未確認資料存妥，請展開查看分頁回報。');
    } else if (needsCheck) {
      label = hasSaved ? l10n('最近分頁待確認') : l10n('等待可確認的資料'); tone = 'warning';
      summary = hasSaved ? l10n('已有本機資料；最近分頁的手牌辨識尚未完整。') : l10n('開關已啟用；收到並儲存觀察後，這裡才會顯示紀錄。');
    } else if (hasSaved) {
      label = l10n('已有本機紀錄'); tone = 'saved';
      summary = l10n("已存 {0} 筆手牌觀察、{1} 筆公開事件。", savedHands, savedEvents);
    } else {
      label = status ? l10n('等待資料存妥') : l10n('等待 MSA 分頁');
      summary = l10n('開關已啟用；請在開局前重新整理對局分頁。');
    }
    $('recording-label').textContent = label;
    $('status-summary').textContent = summary;
    $('status-dot').className = `status-dot${tone ? ' ' + tone : ''}`;
    $('status-details').classList.toggle('needs-attention', reportedError);
    $('status-message').textContent = status && typeof status.message === 'string'
      ? (globalThis.MSAI18n?.message(status.message) || status.message)
      : l10n('尚未收到 MSA 分頁狀態。請在對局前重新整理 MSA 分頁。');
    if (!status) {
      $('status-time').textContent = '';
      return;
    }
    const context = [
      l10n('最近分頁'),
      status.playerName || '',
      status.gameId ? String(status.gameId).slice(0, 8) : '',
      dateText(status.updatedAt)
    ].filter(Boolean);
    $('status-time').textContent = context.join(' · ');
  }

  function renderSessions() {
    const selector = $('session-select');
    selector.replaceChildren();
    if (!sessions.some((entry) => entry.key === selectedKey)) {
      selectedKey = sessions[0]?.key || '';
    }
    if (!sessions.length) {
      const option = document.createElement('option');
      option.textContent = l10n('尚無對局記錄');
      selector.append(option);
    } else {
      for (const entry of sessions) {
        const option = document.createElement('option');
        const session = entry.session;
        option.value = entry.key;
        option.textContent = [
          dateText(session.startedAt),
          session.playerName || l10n('玩家未辨識'),
          session.gameId ? String(session.gameId).slice(0, 8) : l10n('對局未知')
        ].join(' · ');
        selector.append(option);
      }
      selector.value = selectedKey;
    }
    selector.disabled = exportBusy || sessions.length === 0;
    $('empty-state').hidden = sessions.length > 0;
    $('session-content').hidden = sessions.length === 0;
    renderSession();
    updateControls();
  }

  function renderSession() {
    const session = selectedSession();
    if (!session) return;
    const snapshots = session.snapshots;
    const snapshot = snapshots[snapshots.length - 1];
    $('session-meta').textContent = l10n("最後儲存 {0} · 此段紀錄", dateText(session.updatedAt || session.startedAt));
    $('session-meta').title = l10n("對局 {0} · {1}", session.gameId || l10n('未知'), session.playerName || l10n('玩家未辨識'));
    $('snapshot-count').textContent = String(snapshots.length);
    $('complete-count').textContent = String(snapshots.filter((item) => item?.quality === 'complete').length);
    $('turn-count').textContent = '—';
    const core = globalThis.MSARecorderCore;
    if (typeof core?.summarizeTurns === 'function') {
      try {
        const summary = core.summarizeTurns(session);
        if (Array.isArray(summary)) $('turn-count').textContent = String(summary.length);
      } catch (error) {
        reportError(l10n('無法建立回合摘要；仍可匯出原始 JSON。'), error);
      }
    }
    $('export-csv').disabled = exportBusy || typeof core?.toCSV !== 'function';
    if (!core) showNotice(l10n('記錄核心未載入。請重新載入擴充功能；現有記錄仍可下載 JSON。'), true);
    renderLogSummary(session);
    renderSnapshot(snapshot);
  }

  function renderLogSummary(session) {
    const logCore = globalThis.MSABattleLogCore;
    let timeline;
    try { timeline = logCore?.buildTimeline(session); }
    catch (error) { reportError(l10n('公開紀錄摘要無法載入；仍可匯出原始 JSON。'), error); }
    const turns = Array.isArray(timeline?.turns) ? timeline.turns : [];
    const events = turns.flatMap((turn) => Array.isArray(turn.events) ? turn.events : [])
      .concat(Array.isArray(timeline?.unassignedEvents) ? timeline.unassignedEvents : []);
    const plays = events.filter((event) => event.isPlay === true);
    const coverage = timeline?.coverage || {};
    let label = l10n('尚未收錄');
    let quality = 'unavailable';
    if (events.length) {
      quality = 'partial';
      label = coverage.hasGaps || coverage.unmergedCaptureCount ? l10n('有待確認缺口')
        : coverage.publicLogComplete ? l10n('已見開局與結束')
          : coverage.completeFromStart ? l10n('從開局收錄中') : l10n('部分公開紀錄');
      if (coverage.publicLogComplete && !coverage.hasGaps && !coverage.unmergedCaptureCount) quality = 'complete';
    }
    $('log-coverage').textContent = label;
    $('log-coverage').className = `badge ${quality}`;
    $('public-event-count').textContent = String(events.length);
    $('log-counts').textContent = l10n("公開出牌 {0} 次", plays.length);
    const range = Number.isInteger(coverage.firstTurn) && Number.isInteger(coverage.lastTurn)
      ? l10n("已見 T{0}–T{1}。", coverage.firstTurn, coverage.lastTurn) : '';
    $('log-note').textContent = range + (coverage.publicLogComplete
      ? l10n('已收錄的 Log 包含開局與結束標記；手牌涵蓋範圍仍需另外核對。')
      : l10n('匯出前會嘗試更新同場公開 Log；請保持對局分頁開啟。'));
    if (turns.length) $('turn-count').textContent = String(turns.length);
  }

  function renderSnapshot(snapshot) {
    $('hand-list').replaceChildren();
    for (const id of ['snapshot-meta', 'turn-source', 'hand-counts', 'hand-empty', 'snapshot-reason', 'resource-status', 'snapshot-time']) {
      $(id).textContent = '';
    }
    $('snapshot-reason').hidden = true;
    if (!snapshot || typeof snapshot !== 'object') {
      $('quality-badge').className = 'badge';
      $('quality-badge').textContent = l10n('尚無快照');
      $('hand-empty').textContent = l10n('此筆對局尚未收到手牌快照。');
      return;
    }
    const quality = Object.hasOwn(qualityLabels, snapshot.quality) ? snapshot.quality : 'unavailable';
    $('quality-badge').className = `badge ${quality}`;
    $('quality-badge').textContent = l10n(qualityLabels[quality]);
    const hasAbsoluteTurn = snapshot.turnSource === 'log' && Number.isInteger(snapshot.turn) && snapshot.turn > 0;
    const hasEstimatedTurn = snapshot.turnSource === 'phase-observed' && Number.isInteger(snapshot.turn) && snapshot.turn > 0;
    const turn = hasAbsoluteTurn ? l10n("第 {0} 回合", snapshot.turn)
      : hasEstimatedTurn ? l10n("推計第 {0} 回合", snapshot.turn)
      : Number.isInteger(snapshot.observedTurn) && snapshot.observedTurn > 0
        ? l10n("觀察回合 {0}", snapshot.observedTurn) : l10n('回合未辨識');
    $('snapshot-meta').textContent = [turn, snapshot.activePlayer || '', snapshot.phase || ''].filter(Boolean).join(' · ');
    $('turn-source').textContent = hasAbsoluteTurn ? l10n('回合來源：可見 Battle Log')
      : hasEstimatedTurn ? l10n("由先前 Log 校準後推計 · 觀察回合 {0}", countText(snapshot.observedTurn))
        : l10n('尚無可見 Log 校準；觀察序號不等於絕對回合。');

    const cards = Array.isArray(snapshot.hand) ? snapshot.hand.filter((card) =>
      card && typeof card.cardCode === 'string' && Number.isInteger(card.count) && card.count > 0) : [];
    const recognizedCount = cards.reduce((sum, card) => sum + card.count, 0);
    $('hand-counts').textContent = l10n("已辨識 {0} 張 · 預期總數 {1} · 未辨識 {2}", recognizedCount, countText(snapshot.expectedCount), countText(snapshot.unknownCount));
    for (const card of cards) {
      const item = document.createElement('li');
      const code = document.createElement('span');
      code.className = 'card-code';
      code.textContent = card.cardCode;
      const count = document.createElement('span');
      count.className = 'card-count';
      count.textContent = `× ${card.count}`;
      item.append(code, count);
      $('hand-list').append(item);
    }
    if (!cards.length) {
      $('hand-empty').textContent = quality === 'complete' && snapshot.expectedCount === 0 && snapshot.unknownCount === 0
        ? l10n('已確認：目前沒有手牌。')
        : l10n('目前沒有可確認的卡號；這不代表沒有手牌。');
    }
    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : '';
    $('snapshot-reason').textContent = (Object.hasOwn(reasonLabels, reason) ? l10n(reasonLabels[reason]) : reason)
      || (quality !== 'complete' ? l10n('此次辨識不完整，請與 MSA 畫面核對。未知資料不應當作空手。') : '');
    $('snapshot-reason').hidden = !$('snapshot-reason').textContent;
    if (snapshot.resources && typeof snapshot.resources === 'object') {
      $('resource-status').textContent = l10n("資源：{0}", globalThis.MSARecorderCore.resourceText(snapshot.resources));
    }
    $('snapshot-time').textContent = l10n("快照時間 {0}", dateText(snapshot.timestamp));
  }

  async function loadData() {
    const sequence = ++loadSequence;
    try {
      const stored = await chrome.storage.local.get(null);
      if (sequence !== loadSequence) return;
      dataLoaded = true;
      const savedSettings = stored[SETTINGS_KEY] || {};
      settings = {
        enabled: savedSettings.enabled !== false,
        autoCollectLog: savedSettings.autoCollectLog !== false,
        playerName: typeof savedSettings.playerName === 'string' ? savedSettings.playerName : '',
        handSide: ['auto', 'bottom', 'top'].includes(savedSettings.handSide) ? savedSettings.handSide : 'auto'
      };
      sessions = Object.entries(stored)
        .filter(([key, value]) => key.startsWith(SESSION_PREFIX) && value && typeof value === 'object' && Array.isArray(value.snapshots))
        .map(([key, session]) => ({ key, session }))
        .sort((a, b) => timeValue(b.session.updatedAt) - timeValue(a.session.updatedAt));
      const statuses = Object.entries(stored)
        .filter(([key, value]) => key.startsWith(STATUS_PREFIX) && value && typeof value === 'object')
        .map(([, value]) => value)
        .sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
      latestStatus = statuses[0] || null;
      renderSettings();
      renderStatus(latestStatus);
      renderSessions();
      if(!pageReportPromise)pageReportPromise=chrome.runtime.sendMessage({type:'MSA_RUN_DIAGNOSTICS'}).then(result=>{
        if(result?.report){activePageReport=result.report;renderStatus(latestStatus);}
      }).catch(()=>{});
      if(globalThis.MSAStorageHealth)MSAStorageHealth.measure(chrome.storage.local).then(health=>MSAStorageHealth.render(document,health));
      return true;
    } catch (error) {
      reportError(l10n('無法讀取本機記錄。請重新開啟擴充功能後再試。'), error);
      $('recording-label').textContent = l10n('資料讀取失敗');
      $('status-summary').textContent = l10n('目前無法確認本機資料，請重新整理後再試。');
      $('status-dot').className = 'status-dot error';
      if (!dataLoaded) {
        const option = document.createElement('option');
        option.textContent = l10n('無法載入本機紀錄');
        $('session-select').replaceChildren(option);
      }
      updateControls();
      return false;
    }
  }

  function downloadFile(contents, extension, mimeType, session = selectedSession()) {
    if (!session) throw new Error(l10n('請先選擇一筆對局。'));
    const game = String(session.gameId || session.id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `msa-hand-${game}-${stamp}.${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNotice(l10n('已發起下載，請在 Chrome 下載項目確認檔案。'));
  }

  async function prepareExport() {
    const selected = selectedSession();
    const key = selectedKey;
    if (!selected) throw new Error(l10n('請先選擇一筆對局。'));
    showNotice(l10n("正在更新「{0}」的 Log，並等待手牌儲存完成…", sessionLabel(selected)));
    let refresh;
    try {
      refresh = await chrome.runtime.sendMessage({type:'MSA_PREPARE_EXPORT',gameId:selected.gameId,playerName:selected.playerName});
    } catch (error) { refresh = {ok:false,refreshed:false,reason:error.message || l10n('記錄器連線失敗')}; }
    const values = await chrome.storage.local.get(null);
    if (!values[key]) throw new Error(l10n('所選記錄已不存在。'));
    if (values[key].gameId !== selected.gameId || values[key].playerName !== selected.playerName) throw new Error(l10n('所選記錄身分已改變，請重新選取。'));
    const session = {...values[key]};
    let infoKey = 'exportInfo';
    while (Object.hasOwn(session, infoKey)) infoKey = `recorder${infoKey[0].toUpperCase()}${infoKey.slice(1)}`;
    session[infoKey] = {exportedAt:new Date().toISOString(),scope:'single-segment',refresh,
      workspaceRecords:globalThis.MSAReviewWorkspace?.exportRecords(session,values) || {}};
    return {session, refresh};
  }

  async function withPreparedSession(action, trigger) {
    if (exportBusy) return;
    setRecordBusy(true, trigger);
    try {
      const prepared = await prepareExport();
      await action(prepared.session);
      const suffix = prepared.refresh?.refreshed ? (prepared.refresh.partial ? l10n("已更新 Log，但仍有待確認資料：{0}。", prepared.refresh.reason || l10n('請查看涵蓋狀態')) : l10n('已更新公開 Log。')) : l10n("本次未能更新 Log：{0}。", prepared.refresh?.reason || l10n('對局分頁未回應'));
      showNotice(l10n("{0}：{1} 本段匯出已發起；整場相容段落請使用回顧頁匯出。", sessionLabel(prepared.session), suffix), !prepared.refresh?.refreshed || prepared.refresh?.partial);
    } catch (error) { reportError(l10n('無法完成匯出。'), error); }
    finally { await loadData(); setRecordBusy(false); }
  }

  $('open-library').addEventListener('click', async () => {
    $('open-library').disabled=true;
    try{
      const result=await chrome.runtime.sendMessage({type:'MSA_OPEN_LIBRARY',sessionId:selectedSession()?.id || ''});
      if(!result?.ok)throw new Error(result?.reason || l10n('請重新載入擴充功能。'));
    }catch(error){reportError(l10n('無法開啟資料管理。'),error);}
    finally{$('open-library').disabled=false;}
  });
  function renderDiagnostics(report){
      $('diagnostics-meta').textContent=`v${report.extensionVersion||l10n('未知')} · ${report.pageType==='lobby'?l10n('大廳待命'):l10n("對局 {0}", report.gameId?String(report.gameId).slice(0,8):l10n('未確認'))} · ${dateText(report.checkedAt)}`;
      $('diagnostics-results').replaceChildren();
      for(const check of report.checks || []){
        const li=document.createElement('li');li.className=['pass','info','warning','error'].includes(check.level)?check.level:'warning';
        const title=document.createElement('strong');title.textContent=globalThis.MSAI18n?.message(check.label)||check.label;
        const detail=document.createElement('p');detail.textContent=globalThis.MSAI18n?.message(check.detail)||check.detail;li.append(title,detail);$('diagnostics-results').append(li);
      }
      $('diagnostics-summary').textContent=globalThis.MSAI18n?.message(report.summary)||report.summary;
  }
  $('run-diagnostics').addEventListener('click',async()=>{
    if(diagnosticsBusy)return;
    diagnosticsBusy=true;updateControls();$('run-diagnostics').textContent=l10n('檢查中…');
    try{
      const result=await chrome.runtime.sendMessage({type:'MSA_RUN_DIAGNOSTICS'});
      if(!result?.ok||!result.report)throw new Error(result?.error || l10n('新版自檢模組尚未回應。'));
      const report=result.report;activePageReport=report;renderStatus(latestStatus);$('diagnostics-panel').hidden=false;$('diagnostics-panel').open=true;
      renderDiagnostics(report);
    }catch(error){reportError(l10n('記錄自檢未能完成。'),error);}
    finally{diagnosticsBusy=false;updateControls();$('run-diagnostics').textContent=l10n('記錄自檢');}
  });
  $('download-rescue')?.addEventListener('click',async()=>{
    const button=$('download-rescue');button.disabled=true;
    try{
      const result=await chrome.runtime.sendMessage({type:'MSA_GET_RESCUE'});
      if(!result?.ok)throw new Error(result?.error||l10n('救援備份未能完成。'));
      if(!result.backup?.records?.length){showNotice(l10n('目前分頁沒有待存或隔離的觀察。'));return;}
      downloadFile(JSON.stringify(result.backup,null,2),'json','application/json;charset=utf-8',{gameId:'unsaved-rescue'});
      showNotice(l10n('救援 JSON 已開始下載；請保留原 MSA 分頁直到確認檔案。此檔包含未確認存入的原始觀察。'));
    }catch(error){reportError(l10n('無法下載救援備份。'),error);}finally{button.disabled=false;}
  });
  $('show-live-panel').addEventListener('click', async () => {
    if (panelBusy || exportBusy || deleteBusy || refreshBusy) return;
    panelBusy = true; updateControls();
    $('show-live-panel').textContent = l10n('開啟小窗中…');
    $('show-live-panel').setAttribute('aria-busy', 'true');
    try {
      const result = await chrome.runtime.sendMessage({type:'MSA_SHOW_LIVE_PANEL'});
      showNotice(result?.ok ? l10n('對戰小窗已展開，請關閉這個小視窗，回到 MSA 查看。') : (result?.reason || l10n('無法開啟小窗，請先切到 MSA 對局頁面。')), !result?.ok);
    } catch (error) { reportError(l10n('無法開啟對戰小窗。'), error); }
    finally {
      panelBusy = false; updateControls();
      $('show-live-panel').textContent = l10n('顯示對戰側邊小窗 ↗');
      $('show-live-panel').setAttribute('aria-busy', 'false');
    }
  });

  $('recording-enabled').addEventListener('change', async (event) => {
    const enabled = event.target.checked;
    toggleBusy = true;
    updateControls();
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled } });
      settings.enabled = enabled;
      renderSettings();
      renderStatus(latestStatus);
      showNotice(enabled ? l10n('自動記錄已啟用。請確認 MSA 分頁狀態。') : l10n('已暫停新記錄；既有資料仍保留在本機。'));
    } catch (error) {
      renderSettings();
      reportError(l10n('無法變更記錄狀態。'), error);
    } finally {
      toggleBusy = false;
      updateControls();
    }
  });

  $('player-name').addEventListener('input', () => { formDirty = true; });
  $('hand-side').addEventListener('change', () => { formDirty = true; sideHelp(); });
  $('auto-collect-log').addEventListener('change', () => { formDirty = true; });
  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (settingsBusy || toggleBusy || exportBusy || deleteBusy || refreshBusy || !dataLoaded) return;
    settingsBusy = true;
    $('save-settings').textContent = l10n('儲存中…');
    $('settings-form').setAttribute('aria-busy', 'true');
    updateControls();
    const updated = { ...settings, playerName: $('player-name').value.trim(), handSide: $('hand-side').value,
      autoCollectLog: $('auto-collect-log').checked };
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
      settings = updated;
      formDirty = false;
      renderSettings();
      showNotice(l10n('設定已儲存。請核對最近一次手牌是否符合自己的畫面。'));
    } catch (error) {
      reportError(l10n('設定未儲存，請再試一次。'), error);
    } finally {
      settingsBusy = false;
      $('save-settings').textContent = l10n('儲存設定');
      $('settings-form').setAttribute('aria-busy', 'false');
      updateControls();
    }
  });

  $('session-select').addEventListener('change', (event) => {
    selectedKey = event.target.value;
    renderSession();
    updateControls();
  });
  $('refresh').addEventListener('click', async () => {
    if (refreshBusy || exportBusy) return;
    refreshBusy = true;
    $('refresh').textContent = l10n('讀取中…');
    $('refresh').setAttribute('aria-busy', 'true');
    updateControls();
    showNotice('');
    try { if (await loadData()) showNotice(l10n('已重新讀取本機紀錄。')); }
    finally {
      refreshBusy = false;
      $('refresh').textContent = l10n(actionLabels.refresh);
      $('refresh').setAttribute('aria-busy', 'false');
      updateControls();
    }
  });
  $('open-review').addEventListener('click', () => {
    if (!selectedSession() || exportBusy || deleteBusy) return;
    try {
      const url = new URL(chrome.runtime.getURL('review.html'), window.location.href);
      url.searchParams.set('id', selectedKey.slice(SESSION_PREFIX.length));
      window.open(url.href, '_blank', 'noopener');
      showNotice(l10n('已送出開啟要求，請查看新的對局回顧分頁。'));
    } catch (error) { reportError(l10n('無法開啟本機回顧頁。'), error); }
  });
  $('export-json').addEventListener('click', () => withPreparedSession(session => {
      downloadFile(JSON.stringify(session, null, 2), 'json', 'application/json;charset=utf-8', session);
  }, 'export-json'));
  $('export-csv').addEventListener('click', () => withPreparedSession(session => {
      const csv = globalThis.MSARecorderCore.toCSV(session);
      if (typeof csv !== 'string') throw new Error(l10n('CSV 格式不正確。'));
      downloadFile(csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv, 'csv', 'text/csv;charset=utf-8', session);
  }, 'export-csv'));
  $('sync-log').addEventListener('click', async () => {
    if (exportBusy || !selectedSession()) return;
    setRecordBusy(true, 'sync-log');
    try {
      const {session, refresh} = await prepareExport();
      showNotice(`${sessionLabel(session)}：` + (refresh?.refreshed ? l10n("已更新公開 Log。{0}請到回顧頁查看涵蓋範圍。", refresh.partial ? l10n('仍有待確認資料：')+refresh.reason+'。' : '') : l10n("未更新：{0}", refresh?.reason || l10n('請回到該場對局頁再試'))), !refresh?.refreshed || refresh?.partial);
      await loadData();
    } catch(error) { reportError(l10n('未能更新公開 Log。'), error); }
    finally { setRecordBusy(false); renderSessions(); }
  });
  $('delete-session').addEventListener('click', async () => {
    const session = selectedSession();
    if (!session || exportBusy || deleteBusy) return;
    const key = selectedKey;
    const description = `${session.playerName || l10n('玩家未辨識')} · ${dateText(session.startedAt)}`;
    if (!window.confirm(l10n("刪除「{0}」的這一筆本機記錄？此動作無法復原，建議先下載 JSON。正在記錄中的對局可能再次產生資料。", description))) return;
    deleteBusy = true;
    $('delete-session').textContent = l10n('刪除中…');
    $('delete-session').setAttribute('aria-busy', 'true');
    updateControls();
    try {
      await chrome.storage.local.remove(key);
      if (selectedKey === key) selectedKey = '';
      showNotice(l10n('已刪除此筆本機記錄。'));
      await loadData();
    } catch (error) { reportError(l10n('未能刪除記錄，請再試一次。'), error); }
    finally {
      deleteBusy = false;
      $('delete-session').textContent = l10n(actionLabels['delete-session']);
      $('delete-session').setAttribute('aria-busy', 'false');
      updateControls();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.keys(changes).some((key) => key === SETTINGS_KEY || key.startsWith(SESSION_PREFIX) || key.startsWith(STATUS_PREFIX))) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadData, 120);
  });

  await globalThis.MSAI18n?.mount(document, () => { renderSettings(); sideHelp(); renderSessions(); renderStatus(latestStatus); if(activePageReport&&!$('diagnostics-panel').hidden)renderDiagnostics(activePageReport); if(globalThis.MSAStorageHealth)MSAStorageHealth.measure(chrome.storage.local).then(health=>MSAStorageHealth.render(document,health)); });
  loadData();
})();
