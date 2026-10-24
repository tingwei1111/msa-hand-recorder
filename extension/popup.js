(() => {
  'use strict';

  const SESSION_PREFIX = 'msa.session.';
  const STATUS_PREFIX = 'msa.status.';
  const SETTINGS_KEY = 'msa.settings';
  const defaults = { enabled: true, playerName: '', handSide: 'auto', autoCollectLog: true };
  const $ = (id) => document.getElementById(id);
  const qualityLabels = { complete: '完整', partial: '部分辨識', unavailable: '無法辨識' };
  const reasonLabels = {
    'visible-hand-dom-slots': '依可見手牌欄位辨識，請與自己的實際手牌張數核對。',
    'visible-hand-counter': '已與畫面上的手牌張數標記核對。',
    'layout-transition': '畫面正在變動，手牌欄位與張數尚未一致。',
    'card-back-or-unreadable': '部分牌仍是背面，或目前無法辨識卡號。'
  };
  const dateFormatter = new Intl.DateTimeFormat('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  });
  let sessions = [];
  let selectedKey = '';
  let settings = { ...defaults };
  let formDirty = false;
  let reloadTimer;
  let loadSequence = 0;
  let exportBusy = false;

  function timeValue(value) {
    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function dateText(value) {
    const timestamp = timeValue(value);
    return timestamp ? dateFormatter.format(new Date(timestamp)) : '時間未知';
  }

  function countText(value) {
    return Number.isInteger(value) && value >= 0 ? String(value) : '未知';
  }

  function showNotice(message, error = false) {
    $('notice').textContent = message;
    $('notice').className = error ? 'notice error' : 'notice';
    $('notice').hidden = !message;
  }

  function reportError(message, error) {
    const detail = error && typeof error.message === 'string' ? ` ${error.message}` : '';
    showNotice(message + detail, true);
  }

  function selectedSession() {
    return sessions.find((entry) => entry.key === selectedKey)?.session || null;
  }

  function sideHelp() {
    $('side-help').textContent = $('hand-side').value === 'auto'
      ? '自動僅辨識下方本人手牌；旁觀或舊對局只能收錄公開 Log。'
      : '請確認這一側是你自己的手牌。此設定不會讀取或還原蓋牌。';
  }

  function renderSettings() {
    $('recording-enabled').checked = settings.enabled;
    $('recording-label').textContent = settings.enabled ? '自動記錄已啟用' : '記錄已暫停';
    $('toggle-label').textContent = settings.enabled ? '啟用中' : '已暫停';
    $('status-dot').className = settings.enabled ? 'status-dot enabled' : 'status-dot';
    if (!formDirty) {
      $('player-name').value = settings.playerName;
      $('hand-side').value = settings.handSide;
      $('auto-collect-log').checked = settings.autoCollectLog;
      sideHelp();
    }
  }

  function renderStatus(status) {
    $('status-message').textContent = status && typeof status.message === 'string'
      ? status.message
      : '尚未收到 MSA 分頁狀態。請在對局前重新整理 MSA 分頁。';
    if (!status) {
      $('status-time').textContent = '';
      return;
    }
    const context = [
      '最近分頁',
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
      option.textContent = '尚無對局記錄';
      selector.append(option);
    } else {
      for (const entry of sessions) {
        const option = document.createElement('option');
        const session = entry.session;
        option.value = entry.key;
        option.textContent = [
          dateText(session.startedAt),
          session.playerName || '玩家未辨識',
          session.gameId ? String(session.gameId).slice(0, 8) : '對局未知'
        ].join(' · ');
        selector.append(option);
      }
      selector.value = selectedKey;
    }
    selector.disabled = exportBusy || sessions.length === 0;
    $('empty-state').hidden = sessions.length > 0;
    $('session-content').hidden = sessions.length === 0;
    renderSession();
  }

  function renderSession() {
    const session = selectedSession();
    if (!session) return;
    const snapshots = session.snapshots;
    const snapshot = snapshots[snapshots.length - 1];
    $('session-meta').textContent = `對局 ${session.gameId || '未知'} · ${session.playerName || '玩家未辨識'}`;
    $('snapshot-count').textContent = String(snapshots.length);
    $('complete-count').textContent = String(snapshots.filter((item) => item?.quality === 'complete').length);
    $('turn-count').textContent = '—';
    const core = globalThis.MSARecorderCore;
    if (typeof core?.summarizeTurns === 'function') {
      try {
        const summary = core.summarizeTurns(session);
        if (Array.isArray(summary)) $('turn-count').textContent = String(summary.length);
      } catch (error) {
        reportError('無法建立回合摘要；仍可匯出原始 JSON。', error);
      }
    }
    $('export-csv').disabled = exportBusy || typeof core?.toCSV !== 'function';
    if (!core) showNotice('記錄核心未載入。請重新載入擴充功能；現有記錄仍可下載 JSON。', true);
    renderLogSummary(session);
    renderSnapshot(snapshot);
  }

  function renderLogSummary(session) {
    const logCore = globalThis.MSABattleLogCore;
    let timeline;
    try { timeline = logCore?.buildTimeline(session); }
    catch (error) { reportError('公開紀錄摘要無法載入；仍可匯出原始 JSON。', error); }
    const turns = Array.isArray(timeline?.turns) ? timeline.turns : [];
    const events = turns.flatMap((turn) => Array.isArray(turn.events) ? turn.events : [])
      .concat(Array.isArray(timeline?.unassignedEvents) ? timeline.unassignedEvents : []);
    const plays = events.filter((event) => event.isPlay === true);
    const coverage = timeline?.coverage || {};
    let label = '尚未收錄';
    let quality = 'unavailable';
    if (events.length) {
      quality = 'partial';
      label = coverage.hasGaps || coverage.unmergedCaptureCount ? '有待確認缺口'
        : coverage.publicLogComplete ? '已見開局與結束'
          : coverage.completeFromStart ? '從開局收錄中' : '部分公開紀錄';
      if (coverage.publicLogComplete && !coverage.hasGaps && !coverage.unmergedCaptureCount) quality = 'complete';
    }
    $('log-coverage').textContent = label;
    $('log-coverage').className = `badge ${quality}`;
    $('log-counts').textContent = `公開事件 ${events.length} 筆 · 出牌紀錄 ${plays.length} 筆`;
    const range = Number.isInteger(coverage.firstTurn) && Number.isInteger(coverage.lastTurn)
      ? `已見 T${coverage.firstTurn}–T${coverage.lastTurn}。` : '';
    $('log-note').textContent = range + (coverage.publicLogComplete
      ? '已收錄的 Log 包含開局與結束標記；手牌涵蓋範圍仍需另外核對。'
      : '匯出前會嘗試更新同場公開 Log；請保持對局分頁開啟。');
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
      $('quality-badge').textContent = '尚無快照';
      $('hand-empty').textContent = '此筆對局尚未收到手牌快照。';
      return;
    }
    const quality = Object.hasOwn(qualityLabels, snapshot.quality) ? snapshot.quality : 'unavailable';
    $('quality-badge').className = `badge ${quality}`;
    $('quality-badge').textContent = qualityLabels[quality];
    const hasAbsoluteTurn = snapshot.turnSource === 'log' && Number.isInteger(snapshot.turn) && snapshot.turn > 0;
    const hasEstimatedTurn = snapshot.turnSource === 'phase-observed' && Number.isInteger(snapshot.turn) && snapshot.turn > 0;
    const turn = hasAbsoluteTurn ? `第 ${snapshot.turn} 回合`
      : hasEstimatedTurn ? `推計第 ${snapshot.turn} 回合`
      : Number.isInteger(snapshot.observedTurn) && snapshot.observedTurn > 0
        ? `觀察回合 ${snapshot.observedTurn}` : '回合未辨識';
    $('snapshot-meta').textContent = [turn, snapshot.activePlayer || '', snapshot.phase || ''].filter(Boolean).join(' · ');
    $('turn-source').textContent = hasAbsoluteTurn ? '回合來源：可見 Battle Log'
      : hasEstimatedTurn ? `由先前 Log 校準後推計 · 觀察回合 ${countText(snapshot.observedTurn)}`
        : '尚無可見 Log 校準；觀察序號不等於絕對回合。';

    const cards = Array.isArray(snapshot.hand) ? snapshot.hand.filter((card) =>
      card && typeof card.cardCode === 'string' && Number.isInteger(card.count) && card.count > 0) : [];
    const recognizedCount = cards.reduce((sum, card) => sum + card.count, 0);
    $('hand-counts').textContent = `已辨識 ${recognizedCount} 張 · 預期總數 ${countText(snapshot.expectedCount)} · 未辨識 ${countText(snapshot.unknownCount)}`;
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
        ? '已確認：目前沒有手牌。'
        : '目前沒有可確認的卡號；這不代表沒有手牌。';
    }
    const reason = typeof snapshot.reason === 'string' ? snapshot.reason : '';
    $('snapshot-reason').textContent = (Object.hasOwn(reasonLabels, reason) ? reasonLabels[reason] : reason)
      || (quality !== 'complete' ? '此次辨識不完整，請與 MSA 畫面核對。未知資料不應當作空手。' : '');
    $('snapshot-reason').hidden = !$('snapshot-reason').textContent;
    if (snapshot.resources && typeof snapshot.resources === 'object') {
      $('resource-status').textContent = `資源：${globalThis.MSARecorderCore.resourceText(snapshot.resources)}`;
    }
    $('snapshot-time').textContent = `快照時間 ${dateText(snapshot.timestamp)}`;
  }

  async function loadData() {
    const sequence = ++loadSequence;
    try {
      const stored = await chrome.storage.local.get(null);
      if (sequence !== loadSequence) return;
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
      renderSettings();
      renderStatus(statuses[0]);
      renderSessions();
    } catch (error) {
      reportError('無法讀取本機記錄。請重新開啟擴充功能後再試。', error);
      $('recording-label').textContent = '資料讀取失敗';
    }
  }

  function downloadFile(contents, extension, mimeType, session = selectedSession()) {
    if (!session) throw new Error('請先選擇一筆對局。');
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
    showNotice('已發起下載，請在 Chrome 下載項目確認檔案。');
  }

  async function prepareExport() {
    const selected = selectedSession();
    const key = selectedKey;
    if (!selected) throw new Error('請先選擇一筆對局。');
    showNotice('正在更新這場 Battle Log，並等待手牌儲存完成…');
    let refresh;
    try {
      refresh = await chrome.runtime.sendMessage({type:'MSA_PREPARE_EXPORT',gameId:selected.gameId,playerName:selected.playerName});
    } catch (error) { refresh = {ok:false,refreshed:false,reason:error.message || '記錄器連線失敗'}; }
    const values = await chrome.storage.local.get(key);
    if (!values[key]) throw new Error('所選記錄已不存在。');
    return {session: {...values[key], exportInfo:{exportedAt:new Date().toISOString(),scope:'single-segment',refresh}}, refresh};
  }

  async function withPreparedSession(action) {
    if (exportBusy) return;
    exportBusy = true;
    const controls = ['export-json','export-csv','sync-log','delete-session','session-select'];
    controls.forEach(id => { $(id).disabled = true; });
    try {
      const prepared = await prepareExport();
      await action(prepared.session);
      const suffix = prepared.refresh?.refreshed ? (prepared.refresh.partial ? `已更新 Log，但仍有待確認資料：${prepared.refresh.reason || '請查看涵蓋狀態'}。` : '已更新公開 Log。') : `本次未能更新 Log：${prepared.refresh?.reason || '對局分頁未回應'}。`;
      showNotice(suffix + ' 本段匯出已發起；整場相容段落請使用回顧頁匯出。', !prepared.refresh?.refreshed || prepared.refresh?.partial);
    } catch (error) { reportError('無法完成匯出。', error); }
    finally { exportBusy=false; controls.forEach(id => { $(id).disabled = false; }); await loadData(); }
  }

  $('recording-enabled').addEventListener('change', async (event) => {
    const enabled = event.target.checked;
    event.target.disabled = true;
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled } });
      settings.enabled = enabled;
      renderSettings();
      showNotice(enabled ? '自動記錄已啟用。請確認 MSA 分頁狀態。' : '已暫停新記錄；既有資料仍保留在本機。');
    } catch (error) {
      renderSettings();
      reportError('無法變更記錄狀態。', error);
    } finally {
      event.target.disabled = false;
    }
  });

  $('player-name').addEventListener('input', () => { formDirty = true; });
  $('hand-side').addEventListener('change', () => { formDirty = true; sideHelp(); });
  $('auto-collect-log').addEventListener('change', () => { formDirty = true; });
  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('save-settings').disabled = true;
    const updated = { ...settings, playerName: $('player-name').value.trim(), handSide: $('hand-side').value,
      autoCollectLog: $('auto-collect-log').checked };
    try {
      await chrome.storage.local.set({ [SETTINGS_KEY]: updated });
      settings = updated;
      formDirty = false;
      renderSettings();
      showNotice('設定已儲存。請核對最近一次手牌是否符合自己的畫面。');
    } catch (error) {
      reportError('設定未儲存，請再試一次。', error);
    } finally {
      $('save-settings').disabled = false;
    }
  });

  $('session-select').addEventListener('change', (event) => {
    selectedKey = event.target.value;
    renderSession();
  });
  $('refresh').addEventListener('click', () => { showNotice(''); loadData(); });
  $('open-review').addEventListener('click', () => {
    if (!selectedSession()) return;
    try {
      const url = new URL(chrome.runtime.getURL('review.html'), window.location.href);
      url.searchParams.set('id', selectedKey.slice(SESSION_PREFIX.length));
      window.open(url.href, '_blank', 'noopener');
    } catch (error) { reportError('無法開啟本機回顧頁。', error); }
  });
  $('export-json').addEventListener('click', () => withPreparedSession(session => {
      downloadFile(JSON.stringify(session, null, 2), 'json', 'application/json;charset=utf-8', session);
  }));
  $('export-csv').addEventListener('click', () => withPreparedSession(session => {
      const csv = globalThis.MSARecorderCore.toCSV(session);
      if (typeof csv !== 'string') throw new Error('CSV 格式不正確。');
      downloadFile(csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv, 'csv', 'text/csv;charset=utf-8', session);
  }));
  $('sync-log').addEventListener('click', async () => {
    if (exportBusy || !selectedSession()) return;
    exportBusy=true; $('sync-log').disabled=true;
    try {
      const {refresh} = await prepareExport();
      showNotice(refresh?.refreshed ? `已更新這場公開 Log。${refresh.partial ? '仍有待確認資料：'+refresh.reason+'。' : ''}請到回顧頁查看整場涵蓋範圍。` : `未更新：${refresh?.reason || '請回到該場對局頁再試'}`, !refresh?.refreshed || refresh?.partial);
      await loadData();
    } catch(error) { reportError('未能更新公開 Log。', error); }
    finally { exportBusy=false; $('sync-log').disabled=false; renderSessions(); }
  });
  $('delete-session').addEventListener('click', async () => {
    const session = selectedSession();
    if (!session) return;
    const key = selectedKey;
    const description = `${session.playerName || '玩家未辨識'} · ${dateText(session.startedAt)}`;
    if (!window.confirm(`刪除「${description}」的這一筆本機記錄？此動作無法復原，建議先下載 JSON。正在記錄中的對局可能再次產生資料。`)) return;
    $('delete-session').disabled = true;
    try {
      await chrome.storage.local.remove(key);
      if (selectedKey === key) selectedKey = '';
      showNotice('已刪除此筆本機記錄。');
      await loadData();
    } catch (error) { reportError('未能刪除記錄，請再試一次。', error); }
    finally { $('delete-session').disabled = false; }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (!Object.keys(changes).some((key) => key === SETTINGS_KEY || key.startsWith(SESSION_PREFIX) || key.startsWith(STATUS_PREFIX))) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadData, 120);
  });

  loadData();
})();
