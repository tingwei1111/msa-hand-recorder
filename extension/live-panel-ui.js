(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSALivePanelUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function create(options) {
    options = options || {};
    var doc = root.document;
    if (!doc || !doc.documentElement) throw new Error('A document is required to create the live panel.');
    if (doc.getElementById('msa-live-panel')) throw new Error('MSA live panel already exists.');
    var win = doc.defaultView || root;
    var destroyed = false;
    var preferences = { expanded: false, left: null, top: null };
    var model = {};
    var refreshing = false;
    var reviewing = false;
    var drag = null;
    var keyboardDirty = false;
    var consumeEscapeRelease = false;
    var dialogFrame = null;
    var dialogVisible = false;
    var resizeObserver = null;
    var dialogObserver = null;
    var handRows = new Map();
    var playRows = new Map();

    function node(tag, className, value) {
      var item = doc.createElement(tag);
      if (className) item.className = className;
      if (value !== undefined) item.textContent = String(value);
      return item;
    }
    function text(item, value) {
      var next = value === null || value === undefined ? '' : String(value);
      if (item.textContent !== next) item.textContent = next;
    }
    function button(label, action) {
      var item = node('button', '', label);
      item.type = 'button';
      item.dataset.action = action;
      return item;
    }
    function tone(value) { return ['success', 'warning', 'error', 'neutral'].indexOf(value) >= 0 ? value : 'neutral'; }
    function count(value) { return Number.isSafeInteger(value) && value >= 0 ? String(value) : '未知'; }
    function time(value) {
      var date = new Date(value);
      if (!value || !Number.isFinite(date.getTime())) return '時間未知';
      return new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    }
    function getPreferences() { return { expanded: preferences.expanded, left: preferences.left, top: preferences.top }; }
    function actionMessage(value, warning) {
      text(actionStatus, value);
      actionStatus.hidden = !value;
      actionStatus.className = 'action-status' + (warning ? ' warning' : '');
    }
    function reportError(error, fallback) {
      if (destroyed) return;
      var message = error && error.message ? error.message : error ? String(error) : '';
      actionMessage(fallback + (message ? '：' + message : ''), true);
      if (typeof options.onError === 'function') {
        try { options.onError(error instanceof Error ? error : new Error(message || fallback)); } catch (_) { /* UI remains usable. */ }
      }
    }
    function savePreferences() {
      if (destroyed || typeof options.onPreferencesChange !== 'function') return;
      try {
        Promise.resolve(options.onPreferencesChange(getPreferences())).catch(function (error) {
          reportError(error, '小窗位置或展開偏好未能儲存');
        });
      } catch (error) { reportError(error, '小窗位置或展開偏好未能儲存'); }
    }

    var host = node('div');
    host.id = 'msa-live-panel';
    host.setAttribute('data-msa-recorder-ui', 'true');
    // A zero-size, non-interactive host does not cover the game. Every changing
    // style and all visible text live inside Shadow DOM, outside DOM sampling.
    host.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:30!important;pointer-events:none!important;';
    var shadow = host.attachShadow({ mode: 'open' });
    var style = node('style');
    style.textContent = `
      :host { color-scheme:light; }
      *, *::before, *::after { box-sizing:border-box; }
      [hidden] { display:none!important; }
      .surface { position:fixed; width:320px; max-width:calc(100vw - 16px); pointer-events:auto; color:#17313b; font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif; text-align:left; color-scheme:light; }
      button { font:inherit; cursor:pointer; border:1px solid #cbd8cf; border-radius:7px; min-height:36px; padding:7px 10px; color:#17313b; background:#fff; }
      button:hover:not(:disabled) { background:#eaf2ec; }
      button:disabled { opacity:.48; cursor:default; }
      button:focus-visible, summary:focus-visible, .panel-header:focus-visible { outline:3px solid #168d81; outline-offset:2px; }
      .launcher { display:flex; align-items:center; gap:8px; min-height:42px; padding:9px 13px; border-color:#a9c8b8; border-radius:12px; color:#17313b; background:#f5f6f2; box-shadow:0 4px 18px #17313b1c; font-weight:650; }
      .status-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#94a69b; flex-shrink:0; }
      .status-dot.success { background:#087f75; }.status-dot.warning { background:#c38b33; }.status-dot.error { background:#b2573b; }
      .launcher-count { font-size:10px; color:#627571; font-weight:500; }
      .panel { display:flex; flex-direction:column; width:100%; max-height:min(540px,calc(100vh - 80px)); overflow:hidden; border:1px solid #b7cbbb; border-radius:13px; background:#f5f6f2; box-shadow:0 8px 30px #17313b26; }
      .panel-header { display:flex; align-items:center; justify-content:space-between; gap:9px; flex-shrink:0; padding:11px 12px; border-bottom:1px solid #dce4dd; cursor:grab; touch-action:none; user-select:none; }
      .panel-header.dragging { cursor:grabbing; }
      .heading { display:flex; align-items:center; gap:8px; min-width:0; }
      .grip { color:#8fa194; font-size:15px; letter-spacing:-2px; }
      h2 { margin:0; font-size:14px; line-height:1.4; font-weight:700; }
      .eyebrow { color:#087f75; font-size:9px; font-weight:650; letter-spacing:.1em; }
      .collapse { min-height:32px; padding:5px 8px; font-size:11px; background:transparent; flex-shrink:0; }
      .scroll { padding:12px; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
      p { margin:0; overflow-wrap:anywhere; }
      .state { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px; font-size:12px; font-weight:650; }
      .state.warning,.state.error { color:#865c1e; }
      .detail,.meta { color:#627571; font-size:10px; overflow-wrap:anywhere; }
      .detail { margin-bottom:11px; }
      .section { margin-top:12px; }
      .section-title { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin:0 0 7px; }
      h3 { font-size:12px; margin:0; font-weight:700; }
      .section-count { color:#627571; font-size:10px; }
      .hand { background:white; border:1px solid #dce4dd; border-radius:9px; padding:10px 11px; }
      .hand-head { display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
      .quality { font-size:9px; font-weight:650; padding:3px 6px; border-radius:4px; background:#eef2ed; color:#526962; }
      .quality.complete { background:#e8f4ed; color:#176551; }
      .quality.partial,.quality.unavailable { background:#fff0d6; color:#865c1e; }
      .turn { color:#415d54; font-size:10px; }
      .hand-summary { color:#17313b; font-size:11px; }
      .hand-list,.play-list,.issue-list { list-style:none; padding:0; margin:8px 0 0; }
      .hand-list li { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #eef2eb; }
      .hand-list li:last-child { border-bottom:0; }
      .card-code { font:11px/1.5 ui-monospace,"SFMono-Regular",Consolas,monospace; color:#315d59; overflow-wrap:anywhere; }
      .card-count { font-size:10px; font-weight:700; color:#17313b; background:#f0f4ed; border-radius:4px; padding:1px 5px; flex-shrink:0; }
      .saved { margin-top:8px; font-size:9px; color:#627571; }
      .resources { margin-top:7px; padding-top:7px; border-top:1px solid #edf1e9; color:#526c5f; font-size:10px; }
      .plays-note { color:#627571; font-size:10px; margin-bottom:4px; }
      .play-list { margin-top:6px; }
      .play { background:white; border:1px solid #dce4dd; border-left:3px solid #9ea99f; border-radius:7px; padding:8px 9px; margin-top:6px; overflow-wrap:anywhere; }
      .play.own { border-left-color:#087f75; }.play.opponent { border-left-color:#7b92a6; }
      .play-head { display:flex; justify-content:space-between; align-items:flex-start; gap:7px; font-size:10px; }
      .actor { font-weight:650; min-width:0; overflow-wrap:anywhere; }
      .play-turn { flex-shrink:0; color:#627571; font-size:9px; }
      .play-card { margin-top:3px; font-size:11px; font-weight:600; }
      .play-action { color:#627571; font-size:9px; margin-top:3px; }
      .raw { margin-top:4px; }.raw summary { color:#708278; font-size:9px; cursor:pointer; }
      .raw p { font-size:10px; color:#52685e; white-space:pre-wrap; margin-top:5px; }
      .empty { padding:10px; border:1px dashed #cad8cb; border-radius:7px; color:#627571; font-size:11px; }
      .coverage { margin-top:12px; padding:9px 10px; border-radius:7px; background:#edf3ed; }
      .coverage.warning { background:#fff3df; color:#865c1e; }
      .coverage-label { font-size:10px; font-weight:650; }
      .coverage-boundary { color:#627571; font-size:9px; margin-top:4px; }
      .issues { margin-top:8px; padding:9px 10px; border-left:3px solid #d8a14e; border-radius:5px; background:#fff3df; color:#865c1e; }
      .issues summary { cursor:pointer; font-size:10px; font-weight:650; }
      .issue-list { font-size:10px; }
      .issue-list li + li { margin-top:7px; }
      .footer { flex-shrink:0; padding:10px 12px; border-top:1px solid #dce4dd; background:#f5f6f2; }
      .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .review { background:#087f75; color:white; border-color:#087f75; }
      .review:hover:not(:disabled) { background:#06685f; }
      .action-status { color:#416957; font-size:10px; margin-top:7px; }
      .action-status.warning { color:#865c1e; }
      .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
      @media (max-height:240px) { .panel { max-height:calc(100vh - 16px); }.panel-header { padding:7px 10px; }.footer { padding:7px 10px; } }
      @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important; } }
    `;
    shadow.append(style);
    var surface = node('div', 'surface');
    surface.dataset.role = 'surface';
    var launcher = button('', 'expand');
    launcher.className = 'launcher';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'msa-live-panel-content');
    var launcherDot = node('span', 'status-dot');
    launcherDot.setAttribute('aria-hidden', 'true');
    var launcherCount = node('span', 'launcher-count');
    launcher.append(launcherDot, node('span', '', '對戰小窗'), launcherCount);
    var panel = node('section', 'panel');
    panel.id = 'msa-live-panel-content';
    panel.setAttribute('aria-label', 'MSA 即時記錄小窗');
    panel.hidden = true;
    var header = node('header', 'panel-header');
    header.tabIndex = 0;
    header.setAttribute('role', 'group');
    header.setAttribute('aria-label', '移動對戰小窗');
    header.setAttribute('aria-describedby', 'msa-live-move-help');
    var heading = node('div', 'heading');
    var grip = node('span', 'grip', '⋮⋮');
    grip.setAttribute('aria-hidden', 'true');
    var titles = node('div');
    titles.append(node('div', 'eyebrow', 'MSA · 本機記錄'), node('h2', '', '對戰小窗'));
    heading.append(grip, titles);
    var collapse = button('收合', 'collapse');
    collapse.className = 'collapse';
    collapse.setAttribute('aria-label', '收合對戰小窗');
    var moveHelp = node('span', 'sr-only', '拖曳標題移動；聚焦標題後以方向鍵每次移動 10 像素，Home 重設位置。Esc 收合。');
    moveHelp.id = 'msa-live-move-help';
    header.append(heading, collapse, moveHelp);
    var scroll = node('div', 'scroll');
    scroll.dataset.role = 'scroll';
    var status = node('p', 'state neutral');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var statusDot = node('span', 'status-dot');
    statusDot.setAttribute('aria-hidden', 'true');
    var statusLabel = node('span', '', '等待記錄');
    status.append(statusDot, statusLabel);
    var statusDetail = node('p', 'detail', '對局開始並儲存觀察後，會顯示在這裡。');
    var modelNotice = node('p', 'action-status warning');
    modelNotice.hidden = true;
    var handSection = node('section', 'section');
    var handTitle = node('div', 'section-title');
    var handCount = node('span', 'section-count');
    handTitle.append(node('h3', '', '目前已存手牌'), handCount);
    var hand = node('div', 'hand');
    var handHead = node('div', 'hand-head');
    var turn = node('span', 'turn');
    var quality = node('span', 'quality unavailable', '尚未觀察');
    handHead.append(turn, quality);
    var handSummary = node('p', 'hand-summary', '尚無已儲存手牌，不能視為空手。');
    var handList = node('ul', 'hand-list');
    handList.setAttribute('aria-label', '已儲存手牌卡號與數量');
    var saved = node('p', 'saved');
    var resources = node('p', 'resources', '資源未辨識');
    hand.append(handHead, handSummary, handList, saved, resources);
    handSection.append(handTitle, hand);
    var playSection = node('section', 'section');
    var playTitle = node('div', 'section-title');
    var playCount = node('span', 'section-count');
    playTitle.append(node('h3', '', '最近公開出牌'), playCount);
    var playNote = node('p', 'plays-note', '最新在上 · 最多 20 筆 · 含 Token 生成');
    var playList = node('ol', 'play-list');
    playList.setAttribute('aria-label', '雙方最近公開出牌，最新在前');
    var playEmpty = node('p', 'empty', '尚無已儲存的公開出牌。可按「更新 Log」重新讀取。');
    playSection.append(playTitle, playNote, playList, playEmpty);
    var coverage = node('section', 'coverage');
    var coverageLabel = node('p', 'coverage-label', '尚未收錄公開 Log');
    var publicCount = node('p', 'meta');
    coverage.append(coverageLabel, publicCount, node('p', 'coverage-boundary', '即使公開 Log 已見起尾，也不代表手牌全程完整。未觀察的歷史手牌無法補回。'));
    var issues = node('details', 'issues');
    issues.hidden = true;
    var issueTitle = node('summary');
    var issueList = node('ul', 'issue-list');
    issues.append(issueTitle, issueList);
    scroll.append(status, statusDetail, modelNotice, handSection, playSection, coverage, issues);
    var footer = node('footer', 'footer');
    var actions = node('div', 'actions');
    var refreshButton = button('更新 Log', 'refresh');
    var reviewButton = button('對局回顧', 'review');
    reviewButton.className = 'review';
    refreshButton.disabled = true;
    reviewButton.disabled = true;
    actions.append(refreshButton, reviewButton);
    var actionStatus = node('p', 'action-status');
    actionStatus.hidden = true;
    actionStatus.setAttribute('role', 'status');
    actionStatus.setAttribute('aria-live', 'polite');
    footer.append(actions, actionStatus);
    panel.append(header, scroll, footer);
    surface.append(launcher, panel);
    shadow.append(surface);
    doc.documentElement.append(host);

    function viewport() {
      return { width: Math.max(1, win.innerWidth || doc.documentElement.clientWidth || 320),
        height: Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 600) };
    }
    function place() {
      if (destroyed) return;
      var view = viewport();
      surface.style.width = preferences.expanded ? Math.max(1, Math.min(320, view.width - 16)) + 'px' : 'max-content';
      var rect = surface.getBoundingClientRect();
      var width = rect.width || (preferences.expanded ? Math.min(320, view.width - 16) : 132);
      var height = rect.height || (preferences.expanded ? Math.min(540, view.height - 80) : 42);
      var edge = 8;
      var left = preferences.left === null ? view.width - width - 16 : preferences.left;
      var top = preferences.top === null ? view.height - height - 24 : preferences.top;
      var maxLeft = Math.max(edge, view.width - width - edge);
      var maxTop = Math.max(edge, view.height - height - edge);
      surface.style.left = Math.round(Math.max(edge, Math.min(maxLeft, left))) + 'px';
      surface.style.top = Math.round(Math.max(edge, Math.min(maxTop, top))) + 'px';
    }
    function expand(value, notify, focus) {
      if (destroyed) return;
      preferences.expanded = Boolean(value);
      panel.hidden = !preferences.expanded;
      launcher.hidden = preferences.expanded;
      launcher.setAttribute('aria-expanded', String(preferences.expanded));
      place();
      if (notify) savePreferences();
      if (focus && !dialogVisible) (preferences.expanded ? header : launcher).focus({ preventScroll: true });
    }
    function setPreferences(value) {
      if (destroyed) return;
      value = value || {};
      if (typeof value.expanded === 'boolean') preferences.expanded = value.expanded;
      ['left', 'top'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(value, key)) preferences[key] = typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : null;
      });
      expand(preferences.expanded, false, false);
    }
    function updateButtons() {
      refreshButton.disabled = refreshing || !model.gameId || typeof options.onRefresh !== 'function';
      refreshButton.setAttribute('aria-busy', String(refreshing));
      text(refreshButton, refreshing ? '更新中…' : '更新 Log');
      reviewButton.disabled = reviewing || !model.sessionId || model.canReview === false || typeof options.onReview !== 'function';
      reviewButton.setAttribute('aria-busy', String(reviewing));
    }
    var actionLabels = { 'deploy-unit': '部署機體', 'deploy-token': 'Token 生成', 'play-command': '使用 Command',
      'play-action': '使用 Action', 'play-base': '部署基地', 'replace-base': '替換基地', 'pair-pilot': '配對駕駛', 'link-pilot': '連結駕駛' };
    function reconcile(parent, rows, items, makeRow, updateRow, keyFor) {
      var seen = new Set();
      items.forEach(function (item, index) {
        var key = keyFor(item, index);
        seen.add(key);
        var row = rows.get(key);
        if (!row) { row = makeRow(); rows.set(key, row); }
        updateRow(row, item, index);
        if (parent.children[index] !== row.element) parent.insertBefore(row.element, parent.children[index] || null);
      });
      rows.forEach(function (row, key) { if (!seen.has(key)) { row.element.remove(); rows.delete(key); } });
    }
    function update(next) {
      if (destroyed) return;
      next = next && typeof next === 'object' ? next : {};
      if (model.gameId !== next.gameId || model.sessionId !== next.sessionId) actionMessage('', false);
      model = next;
      var scrollTop = scroll.scrollTop;
      var focused = shadow.activeElement;
      var stateTone = tone(model.statusTone);
      status.className = 'state ' + stateTone;
      statusDot.className = 'status-dot ' + stateTone;
      launcherDot.className = 'status-dot ' + stateTone;
      text(statusLabel, model.statusLabel || '等待記錄');
      text(statusDetail, model.statusDetail || '尚無已儲存資料；請在對局中確認記錄已啟用。');
      text(modelNotice, [model.preferenceError, model.refreshMessage].filter(Boolean).join(' · '));
      modelNotice.hidden = !model.preferenceError && !model.refreshMessage;
      text(launcherCount, Number.isSafeInteger(model.snapshotCount) && model.snapshotCount > 0 ? model.snapshotCount + ' 筆' : '');
      launcher.setAttribute('aria-label', '開啟對戰小窗；' + (model.statusLabel || '等待記錄'));
      text(handCount, count(model.snapshotCount) + ' 筆快照');
      text(turn, model.currentTurnLabel || '回合未確認');
      quality.className = 'quality ' + (['complete', 'partial', 'unavailable'].indexOf(model.quality) >= 0 ? model.quality : 'unavailable');
      text(quality, model.qualityLabel || '尚未觀察');
      text(handSummary, model.handSummary || '尚無已儲存手牌，不能視為空手。');
      // Only the projection's confirmed current run may expose saved hand data.
      var cards = model.identityConfirmed && model.latestSnapshot && Array.isArray(model.handCards) ? model.handCards : [];
      reconcile(handList, handRows, cards, function () {
        var item = node('li'), code = node('span', 'card-code'), quantity = node('span', 'card-count');
        item.append(code, quantity); return { element: item, code: code, quantity: quantity };
      }, function (row, card) { text(row.code, card.cardCode || '卡號未知'); text(row.quantity, '× ' + count(card.count)); },
      function (card, index) { return String(card.cardCode || '') + ':' + index; });
      text(saved, model.latestSnapshot && model.identityConfirmed ? '最後已存觀察 ' + time(model.latestSnapshot.timestamp) + ' · ' + (model.playerName || '玩家未辨識') : '只有成功儲存的本人手牌才會顯示。');
      text(resources, model.resourcesText || '資源未辨識');
      var plays = Array.isArray(model.recentPlays) ? model.recentPlays.slice(0, 20) : [];
      text(playCount, plays.length + ' 筆');
      playEmpty.hidden = plays.length > 0;
      reconcile(playList, playRows, plays, function () {
        var item = node('li', 'play'), head = node('div', 'play-head'), actor = node('span', 'actor'), turnLabel = node('span', 'play-turn');
        var cardLabel = node('p', 'play-card'), action = node('p', 'play-action'), raw = node('details', 'raw'), rawText = node('p');
        raw.append(node('summary', '', '公開原文'), rawText); head.append(actor, turnLabel); item.append(head, cardLabel, action, raw);
        return { element: item, actor: actor, turn: turnLabel, card: cardLabel, action: action, rawText: rawText };
      }, function (row, play) {
        var side = model.identityConfirmed && ['own', 'opponent'].indexOf(play.actorSide) >= 0 ? play.actorSide : 'unknown';
        row.element.className = 'play ' + side;
        text(row.actor, (side === 'own' ? '自己 · ' : '') + (play.actor || '玩家未確認'));
        text(row.turn, Number.isSafeInteger(play.turn) && play.turn > 0 ? 'T' + play.turn : '回合未標');
        text(row.card, [play.cardName, play.cardCode].filter(Boolean).join(' · ') || '卡牌未確認');
        text(row.action, (actionLabels[play.action] || play.action || '公開事件') + (play.action === 'deploy-token' ? ' · 非手牌出牌' : ' · 來源區域未確認'));
        text(row.rawText, play.rawText || '沒有公開原文');
      }, function (play, index) { return String(play.sourceSessionId || '') + ':' + (play.id || String(index) + ':' + (play.rawText || '')); });
      coverage.className = 'coverage ' + tone(model.coverageTone);
      text(coverageLabel, model.coverageLabel || '尚未收錄公開 Log');
      text(publicCount, count(model.publicEventCount) + ' 筆公開事件 · ' + count(model.publicPlayCount) + ' 次公開出牌');
      var captureIssues = Array.isArray(model.captureIssues) ? model.captureIssues : [];
      issues.hidden = !captureIssues.length;
      text(issueTitle, '手牌擷取缺口 · ' + captureIssues.length + ' 筆');
      var issueText = captureIssues.map(function (issue) {
        if (!issue || typeof issue !== 'object') return String(issue || '原因未提供');
        return [issue.reason || issue.code || '原因未提供', issue.pendingCount === undefined ? '' : '待存 ' + count(issue.pendingCount) + ' 筆', issue.observedAt ? time(issue.observedAt) : ''].filter(Boolean).join(' · ');
      });
      if (issueList.dataset.signature !== JSON.stringify(issueText)) {
        issueList.replaceChildren();
        issueText.forEach(function (value) { issueList.append(node('li', '', value)); });
        issueList.dataset.signature = JSON.stringify(issueText);
      }
      updateButtons();
      place();
      scroll.scrollTop = scrollTop;
      if (focused && focused.isConnected && shadow.activeElement !== focused && !focused.disabled && !dialogVisible) focused.focus({ preventScroll: true });
    }

    function setPosition(left, top) {
      preferences.left = left; preferences.top = top; place();
      var rect = surface.getBoundingClientRect();
      preferences.left = Math.round(rect.left); preferences.top = Math.round(rect.top);
    }
    function finishDrag(event, cancelled) {
      if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      var previous = drag; drag = null;
      header.classList.remove('dragging');
      try { if (header.hasPointerCapture(previous.pointerId)) header.releasePointerCapture(previous.pointerId); } catch (_) { /* Pointer capture may already be released. */ }
      if (cancelled) { preferences.left = previous.preferences.left; preferences.top = previous.preferences.top; place(); }
      else if (previous.moved) savePreferences();
    }
    function flushKeyboard() { if (keyboardDirty) { keyboardDirty = false; savePreferences(); } }
    launcher.addEventListener('click', function () { expand(true, true, true); });
    collapse.addEventListener('click', function () { expand(false, true, true); });
    header.addEventListener('pointerdown', function (event) {
      if (destroyed || event.button !== 0 || event.target.closest('button,a,input,select,textarea,summary')) return;
      var rect = surface.getBoundingClientRect();
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, preferences: getPreferences(), moved: false };
      header.classList.add('dragging');
      header.focus({ preventScroll: true });
      try { header.setPointerCapture(event.pointerId); } catch (_) { /* Available in supported Chrome. */ }
      event.preventDefault(); event.stopPropagation();
    });
    header.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      if (drag.moved) setPosition(drag.left + dx, drag.top + dy);
      event.preventDefault(); event.stopPropagation();
    });
    header.addEventListener('pointerup', function (event) { if (drag) { event.preventDefault(); event.stopPropagation(); finishDrag(event, false); } });
    header.addEventListener('pointercancel', function (event) { finishDrag(event, true); });
    header.addEventListener('lostpointercapture', function (event) { finishDrag(event, true); });
    header.addEventListener('blur', flushKeyboard);
    shadow.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && preferences.expanded) {
        consumeEscapeRelease = true;
        event.preventDefault(); event.stopPropagation(); finishDrag(null, true); flushKeyboard(); expand(false, true, true); return;
      }
      if (event.target === header && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].indexOf(event.key) >= 0) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') { preferences.left = null; preferences.top = null; place(); }
        else {
          var rect = surface.getBoundingClientRect();
          setPosition(rect.left + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0),
            rect.top + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0));
        }
        keyboardDirty = true;
      } else if (event.target.closest('button') && (event.key === 'Enter' || event.key === ' ')) event.stopPropagation();
    });
    shadow.addEventListener('keyup', function (event) {
      if (event.key === 'Escape' && consumeEscapeRelease) {
        consumeEscapeRelease = false; event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.target === header && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].indexOf(event.key) >= 0) {
        event.preventDefault(); event.stopPropagation(); flushKeyboard();
      }
    });
    // Only events originating in this small surface are contained. No global
    // game keyboard or pointer listener is installed or prevented.
    ['click', 'pointerdown', 'pointerup'].forEach(function (eventName) {
      surface.addEventListener(eventName, function (event) { event.stopPropagation(); });
    });
    refreshButton.addEventListener('click', async function () {
      if (refreshing || refreshButton.disabled || destroyed) return;
      refreshing = true; actionMessage('正在更新公開 Log；請稍候。', false); updateButtons();
      var context = String(model.gameId || '') + '|' + String(model.sessionId || '');
      try {
        var result = await options.onRefresh();
        if (destroyed || context !== String(model.gameId || '') + '|' + String(model.sessionId || '')) return;
        if (result && (result.ok === false || result.refreshed === false || result.partial)) actionMessage(result.reason || result.error || '未能確認完整刷新；既有記錄仍保留。', true);
        else if (result && result.refreshed === true) actionMessage('公開 Log 已刷新；手牌缺口仍需個別確認。', false);
        else actionMessage('更新要求已完成，請核對公開事件筆數與涵蓋狀態。', false);
      } catch (error) {
        if (context === String(model.gameId || '') + '|' + String(model.sessionId || '')) reportError(error, '更新 Log 失敗，既有記錄仍保留');
      }
      finally { refreshing = false; if (!destroyed) { updateButtons(); place(); } }
    });
    reviewButton.addEventListener('click', async function () {
      if (reviewing || reviewButton.disabled || destroyed) return;
      reviewing = true; updateButtons();
      var context = String(model.gameId || '') + '|' + String(model.sessionId || '');
      try {
        var result = await options.onReview();
        if (destroyed || context !== String(model.gameId || '') + '|' + String(model.sessionId || '')) return;
        if (result && result.ok === false) reportError(result.error || result.reason || '無法開啟', '對局回顧未開啟');
      } catch (error) {
        if (context === String(model.gameId || '') + '|' + String(model.sessionId || '')) reportError(error, '對局回顧未開啟');
      }
      finally { reviewing = false; if (!destroyed) updateButtons(); }
    });

    function visibleSiteDialog() {
      return Array.from(doc.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"]')).some(function (item) {
        if (item === host || host.contains(item) || item.getAttribute('aria-hidden') === 'true' || !item.getClientRects().length) return false;
        var computed = win.getComputedStyle(item);
        return computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0';
      });
    }
    function checkDialogs() {
      dialogFrame = null;
      if (destroyed) return;
      var next = visibleSiteDialog();
      if (next === dialogVisible) return;
      dialogVisible = next;
      // Temporarily yield to site dialogs without touching the game UI or
      // discarding the user's expanded/position preferences.
      surface.style.visibility = next ? 'hidden' : '';
      surface.inert = next;
      if (next) { finishDrag(null, true); flushKeyboard(); }
      else place();
    }
    function scheduleDialogs() {
      if (!destroyed && dialogFrame === null) dialogFrame = win.requestAnimationFrame(checkDialogs);
    }
    win.addEventListener('resize', place);
    if (win.visualViewport) win.visualViewport.addEventListener('resize', place);
    if (typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(place); resizeObserver.observe(surface); }
    if (typeof win.MutationObserver === 'function') {
      dialogObserver = new win.MutationObserver(scheduleDialogs);
      dialogObserver.observe(doc.documentElement, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['role', 'aria-modal', 'aria-hidden', 'open', 'style', 'class'] });
    }
    update({});
    checkDialogs();

    return Object.freeze({
      update: update,
      setPreferences: setPreferences,
      getPreferences: getPreferences,
      focusLauncher: function () { if (!destroyed && !dialogVisible) (preferences.expanded ? header : launcher).focus({ preventScroll: true }); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (dialogObserver) dialogObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        if (dialogFrame !== null) win.cancelAnimationFrame(dialogFrame);
        win.removeEventListener('resize', place);
        if (win.visualViewport) win.visualViewport.removeEventListener('resize', place);
        host.remove(); handRows.clear(); playRows.clear();
      }
    });
  }
  return Object.freeze({ create: create });
});
