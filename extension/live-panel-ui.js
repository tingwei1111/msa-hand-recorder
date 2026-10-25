(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSALivePanelUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function normalizePreferences(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    var bounded = function (item, fallback, min, max) { return typeof item === 'number' && Number.isFinite(item) ? Math.max(min, Math.min(max, Math.round(item))) : fallback; };
    return Object.assign({}, value, {expanded:value.expanded === true,
      left:typeof value.left === 'number' && Number.isFinite(value.left) ? bounded(value.left,0,0,100000) : null,
      top:typeof value.top === 'number' && Number.isFinite(value.top) ? bounded(value.top,0,0,100000) : null,
      tab:['deck','hand','events','all'].indexOf(value.tab) >= 0 ? value.tab : 'hand',
      width:bounded(value.width,320,280,480),fontSize:bounded(value.fontSize,12,11,16),
      dock:['free','left','right'].indexOf(value.dock) >= 0 ? value.dock : 'free'});
  }
  function safeCardImageSource(value, imageUrl, expectedCode) {
    if (typeof imageUrl !== 'string' || imageUrl.length > 500 || /[\s\\%]/.test(imageUrl)) return null;
    try {
      var url = new URL(imageUrl);
      var match = url.pathname.match(/^\/(en|jp|zh-tw)\/images\/cards\/card\/([A-Z0-9]+-\d{3})(?:_p\d{1,3})?\.(?:webp|png|jpe?g)$/);
      if (url.origin !== 'https://www.gundam-gcg.com' || url.username || url.password || url.port || url.hash ||
        !match || !cardCode(match[2]) || !cardCode(expectedCode) || match[2] !== expectedCode ||
        (url.search && !/^\?\d{6,14}=?$/.test(url.search))) return null;
    } catch (_) { return null; }
    return typeof value === 'string' && value.length <= 3 * 1024 * 1024 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
  }
  function cardCode(value) { return typeof value === 'string' && /^(?:(?:GD|ST|EB|SC|SLB)\d{2,3}|EXB|EXR|PR|P|R|T)-\d{3}$/.test(value) ? value : null; }
  function officialSource(value) {
    try { var url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.gundam-gcg.com' && !url.username && !url.password && !url.port ? url.href : null; }
    catch (_) { return null; }
  }

  function create(options) {
    options = options || {};
    var doc = root.document;
    if (!doc || !doc.documentElement) throw new Error('A document is required to create the live panel.');
    if (doc.getElementById('msa-live-panel')) throw new Error('MSA live panel already exists.');
    var win = doc.defaultView || root;
    var destroyed = false;
    var preferences = normalizePreferences();
    var model = {};
    var refreshing = false;
    var reviewing = false;
    var bookmarking = false;
    var bookmarkAnchor = null;
    var lookupSequence = 0;
    var lookupTimer = null;
    var previewTrigger = null;
    var previewPinned = false;
    var previewCode = '';
    var restoringPreviewFocus = null;
    var tabScroll = {deck:0,hand:0,events:0,all:0};
    var lastDeltaKey = '';
    var acknowledgedAlerts = new Set();
    var alertRows = new Map();
    var endNoticeDismissed = false;
    var managing = false;
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
    function getPreferences() { return Object.assign({}, preferences); }
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
          reportError(error, '小窗顯示偏好未能儲存');
        });
      } catch (error) { reportError(error, '小窗顯示偏好未能儲存'); }
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
      :host { color-scheme:dark; }
      *, *::before, *::after { box-sizing:border-box; }
      [hidden] { display:none!important; }
      .surface { position:fixed; width:320px; max-width:calc(100vw - 16px); pointer-events:auto; color:#e7edf7; font:var(--panel-font-size,12px)/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif; text-align:left; color-scheme:dark; }
      button { font:inherit; cursor:pointer; border:1px solid #344c62; border-radius:7px; min-height:36px; padding:7px 10px; color:#e7edf7; background:#192a3d; }
      button:hover:not(:disabled) { background:#213a47; }
      button:disabled { opacity:.48; cursor:default; }
      button:focus-visible, summary:focus-visible, .panel-header:focus-visible { outline:3px solid #8ae8d1; outline-offset:2px; }
      .launcher { display:flex; align-items:center; gap:8px; min-height:42px; padding:9px 13px; border-color:#a9c8b8; border-radius:12px; color:#e7edf7; background:#111c2d; box-shadow:0 4px 18px #00000055; font-weight:650; }
      .status-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#94a69b; flex-shrink:0; }
      .status-dot.success { background:#7be2c8; }.status-dot.warning { background:#c38b33; }.status-dot.error { background:#ffaaa0; }
      .launcher-count { font-size:0.8333em; color:#9cafc6; font-weight:500; }
      .panel { display:flex; flex-direction:column; width:100%; max-height:min(540px,calc(100vh - 80px)); overflow:hidden; border:1px solid #b7cbbb; border-radius:13px; background:#111c2d; box-shadow:0 8px 30px #00000055; }
      .panel.tracker-mode { max-height:min(760px,calc(100vh - 32px)); }
      .panel.tracker-mode .scroll { padding:10px; }
      .panel.tracker-mode .detail { margin-bottom:6px; }
      .panel.tracker-mode .section { margin-top:8px; }
      .panel.tracker-mode .footer { padding:8px 10px; }
      .panel.tracker-mode .manage { display:none; }
      .panel.tracker-mode .bookmark-open { margin-top:5px; min-height:30px; padding:4px 8px; }
      .panel-header { display:flex; align-items:center; justify-content:space-between; gap:9px; flex-shrink:0; padding:11px 12px; border-bottom:1px solid #2e4358; cursor:grab; touch-action:none; user-select:none; }
      .panel-header.dragging { cursor:grabbing; }
      .heading { display:flex; align-items:center; gap:8px; min-width:0; }
      .grip { color:#8fa194; font-size:1.25em; letter-spacing:-2px; }
      h2 { margin:0; font-size:1.1667em; line-height:1.4; font-weight:700; }
      .eyebrow { color:#7be2c8; font-size:0.8333em; font-weight:650; letter-spacing:.1em; }
      .collapse { min-height:32px; padding:5px 8px; font-size:0.9167em; background:transparent; flex-shrink:0; }
      .scroll { padding:12px; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; }
      p { margin:0; overflow-wrap:anywhere; }
      .state { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px; font-size:1.0em; font-weight:650; }
      .state.warning,.state.error { color:#edc782; }
      .detail,.meta { color:#9cafc6; font-size:0.8333em; overflow-wrap:anywhere; }
      .detail { margin-bottom:11px; }
      .section { margin-top:12px; }
      .section-title { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin:0 0 7px; }
      h3 { font-size:1.0em; margin:0; font-weight:700; }
      .section-count { color:#9cafc6; font-size:0.8333em; }
      .hand { background:#192a3d; border:1px solid #2e4358; border-radius:9px; padding:10px 11px; }
      .hand-head { display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
      .quality { font-size:0.8333em; font-weight:650; padding:3px 6px; border-radius:4px; background:#1b2d40; color:#a6bacb; }
      .quality.complete { background:#193e34; color:#a3e1c6; }
      .quality.partial,.quality.unavailable { background:#352e23; color:#edc782; }
      .turn { color:#accbbf; font-size:0.8333em; }
      .hand-summary { color:#e7edf7; font-size:0.9167em; }
      .hand-list,.play-list,.issue-list { list-style:none; padding:0; margin:8px 0 0; }
      .hand-list li { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #1b2d40; }
      .hand-list li:last-child { border-bottom:0; }
      .card-code { font:.9167em/1.5 ui-monospace,"SFMono-Regular",Consolas,monospace; color:#93bcb7; overflow-wrap:anywhere; }
      .card-count { font-size:0.8333em; font-weight:700; color:#e7edf7; background:#172b3a; border-radius:4px; padding:1px 5px; flex-shrink:0; }
      .saved { margin-top:8px; font-size:0.8333em; color:#9cafc6; }
      .resources { margin-top:7px; padding-top:7px; border-top:1px solid #1b2c3e; color:#a3c5b9; font-size:0.8333em; }
      .plays-note { color:#9cafc6; font-size:0.8333em; margin-bottom:4px; }
      .play-list { margin-top:6px; }
      .play { background:#192a3d; border:1px solid #2e4358; border-left:3px solid #9ea99f; border-radius:7px; padding:8px 9px; margin-top:6px; overflow-wrap:anywhere; }
      .play.own { border-left-color:#7be2c8; }.play.opponent { border-left-color:#7b92a6; }
      .play-head { display:flex; justify-content:space-between; align-items:flex-start; gap:7px; font-size:0.8333em; }
      .actor { font-weight:650; min-width:0; overflow-wrap:anywhere; }
      .play-turn { flex-shrink:0; color:#9cafc6; font-size:0.8333em; }
      .play-card { margin-top:3px; font-size:0.9167em; font-weight:600; }
      .play-action { color:#9cafc6; font-size:0.8333em; margin-top:3px; }
      .raw { margin-top:4px; }.raw summary { color:#708278; font-size:0.8333em; cursor:pointer; }
      .raw p { font-size:0.8333em; color:#a9bcce; white-space:pre-wrap; margin-top:5px; }
      .empty { padding:10px; border:1px dashed #cad8cb; border-radius:7px; color:#9cafc6; font-size:0.9167em; }
      .coverage { margin-top:12px; padding:9px 10px; border-radius:7px; background:#1c2e40; }
      .coverage.warning { background:#352e23; color:#edc782; }
      .coverage-label { font-size:0.8333em; font-weight:650; }
      .coverage-boundary { color:#9cafc6; font-size:0.8333em; margin-top:4px; }
      .issues { margin-top:8px; padding:9px 10px; border-left:3px solid #d8a14e; border-radius:5px; background:#352e23; color:#edc782; }
      .issues summary { cursor:pointer; font-size:0.8333em; font-weight:650; }
      .issue-list { font-size:0.8333em; }
      .issue-list li + li { margin-top:7px; }
      .footer { flex-shrink:0; padding:10px 12px; border-top:1px solid #2e4358; background:#111c2d; }
      .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .review { background:#7be2c8; color:#09251e; border-color:#7be2c8; font-weight:700; }
      .review:hover:not(:disabled) { background:#a0f0dc; }
      .action-status { color:#b3dbc6; font-size:0.8333em; margin-top:7px; }
      .action-status.warning { color:#edc782; }
      .panel { position:relative; }
      .tabs { display:flex; gap:4px; padding:7px 12px 0; flex-shrink:0; }
      .tabs button { flex:1; min-width:0; border:0; background:transparent; min-height:32px; padding:5px 6px; font-size:0.9167em; }
      .tabs button[aria-selected="true"] { background:#254c40; color:#b9efde; font-weight:700; }
      .display-settings { margin:8px 0 10px; color:#a3c5b9; }
      .display-settings summary { cursor:pointer; font-size:0.9167em; }
      .settings-grid { display:grid; gap:9px; padding:10px 0 0; }
      .settings-grid label { display:grid; grid-template-columns:66px minmax(0,1fr) 42px; align-items:center; gap:6px; font-size:0.9167em; }
      .settings-grid select { grid-column:2 / 4; }
      input,textarea,select { font:inherit; min-width:0; border:1px solid #344c62; border-radius:6px; padding:6px 8px; background:#192a3d; color:#e7edf7; }
      input:focus-visible,textarea:focus-visible,select:focus-visible,a:focus-visible { outline:3px solid #8ae8d1; outline-offset:2px; }
      input[type="range"] { width:100%; accent-color:#7be2c8; padding:0; }
      .card-link { font:inherit; color:#b0e8d6; border:0; border-radius:4px; padding:3px 4px; min-height:28px; text-align:left; background:transparent; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px; }
      .card-link.card-code { font-family:ui-monospace,"SFMono-Regular",Consolas,monospace; }
      .card-link:hover { background:#193e34; }.card-link:disabled { text-decoration:none; opacity:1; }
      .hand-list li.added { background:#1b3b31; border-radius:5px; padding-left:5px; }
      .delta { margin-top:9px; padding:8px; background:#1b3b31; border-radius:6px; font-size:0.8333em; color:#a3d5bb; }
      .delta.unknown { background:#322f29; color:#e6c489; }
      .delta ul { margin:5px 0 0; padding:0; list-style:none; display:flex; flex-wrap:wrap; gap:5px 10px; }
      .delta .removed { color:#efc78c; }.delta .added { color:#9fe6c8; }
      .delta.pulse { animation:delta-saved .7s ease-out; }
      @keyframes delta-saved { from { box-shadow:0 0 0 2px #70b99c; } to { box-shadow:0 0 0 0 transparent; } }
      .bookmark-open { width:100%; margin-top:7px; min-height:32px; background:#182c3c; font-size:0.9167em; }
      .bookmark-editor { margin:10px 0; padding:11px; border:1px solid #b8ceba; border-radius:8px; background:#192a3d; }
      .bookmark-editor label { display:block; margin-top:8px; font-size:0.9167em; color:#a3c5b9; }
      .bookmark-editor input,.bookmark-editor textarea { width:100%; margin-top:3px; }
      .bookmark-editor textarea { resize:vertical; min-height:68px; max-height:160px; }
      .editor-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; margin-top:9px; }
      .bookmark-status { font-size:0.8333em; margin-top:7px; color:#edc782; }
      .preview { position:absolute; inset:8px; z-index:3; background:#192a3d; border:1px solid #b8ceba; border-radius:10px; box-shadow:0 5px 25px #00000055; padding:12px; overflow:auto; overscroll-behavior:contain; }
      .preview-head { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; position:sticky; top:-12px; margin:-12px -12px 10px; padding:12px; background:#192a3d; border-bottom:1px solid #2d4356; }
      .preview h3 { font-size:1.0833em; min-width:0; overflow-wrap:anywhere; }.preview-close { min-height:30px; padding:4px 8px; flex-shrink:0; }
      .preview-image { display:block; max-width:100%; max-height:270px; margin:8px auto; object-fit:contain; border-radius:5px; }
      .preview-text { font-size:0.9167em; white-space:pre-wrap; margin:8px 0; }
      .preview-meta { color:#9cafc6; font-size:0.8333em; margin-top:6px; }
      .preview-source { color:#7be2c8; display:inline-block; margin-top:8px; font-size:0.9167em; }
      .health-alerts { margin:0 0 10px; }.health-alert { padding:9px; border-left:3px solid #d8a14e; background:#352e23; border-radius:6px; margin-top:7px; overflow-wrap:anywhere; }
      .health-alert strong { font-size:0.9167em; }.health-alert p { color:#e6c489; font-size:0.8333em; margin:3px 0 6px; }
      .health-alert button { min-height:28px; padding:3px 7px; font-size:0.8333em; }.launcher.attention { border-color:#d39e4e; background:#352e23; }
      .manage { border:0; background:transparent; color:#7be2c8; padding:5px 0 0; min-height:28px; font-size:0.8333em; text-decoration:underline; text-underline-offset:3px; }
      .manage.highlight { font-weight:700; color:#edc782; }
      .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
      @media (max-height:240px) { .panel { max-height:calc(100vh - 16px); }.panel-header { padding:7px 10px; }.footer { padding:7px 10px; } }
      @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important;animation:none!important; } }
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
    var launcherLabel = node('span', '', '對戰小窗');
    launcher.append(launcherDot, launcherLabel, launcherCount);
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
    var tabs = node('nav', 'tabs');
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '小窗顯示內容');
    var tabButtons = {};
    [['deck','牌組'],['hand','手牌'],['events','公開事件'],['all','全部']].forEach(function (entry) {
      var item = button(entry[1], 'tab-' + entry[0]);
      item.id = 'msa-live-tab-' + entry[0]; item.setAttribute('role','tab');
      item.setAttribute('aria-controls', entry[0] === 'all' ? 'msa-live-deck msa-live-hand msa-live-events' : entry[0] === 'deck' ? 'msa-live-deck' : entry[0] === 'hand' ? 'msa-live-hand' : 'msa-live-events');
      tabButtons[entry[0]] = item; tabs.append(item);
    });
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
    var healthAlerts = node('section', 'health-alerts');
    healthAlerts.setAttribute('aria-label','記錄異常提醒');
    var endNotice = node('section','health-alert');endNotice.hidden=true;
    var endDismiss=button('收起提醒','dismiss-end');
    endNotice.append(node('strong','','賽後記錄／備份與還原'),node('p','','先保留對局頁，核對待存資料與缺口，再到「資料與牌組」備份。此提示不代表手牌全程完整。'),endDismiss);
    var displaySettings = node('details', 'display-settings');
    displaySettings.append(node('summary', '', '顯示設定'));
    var settingsGrid = node('div', 'settings-grid');
    function rangeSetting(label, key, min, max, step) {
      var wrap = node('label'), input = node('input'), output = node('output');
      input.type = 'range'; input.min = min; input.max = max; input.step = step;
      input.dataset.preference = key; input.setAttribute('aria-label',label);
      wrap.append(node('span','',label),input,output); settingsGrid.append(wrap);
      return {input:input,output:output};
    }
    var widthSetting = rangeSetting('寬度', 'width', 280, 480, 10);
    var fontSetting = rangeSetting('字級', 'fontSize', 11, 16, 1);
    var dockLabel = node('label'), dockSelect = node('select');
    dockSelect.dataset.preference = 'dock'; dockSelect.setAttribute('aria-label','貼邊位置');
    [['free','自由移動'],['left','貼左側'],['right','貼右側']].forEach(function (entry) { var option = node('option','',entry[1]);option.value=entry[0];dockSelect.append(option); });
    dockLabel.append(node('span','','位置'),dockSelect); settingsGrid.append(dockLabel);
    displaySettings.append(settingsGrid,node('p','meta','窄視窗會自動縮小。拖曳或方向鍵移動會切回自由位置。'));
    var bookmarkEditor = node('section', 'bookmark-editor'); bookmarkEditor.hidden = true;
    bookmarkEditor.setAttribute('aria-label','新增此刻書籤');
    var bookmarkAnchorLabel = node('p','meta');
    var noteLabel = node('label','','短筆記（選填，最多 500 字）'), noteInput = node('textarea');
    noteInput.maxLength = 500; noteInput.rows = 3; noteInput.dataset.field = 'bookmark-note';
    noteLabel.append(noteInput);
    var tagLabel = node('label','','標籤（選填，最多 40 字）'), tagInput = node('input');
    tagInput.type = 'text'; tagInput.maxLength = 40; tagInput.placeholder = '例如：攻擊順序、資源、待確認'; tagInput.dataset.field = 'bookmark-tag'; tagLabel.append(tagInput);
    var bookmarkSave = button('儲存書籤','bookmark-save'), bookmarkCancel = button('取消','bookmark-cancel');
    var editorActions = node('div','editor-actions'); editorActions.append(bookmarkCancel,bookmarkSave);
    var bookmarkStatus = node('p','bookmark-status'); bookmarkStatus.setAttribute('role','status');
    bookmarkEditor.append(node('h3','','標記此刻'),bookmarkAnchorLabel,noteLabel,tagLabel,editorActions,bookmarkStatus);
    var deckSection = node('section','section');
    deckSection.id = 'msa-live-deck'; deckSection.setAttribute('role','tabpanel'); deckSection.setAttribute('aria-labelledby','msa-live-tab-deck');
    var deckView = root.MSADeckTrackerUI?.create({document:doc,
      onCardControl:function(control,code){control.dataset.cardCode=code;bindCard(control);},
      onBindDeck:function(payload){return typeof options.onBindDeck==='function'?options.onBindDeck(payload):Promise.resolve({ok:false,reason:'牌組綁定服務尚未載入。'});},
      onManage:function(){return typeof options.onManage==='function'?options.onManage():Promise.resolve({ok:false,reason:'資料管理服務尚未載入。'});}
    });
    if(deckView)deckSection.append(deckView.element);
    else deckSection.append(node('p','empty','牌組追蹤模組尚未載入，更新後請重新整理 MSA 分頁。'));
    var handSection = node('section', 'section');
    handSection.id = 'msa-live-hand'; handSection.setAttribute('role','tabpanel'); handSection.setAttribute('aria-labelledby','msa-live-tab-hand');
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
    var deltaBox = node('div','delta'); var deltaSummary = node('p'); var deltaList = node('ul');
    deltaBox.append(deltaSummary,deltaList);
    hand.append(handHead, handSummary, handList, deltaBox, saved, resources);
    handSection.append(handTitle, hand);
    var playSection = node('section', 'section');
    playSection.id = 'msa-live-events'; playSection.setAttribute('role','tabpanel'); playSection.setAttribute('aria-labelledby','msa-live-tab-events');
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
    scroll.append(healthAlerts,endNotice,status,statusDetail,modelNotice,displaySettings,bookmarkEditor,deckSection,handSection,playSection,coverage,issues);
    var footer = node('footer', 'footer');
    var actions = node('div', 'actions');
    var refreshButton = button('更新 Log', 'refresh');
    var reviewButton = button('對局回顧', 'review');
    reviewButton.className = 'review';
    refreshButton.disabled = true;
    reviewButton.disabled = true;
    actions.append(refreshButton, reviewButton);
    var bookmarkButton = button('標記此刻','bookmark'); bookmarkButton.className = 'bookmark-open'; bookmarkButton.disabled = true;
    var manageButton=button('資料與牌組 · 備份與還原','manage');manageButton.className='manage';
    var actionStatus = node('p', 'action-status');
    actionStatus.hidden = true;
    actionStatus.setAttribute('role', 'status');
    actionStatus.setAttribute('aria-live', 'polite');
    footer.append(actions,bookmarkButton,manageButton,actionStatus);
    var preview = node('section','preview'); preview.hidden = true; preview.dataset.role = 'card-preview';
    preview.setAttribute('role','region'); preview.setAttribute('aria-label','卡片預覽');
    var previewHeading = node('h3','','卡片資料'), previewClose = button('關閉','card-close'); previewClose.className = 'preview-close';
    var previewHead = node('div','preview-head'); previewHead.append(previewHeading,previewClose);
    var previewStatus = node('p','meta'); previewStatus.setAttribute('role','status');
    var previewImage = node('img','preview-image'); previewImage.hidden = true; previewImage.referrerPolicy = 'no-referrer';
    var previewImageNote = node('p','meta');
    var previewText = node('p','preview-text'), previewMeta = node('p','preview-meta'), previewSource = node('a','preview-source','官方來源');
    previewSource.target = '_blank'; previewSource.rel = 'noopener noreferrer'; previewSource.referrerPolicy = 'no-referrer'; previewSource.hidden = true;
    preview.append(previewHead,previewStatus,previewImage,previewImageNote,previewText,previewMeta,previewSource);
    panel.append(header,tabs,scroll,footer,preview);
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
      surface.style.width = preferences.expanded ? Math.max(1, Math.min(preferences.width, view.width - 16)) + 'px' : 'max-content';
      surface.style.setProperty('--panel-font-size', preferences.fontSize + 'px');
      var rect = surface.getBoundingClientRect();
      var width = rect.width || (preferences.expanded ? Math.min(preferences.width, view.width - 16) : 132);
      var height = rect.height || (preferences.expanded ? Math.min(preferences.tab==='deck'?760:540, view.height - (preferences.tab==='deck'?32:80)) : 42);
      var edge = 8;
      var left = preferences.left === null ? view.width - width - 16 : preferences.left;
      if (preferences.dock === 'left') left = edge;
      if (preferences.dock === 'right') left = view.width - width - edge;
      var top = preferences.top === null ? view.height - height - 24 : preferences.top;
      var maxLeft = Math.max(edge, view.width - width - edge);
      var maxTop = Math.max(edge, view.height - height - edge);
      surface.style.left = Math.round(Math.max(edge, Math.min(maxLeft, left))) + 'px';
      surface.style.top = Math.round(Math.max(edge, Math.min(maxTop, top))) + 'px';
    }
    function expand(value, notify, focus) {
      if (destroyed) return;
      preferences.expanded = Boolean(value);
      if (!preferences.expanded) closePreview(false);
      panel.hidden = !preferences.expanded;
      launcher.hidden = preferences.expanded;
      launcher.setAttribute('aria-expanded', String(preferences.expanded));
      if(preferences.expanded)update(model);
      place();
      if (notify) savePreferences();
      if (focus && !dialogVisible) (preferences.expanded ? header : launcher).focus({ preventScroll: true });
    }
    function setPreferences(value) {
      if (destroyed) return;
      var previousTab = preferences.tab;
      preferences = normalizePreferences(Object.assign({},preferences,value || {}));
      applyDisplay(previousTab);
      expand(preferences.expanded, false, false);
    }
    function applyDisplay(previousTab) {
      if (previousTab && previousTab !== preferences.tab) { tabScroll[previousTab] = scroll.scrollTop; closePreview(false); }
      panel.classList.toggle('tracker-mode',preferences.tab==='deck');
      deckSection.hidden = preferences.tab !== 'deck' && preferences.tab !== 'all';
      handSection.hidden = preferences.tab === 'events' || preferences.tab === 'deck';
      playSection.hidden = preferences.tab === 'hand' || preferences.tab === 'deck';
      Object.keys(tabButtons).forEach(function (tab) {
        tabButtons[tab].setAttribute('aria-selected',String(tab === preferences.tab));
        tabButtons[tab].tabIndex = tab === preferences.tab ? 0 : -1;
      });
      widthSetting.input.value = preferences.width; text(widthSetting.output,preferences.width + ' px');
      fontSetting.input.value = preferences.fontSize; text(fontSetting.output,preferences.fontSize + ' px');
      dockSelect.value = preferences.dock;
      if (previousTab && previousTab !== preferences.tab) scroll.scrollTop = tabScroll[preferences.tab] || 0;
    }
    function modelContext() { return String(model.gameId || '') + '|' + String(model.sessionId || '') + '|' + String(model.playerName || ''); }
    function closePreview(restoreFocus) {
      clearTimeout(lookupTimer); lookupTimer = null; lookupSequence += 1;
      preview.hidden = true; previewImage.removeAttribute('src'); previewImage.hidden = true;
      var prior = previewTrigger; previewTrigger = null; previewCode = ''; previewPinned = false;
      if (restoreFocus && prior && prior.isConnected && !dialogVisible) {
        restoringPreviewFocus=prior;
        try { prior.focus({preventScroll:true}); } finally { restoringPreviewFocus=null; }
      }
    }
    async function lookupCard(trigger, pinned) {
      var code = cardCode(trigger.dataset.cardCode);
      if (!code || destroyed || dialogVisible || !preferences.expanded || typeof options.onCardLookup !== 'function') return;
      if (!preview.hidden && previewCode === code && previewTrigger === trigger) { previewPinned = previewPinned || pinned; if (pinned) previewClose.focus({preventScroll:true}); return; }
      closePreview(false); previewTrigger = trigger; previewPinned = pinned; previewCode = code;
      var sequence = ++lookupSequence, context = modelContext();
      preview.hidden = false; preview.setAttribute('aria-busy','true');
      text(previewHeading,code); text(previewStatus,'正在查詢官方卡片資料…');
      text(previewText,''); text(previewMeta,'僅查詢這張卡，不傳送整份手牌。'); text(previewImageNote,'');
      previewSource.hidden = true; previewSource.removeAttribute('href');
      if (pinned) previewClose.focus({preventScroll:true});
      try {
        var card = await options.onCardLookup(code);
        if (destroyed || sequence !== lookupSequence || context !== modelContext() || !trigger.isConnected || cardCode(trigger.dataset.cardCode) !== code) return;
        if (card && (!card.cardCode || card.cardCode === code)) {
          var source = officialSource(card.sourceUrl);
          if (source) { previewSource.href = source; previewSource.hidden = false; }
          var date = new Date(card.fetchedAt);
          text(previewMeta,'卡文語言 ' + (card.locale || '未知') + ' · 圖片語言 ' + (card.imageLocale || '未知') +
            ' · ' + (card.status === 'ok' ? '擷取 ' : '查詢 ') + (Number.isFinite(date.getTime()) ? date.toLocaleString('zh-TW') : '時間未知'));
        }
        if (!card || card.status !== 'ok' || (card.cardCode && card.cardCode !== code)) {
          text(previewStatus,card && card.status === 'notfound' ? '找不到這張卡的官方資料。' : '卡片資料暫時無法取得。');
          text(previewText,card && card.reason || '資料仍屬未知，請稍後重試。');
          if (!card || (card.cardCode && card.cardCode !== code)) text(previewMeta,'未取得可信資料；語言與擷取時間未知。');
          return;
        }
        text(previewHeading,card.name ? code + ' · ' + card.name : code);
        text(previewStatus,card.cardType || '卡片類型未提供'); text(previewText,card.text || '官方卡文未提供。');
        var data = safeCardImageSource(card.imageDataUrl,card.imageUrl,code);
        previewImage.hidden = !data;
        text(previewImageNote,data ? '' : '圖片未能載入；仍可閱讀卡文或開啟官方來源。');
        if (data) { previewImage.alt = code + (card.name ? ' ' + card.name : ''); previewImage.src = data; }
      } catch (error) {
        if (!destroyed && sequence === lookupSequence && context === modelContext()) {
          text(previewStatus,'卡片資料查詢失敗。'); text(previewText,String(error && error.message || error));
        }
      } finally { if (!destroyed && sequence === lookupSequence) preview.setAttribute('aria-busy','false'); }
    }
    function bindCard(item) {
      function schedule(event) {
        if(event?.type==='focus'&&restoringPreviewFocus===item)return;
        clearTimeout(lookupTimer);
        if (cardCode(item.dataset.cardCode)) lookupTimer = setTimeout(function () { lookupTimer = null; lookupCard(item,false); },350);
      }
      item.addEventListener('mouseenter',schedule); item.addEventListener('focus',schedule);
      item.addEventListener('click',function () { clearTimeout(lookupTimer);lookupTimer=null;lookupCard(item,true); });
      function leave(event) {
        clearTimeout(lookupTimer);lookupTimer=null;
        if (preview.contains(event.relatedTarget) || previewPinned) return;
        if (previewTrigger === item) closePreview(false);
      }
      item.addEventListener('mouseleave',leave); item.addEventListener('blur',leave);
    }
    function updateButtons() {
      refreshButton.disabled = refreshing || !model.gameId || typeof options.onRefresh !== 'function';
      refreshButton.setAttribute('aria-busy', String(refreshing));
      text(refreshButton, refreshing ? '更新中…' : '更新 Log');
      reviewButton.disabled = reviewing || !model.sessionId || model.canReview === false || typeof options.onReview !== 'function';
      reviewButton.setAttribute('aria-busy', String(reviewing));
      bookmarkButton.disabled = bookmarking || !model.identityConfirmed || !model.latestSnapshot?.id || model.canBookmark === false || typeof options.onBookmark !== 'function';
      bookmarkSave.disabled = bookmarking; bookmarkCancel.disabled = bookmarking;
      noteInput.disabled = bookmarking; tagInput.disabled = bookmarking;
      bookmarkSave.setAttribute('aria-busy',String(bookmarking)); text(bookmarkSave,bookmarking ? '儲存中…' : '儲存書籤');
      manageButton.disabled=managing||typeof options.onManage!=='function';manageButton.setAttribute('aria-busy',String(managing));
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
      if (model.gameId !== next.gameId || model.sessionId !== next.sessionId || model.playerName !== next.playerName) {
        actionMessage('',false); closePreview(false); acknowledgedAlerts.clear();
        bookmarkEditor.hidden = true; bookmarkAnchor = null; text(bookmarkStatus,'');
        endNoticeDismissed=false;
      }
      model = next;
      endNotice.hidden=!(model.endObserved && model.sessionId && !endNoticeDismissed);
      manageButton.classList.toggle('highlight',Boolean(model.endObserved && model.sessionId));
      var scrollTop = scroll.scrollTop;
      var focused = shadow.activeElement;
      var stateTone = tone(model.statusTone);
      status.className = 'state ' + stateTone;
      statusDot.className = 'status-dot ' + stateTone;
      launcherDot.className = 'status-dot ' + stateTone;
      var alerts = (Array.isArray(model.healthAlerts) ? model.healthAlerts : []).filter(function (alert) {
        return alert && alert.code && !acknowledgedAlerts.has(String(alert.code) + '|' + String(alert.observedAt || ''));
      });
      if (alerts.length) launcherDot.className = 'status-dot ' + (alerts.some(function (alert) { return alert.level === 'error'; }) ? 'error' : 'warning');
      healthAlerts.hidden = !alerts.length;
      text(launcherLabel,alerts.length || stateTone === 'error' ? '記錄需檢查' : '對戰小窗');
      launcher.classList.toggle('attention',Boolean(alerts.length || stateTone === 'error'));
      reconcile(healthAlerts,alertRows,alerts,function () {
        var item=node('div','health-alert'), title=node('strong'),detail=node('p'),ack=button('知道了','dismiss-alert');
        item.append(title,detail,ack);
        var row={element:item,title:title,detail:detail,ack:ack,alert:null,busy:false};
        ack.addEventListener('click',async function () {
          var alert=row.alert, context=modelContext(), key=String(alert.code)+'|'+String(alert.observedAt || '');
          if (ack.disabled || typeof options.onDismissAlert !== 'function') return;
          row.busy=true;ack.disabled=true;
          try {
            var result=await options.onDismissAlert(alert.code);
            if(destroyed || context!==modelContext())return;
            if(!result || result.ok!==true) {actionMessage(result && result.reason || '尚未確認提醒狀態已儲存。',true);return;}
            acknowledgedAlerts.add(key);update(model);
          } catch(error) {if(context===modelContext())reportError(error,'提醒狀態未能更新');}
          finally {row.busy=false;if(!destroyed)ack.disabled=false;}
        });return row;
      },function(row,alert){row.alert=alert;text(row.title,alert.title || '記錄需檢查');text(row.detail,alert.detail || '請核對記錄狀態。');row.ack.disabled=row.busy||typeof options.onDismissAlert!=='function';},
      function(alert){return String(alert.code)+'|'+String(alert.observedAt || '');});
      text(statusLabel, model.statusLabel || '等待記錄');
      text(statusDetail, model.statusDetail || '尚無已儲存資料；請在對局中確認記錄已啟用。');
      text(modelNotice, [model.preferenceError, model.refreshMessage].filter(Boolean).join(' · '));
      modelNotice.hidden = !model.preferenceError && !model.refreshMessage;
      text(launcherCount, alerts.length ? alerts.length + ' 項提醒' : Number.isSafeInteger(model.snapshotCount) && model.snapshotCount > 0 ? model.snapshotCount + ' 筆' : '');
      launcher.setAttribute('aria-label', '開啟對戰小窗；' + (model.statusLabel || '等待記錄'));
      // A collapsed panel only needs its launcher and alerts. Paint the latest
      // model when opened, rather than reconciling invisible card lists.
      if(!preferences.expanded){updateButtons();return;}
      text(handCount, count(model.snapshotCount) + ' 筆快照');
      text(turn, model.currentTurnLabel || '回合未確認');
      quality.className = 'quality ' + (['complete', 'partial', 'unavailable'].indexOf(model.quality) >= 0 ? model.quality : 'unavailable');
      text(quality, model.qualityLabel || '尚未觀察');
      text(handSummary, model.handSummary || '尚無已儲存手牌，不能視為空手。');
      if(!deckSection.hidden)deckView?.update(model.deckTracker || {state:'identity-unknown',availableDecks:[],rows:[],publicCards:{own:[],opponent:[],unknown:[],tokens:[]}});
      // Only the projection's confirmed current run may expose saved hand data.
      var cards = model.identityConfirmed && model.latestSnapshot && Array.isArray(model.handCards) ? model.handCards : [];
      var delta=model.handDelta || {}, comparable=Boolean(model.identityConfirmed && model.latestSnapshot && model.quality==='complete' && delta.comparable);
      var added=new Map();
      if(comparable)(Array.isArray(delta.added)?delta.added:[]).forEach(function(card){if(cardCode(card.cardCode)&&Number.isSafeInteger(card.count)&&card.count>0)added.set(card.cardCode,card.count);});
      reconcile(handList, handRows, cards, function () {
        var item = node('li'), code = button('','card-lookup'), quantity = node('span', 'card-count');
        code.className='card-link card-code';bindCard(code);
        item.append(code, quantity); return { element: item, code: code, quantity: quantity };
      }, function (row, card) {
        text(row.code,card.cardCode || '卡號未知');row.code.dataset.cardCode=card.cardCode || '';row.code.disabled=!cardCode(card.cardCode)||typeof options.onCardLookup!=='function';
        text(row.quantity,'× '+count(card.count)+(added.has(card.cardCode)?'  +'+added.get(card.cardCode):''));row.element.classList.toggle('added',added.has(card.cardCode));
      },
      function (card, index) { return String(card.cardCode || '') + ':' + index; });
      var changes=[];
      if(comparable)[['added','+'],['removed','−']].forEach(function(pair){(Array.isArray(delta[pair[0]])?delta[pair[0]]:[]).forEach(function(card){
        if(cardCode(card.cardCode)&&Number.isSafeInteger(card.count)&&card.count>0)changes.push({code:card.cardCode,count:card.count,kind:pair[0],sign:pair[1]});
      });});
      var deltaKey=JSON.stringify([model.latestSnapshot?.id || '',comparable,changes,delta.reason || '']);
      text(deltaSummary,comparable?(changes.length?'與前一筆完整已存觀察相比；增減原因未知。':'與前一筆完整已存觀察相比，卡號數量未變。'):(delta.reason || '缺少可比較的完整觀察，不推算手牌進出。'));
      deltaBox.classList.toggle('unknown',!comparable);
      if(deltaKey!==lastDeltaKey){
        deltaList.replaceChildren();changes.forEach(function(change){var item=node('li',change.kind),code=button(change.code+' '+change.sign+change.count,'card-lookup');code.className='card-link';code.dataset.cardCode=change.code;code.disabled=typeof options.onCardLookup!=='function';bindCard(code);item.append(code);deltaList.append(item);});
        deltaBox.classList.remove('pulse');
        if(comparable&&changes.length&&!(win.matchMedia&&win.matchMedia('(prefers-reduced-motion: reduce)').matches)){void deltaBox.offsetWidth;deltaBox.classList.add('pulse');}
        lastDeltaKey=deltaKey;
      }
      text(saved, model.latestSnapshot && model.identityConfirmed ? '最後已存觀察 ' + time(model.latestSnapshot.timestamp) + ' · ' + (model.playerName || '玩家未辨識') : '只有成功儲存的本人手牌才會顯示。');
      text(resources, model.resourcesText || '資源未辨識');
      var plays = Array.isArray(model.recentPlays) ? model.recentPlays.slice(0, 20) : [];
      text(playCount, plays.length + ' 筆');
      playEmpty.hidden = plays.length > 0;
      reconcile(playList, playRows, plays, function () {
        var item = node('li', 'play'), head = node('div', 'play-head'), actor = node('span', 'actor'), turnLabel = node('span', 'play-turn');
        var cardLabel = button('','card-lookup'), action = node('p', 'play-action'), raw = node('details', 'raw'), rawText = node('p');
        cardLabel.className='play-card card-link';bindCard(cardLabel);
        raw.append(node('summary', '', '公開原文'), rawText); head.append(actor, turnLabel); item.append(head, cardLabel, action, raw);
        return { element: item, actor: actor, turn: turnLabel, card: cardLabel, action: action, rawText: rawText };
      }, function (row, play) {
        var side = model.identityConfirmed && ['own', 'opponent'].indexOf(play.actorSide) >= 0 ? play.actorSide : 'unknown';
        row.element.className = 'play ' + side;
        text(row.actor, (side === 'own' ? '自己 · ' : '') + (play.actor || '玩家未確認'));
        text(row.turn, Number.isSafeInteger(play.turn) && play.turn > 0 ? 'T' + play.turn : '回合未標');
        text(row.card, [play.cardName, play.cardCode].filter(Boolean).join(' · ') || '卡牌未確認');
        row.card.dataset.cardCode=play.cardCode || '';row.card.disabled=!cardCode(play.cardCode)||typeof options.onCardLookup!=='function';
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
      if(previewTrigger&&(!previewTrigger.isConnected||cardCode(previewTrigger.dataset.cardCode)!==previewCode))closePreview(false);
      if (focused && focused.isConnected && shadow.activeElement !== focused && !focused.disabled && !dialogVisible) focused.focus({ preventScroll: true });
      else if(focused&&!focused.isConnected&&preferences.expanded&&!dialogVisible)header.focus({preventScroll:true});
    }

    function setPosition(left, top) {
      preferences.left = left; preferences.top = top; preferences.dock='free';dockSelect.value='free';place();
      var rect = surface.getBoundingClientRect();
      preferences.left = Math.round(rect.left); preferences.top = Math.round(rect.top);
    }
    function finishDrag(event, cancelled) {
      if (!drag || (event && event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      var previous = drag; drag = null;
      header.classList.remove('dragging');
      try { if (header.hasPointerCapture(previous.pointerId)) header.releasePointerCapture(previous.pointerId); } catch (_) { /* Pointer capture may already be released. */ }
      if (cancelled) { preferences.left = previous.preferences.left; preferences.top = previous.preferences.top; preferences.dock=previous.preferences.dock;dockSelect.value=preferences.dock;place(); }
      else if (previous.moved) savePreferences();
    }
    function flushKeyboard() { if (keyboardDirty) { keyboardDirty = false; savePreferences(); } }
    launcher.addEventListener('click', function () { expand(true, true, true); });
    collapse.addEventListener('click', function () { expand(false, true, true); });
    Object.keys(tabButtons).forEach(function(tab){
      function selectTab(next){var previous=preferences.tab;preferences.tab=next;applyDisplay(previous);update(model);place();savePreferences();}
      tabButtons[tab].addEventListener('click',function(){selectTab(tab);});
      tabButtons[tab].addEventListener('keydown',function(event){
        var keys=['deck','hand','events','all'],index=keys.indexOf(tab),next=null;
        if(event.key==='ArrowRight')next=keys[(index+1)%keys.length];else if(event.key==='ArrowLeft')next=keys[(index+keys.length-1)%keys.length];else if(event.key==='Home')next='deck';else if(event.key==='End')next='all';
        if(next){event.preventDefault();event.stopPropagation();selectTab(next);tabButtons[next].focus();}
      });
    });
    [widthSetting,fontSetting].forEach(function(setting){
      setting.input.addEventListener('input',function(){preferences=normalizePreferences(Object.assign({},preferences,{[setting.input.dataset.preference]:Number(setting.input.value)}));applyDisplay();place();});
      setting.input.addEventListener('change',savePreferences);
    });
    dockSelect.addEventListener('change',function(){preferences.dock=dockSelect.value;place();savePreferences();});
    previewClose.addEventListener('click',function(){closePreview(true);});
    preview.addEventListener('mouseleave',function(event){if(!previewPinned&&!preview.contains(shadow.activeElement)&&shadow.activeElement!==previewTrigger&&!surface.contains(event.relatedTarget))closePreview(false);});
    previewImage.addEventListener('error',function(){if(preview.hidden)return;previewImage.hidden=true;previewImage.removeAttribute('src');text(previewImageNote,'圖片未能載入；仍可閱讀卡文或開啟官方來源。');});
    bookmarkButton.addEventListener('click',function(){
      if(bookmarkButton.disabled||destroyed)return;
      var snapshot=model.latestSnapshot;
      bookmarkAnchor={context:modelContext(),snapshotId:snapshot.id,turn:Number.isSafeInteger(snapshot.turn)?snapshot.turn:null,turnSource:snapshot.turnSource||'unknown',observedTurn:snapshot.observedTurn??null};
      var alignment=bookmarkAnchor.turnSource==='log'&&bookmarkAnchor.turn?'Log T'+bookmarkAnchor.turn:bookmarkAnchor.turnSource==='phase-observed'&&bookmarkAnchor.turn?'推計 T'+bookmarkAnchor.turn:'未校準回合';
      text(bookmarkAnchorLabel,alignment+' · 快照 '+snapshot.id+' · '+time(snapshot.timestamp)+'。儲存時固定這筆快照。');
      noteInput.value='';tagInput.value='';text(bookmarkStatus,'');bookmarkEditor.hidden=false;
      noteInput.focus({preventScroll:true});bookmarkEditor.scrollIntoView({block:'nearest'});place();
    });
    bookmarkCancel.addEventListener('click',function(){if(bookmarking)return;bookmarkEditor.hidden=true;bookmarkAnchor=null;bookmarkButton.focus({preventScroll:true});place();});
    bookmarkSave.addEventListener('click',async function(){
      if(bookmarking||!bookmarkAnchor||destroyed)return;
      var anchor=Object.assign({},bookmarkAnchor);
      if(anchor.context!==modelContext()){text(bookmarkStatus,'對局或玩家已切換，請重新標記。');return;}
      bookmarking=true;text(bookmarkStatus,'正在儲存書籤…');updateButtons();
      try{
        var result=await options.onBookmark({snapshotId:anchor.snapshotId,turn:anchor.turn,turnSource:anchor.turnSource,observedTurn:anchor.observedTurn,note:noteInput.value.slice(0,500),tag:tagInput.value.trim().slice(0,40)});
        if(destroyed||anchor.context!==modelContext())return;
        if(!result||result.ok!==true){text(bookmarkStatus,result&&result.reason||'未確認書籤已儲存，請再試一次。');return;}
        bookmarkEditor.hidden=true;bookmarkAnchor=null;actionMessage('書籤已儲存，保留按下標記時的快照錨點。',false);
        if(preferences.expanded&&!dialogVisible)bookmarkButton.focus({preventScroll:true});
      }catch(error){if(!destroyed&&anchor.context===modelContext())text(bookmarkStatus,'書籤儲存失敗：'+String(error&&error.message||error));}
      finally{bookmarking=false;if(!destroyed){updateButtons();place();}}
    });
    endDismiss.addEventListener('click',function(){endNoticeDismissed=true;endNotice.hidden=true;place();});
    manageButton.addEventListener('click',async function(){
      if(manageButton.disabled||destroyed)return;var context=modelContext();managing=true;updateButtons();
      try{var result=await options.onManage();if(!destroyed&&context===modelContext()&&result&&result.ok===false)actionMessage(result.reason||'資料管理頁未能開啟。',true);}
      catch(error){if(context===modelContext())reportError(error,'資料管理頁未能開啟');}
      finally{managing=false;if(!destroyed)updateButtons();}
    });
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
      // Keep keyboard interaction within the focused small window. Default
      // input editing and tab navigation still work; game-level shortcuts do not.
      event.stopPropagation();
      if (event.key === 'Escape' && preferences.expanded) {
        consumeEscapeRelease = true;
        event.preventDefault();event.stopPropagation();
        if(!preview.hidden){closePreview(true);return;}
        if(!bookmarkEditor.hidden&&!bookmarking){bookmarkEditor.hidden=true;bookmarkAnchor=null;bookmarkButton.focus({preventScroll:true});place();return;}
        finishDrag(null, true); flushKeyboard(); expand(false, true, true); return;
      }
      if (event.target === header && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].indexOf(event.key) >= 0) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Home') { preferences.left = null; preferences.top = null;preferences.dock='free';dockSelect.value='free';place(); }
        else {
          var rect = surface.getBoundingClientRect();
          setPosition(rect.left + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0),
            rect.top + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0));
        }
        keyboardDirty = true;
      } else if (event.target.closest('input,textarea,select') || (event.target.closest('button') && (event.key === 'Enter' || event.key === ' '))) event.stopPropagation();
    });
    shadow.addEventListener('keyup', function (event) {
      event.stopPropagation();
      if(event.target.closest('input,textarea,select'))event.stopPropagation();
      if (event.key === 'Escape' && consumeEscapeRelease) {
        consumeEscapeRelease = false; event.preventDefault(); event.stopPropagation(); return;
      }
      if (event.target === header && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].indexOf(event.key) >= 0) {
        event.preventDefault(); event.stopPropagation(); flushKeyboard();
      }
    });
    shadow.addEventListener('keypress', function (event) { event.stopPropagation(); });
    // Only events originating in this small surface are contained. No global
    // game keyboard or pointer listener is installed or prevented.
    ['click', 'pointerdown', 'pointerup'].forEach(function (eventName) {
      surface.addEventListener(eventName, function (event) { event.stopPropagation(); });
    });
    refreshButton.addEventListener('click', async function () {
      if (refreshing || refreshButton.disabled || destroyed) return;
      refreshing = true; actionMessage('正在更新公開 Log；請稍候。', false); updateButtons();
      var context = modelContext();
      try {
        var result = await options.onRefresh();
        if (destroyed || context !== modelContext()) return;
        if (result && (result.ok === false || result.refreshed === false || result.partial)) actionMessage(result.reason || result.error || '未能確認完整刷新；既有記錄仍保留。', true);
        else if (result && result.refreshed === true) actionMessage('公開 Log 已刷新；手牌缺口仍需個別確認。', false);
        else actionMessage('更新要求已完成，請核對公開事件筆數與涵蓋狀態。', false);
      } catch (error) {
        if (context === modelContext()) reportError(error, '更新 Log 失敗，既有記錄仍保留');
      }
      finally { refreshing = false; if (!destroyed) { updateButtons(); place(); } }
    });
    reviewButton.addEventListener('click', async function () {
      if (reviewing || reviewButton.disabled || destroyed) return;
      reviewing = true; updateButtons();
      var context = modelContext();
      try {
        var result = await options.onReview();
        if (destroyed || context !== modelContext()) return;
        if (result && result.ok === false) reportError(result.error || result.reason || '無法開啟', '對局回顧未開啟');
      } catch (error) {
        if (context === modelContext()) reportError(error, '對局回顧未開啟');
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
    applyDisplay();update({});
    checkDialogs();

    return Object.freeze({
      update: update,
      setPreferences: setPreferences,
      getPreferences: getPreferences,
      focusLauncher: function () { if (!destroyed && !dialogVisible) (preferences.expanded ? header : launcher).focus({ preventScroll: true }); },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(lookupTimer);lookupSequence+=1;previewImage.removeAttribute('src');
        if (dialogObserver) dialogObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        if (dialogFrame !== null) win.cancelAnimationFrame(dialogFrame);
        win.removeEventListener('resize', place);
        if (win.visualViewport) win.visualViewport.removeEventListener('resize', place);
        deckView?.destroy();host.remove(); handRows.clear(); playRows.clear();alertRows.clear();
      }
    });
  }
  return Object.freeze({ create: create, normalizePreferences:normalizePreferences, safeCardImageSource:safeCardImageSource });
});
