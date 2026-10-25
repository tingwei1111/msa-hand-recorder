(async () => {
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);
  await globalThis.MSAI18n?.ready();


  const PREFIX = 'msa.session.';
  const $ = (id) => document.getElementById(id);
  const qualityLabels = { complete: '完整辨識', partial: '部分辨識', unavailable: '無法辨識' };
  const actionLabels = {
    'deploy-unit': '部署機體', 'deploy-token': '產生 Token', 'play-command': '使用 Command',
    'play-action': '使用 Action', 'play-base': '部署基地', 'replace-base': '替換基地',
    'pair-pilot': '配對駕駛', 'link-pilot': '連結駕駛', attack: '攻擊', block: '阻擋',
    draw: '抽牌', discard: '棄牌', 'return-hand': '返回手牌', 'return-deck': '返回牌組',
    'turn-start': '回合開始', 'turn-end': '回合結束', 'game-start': '對局開始',
    'game-end': '對局結束', unknown: '未分類事件'
  };
  let sessions = [];
  let selectedId = new URLSearchParams(window.location.search).get('id') || '';
  let selectedTurnKey = '';
  let session = null;
  let timeline = null;
  let groups = [];
  let visibleGroups = [];
  let renderedTurnKey = '';
  let renderedSessionKey = '';
  let reloadTimer;
  let loadSequence = 0;
  let exportInProgress = false;
  let pendingReload = false;
  let lastExportInfo = null;
  let workspaceValues = {};
  const workspace = globalThis.MSAReviewWorkspace && $('workspace-notes') ? globalThis.MSAReviewWorkspace.create({
    container: $('workspace-notes'), getCurrent: () => session, getValues: () => workspaceValues,
    notice, onJump: jumpToNote
  }) : null;

  function jumpToNote(note) {
    const target = groups.find(group => (group.observations || []).some(({snapshot}) =>
      snapshot?.id === note.snapshotId && (snapshot.sourceSessionId || session?.id) === note.sourceSessionId));
    if (!target) return false;
    $('turn-search').value = '';
    selectedTurnKey = target.key;
    renderNavigation('heading');
    const card = Array.from($('turn-content').querySelectorAll('[data-snapshot-id]')).find(node =>
      node.dataset.snapshotId === note.snapshotId && node.dataset.sourceSessionId === note.sourceSessionId);
    if (card) { card.tabIndex = -1; card.focus({preventScroll:true}); card.scrollIntoView({block:'nearest'}); }
    return true;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function dateText(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(globalThis.MSAI18n?.language || 'zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
      : l10n('時間未知');
  }

  function countText(value) {
    return Number.isInteger(value) && value >= 0 ? String(value) : l10n('未知');
  }

  function notice(text, error = false) {
    $('review-notice').textContent = text;
    $('review-notice').className = error ? 'notice error' : 'notice';
    $('review-notice').hidden = !text;
    $('review-notice').setAttribute('role', error ? 'alert' : 'status');
  }

  function failure(text, error) {
    notice(text + (typeof error?.message === 'string' ? ` ${globalThis.MSAI18n?.message(error.message)||error.message}` : ''), true);
  }

  function refreshSummary(info) {
    const result = info?.refresh;
    if (!result) return l10n('匯出前會刷新對應對局。請先保持 MSA 分頁開啟，再匯出報告。');
    const status = result.code==='saved-only'?l10n('已選擇匯出本機已存資料'):result.refreshed ? (result.partial ? l10n('已刷新，仍有部分資料待確認') : l10n('已完成匯出前刷新')) : l10n('未能確認刷新，使用既有資料');
    return `${status}${result.reason ? `：${result.reason}` : ''}。${info.storageReadAt ? l10n("本機資料讀取於 {0}。", dateText(info.storageReadAt)) : ''}`;
  }

  function renderExportStatus() {
    const node = $('export-refresh-status');
    if (!node) return;
    const relevant = lastExportInfo && lastExportInfo.gameId === session?.gameId &&
      lastExportInfo.playerName === session?.playerName && lastExportInfo.selectedSessionId === selectedId &&
      lastExportInfo.combined === Boolean(session?.isCombined) ? lastExportInfo : null;
    const issueCount = timeline?.handCaptureIssues?.length || 0;
    node.textContent = refreshSummary(relevant) + (issueCount ? l10n(" 另有 {0} 筆手牌擷取缺口，刷新公開 Log 不會補回未存入的手牌觀察。", issueCount) : '');
    node.className = `export-refresh-status${issueCount || (relevant && (!relevant.refresh?.refreshed || relevant.refresh?.partial)) ? ' partial' : ''}`;
  }

  function updateExportControls() {
    const labels = { html: l10n('匯出 HTML 報告'), markdown: l10n('匯出 Markdown'), json: l10n('匯出原始 JSON'),
      'hands-csv': l10n('匯出手牌 CSV'), 'events-csv': l10n('匯出事件 CSV'), 'combined-csv': l10n('匯出整合 CSV') };
    $('download-review').textContent = exportInProgress ? l10n('正在準備匯出…') : labels[$('export-format').value] || l10n('匯出報告');
    $('download-review').setAttribute('aria-busy', String(exportInProgress));
    if($('export-saved-only'))$('export-saved-only').disabled=exportInProgress;
    document.querySelector('.session-bar')?.setAttribute('aria-busy', String(exportInProgress));
  }

  function keyedDetails(key, title, className = 'inline-details') {
    const details = element('details', className);
    details.dataset.detailKey = key;
    const summary = element('summary', '', title);
    summary.dataset.focusKey = `detail:${key}`;
    details.append(summary);
    return details;
  }

  function sourceLabel(snapshot) {
    if (!snapshot) return l10n('沒有手牌觀察');
    if (snapshot.turnSource === 'log' && Number.isInteger(snapshot.turn)) return l10n("Log 校準 T{0}", snapshot.turn);
    if (snapshot.turnSource === 'phase-observed' && Number.isInteger(snapshot.turn)) return l10n("推計 T{0} · 觀察 {1}", snapshot.turn, countText(snapshot.observedTurn));
    if (Number.isInteger(snapshot.observedTurn)) return l10n("觀察回合 {0}（未校準）", snapshot.observedTurn);
    return l10n('回合來源未知');
  }

  function turnTitle(group) {
    if (group.key === 'unassigned') return l10n('開局前／未標回合事件');
    if (Number.isInteger(group.turn) && group.turn > 0) {
      return l10n("{0}第 {1} 回合", group.turnSource === 'phase-observed' && !(group.events || []).length ? l10n('推計') : '', group.turn);
    }
    if (Number.isInteger(group.observedTurn)) return l10n("觀察回合 {0}", group.observedTurn);
    return l10n('未標回合的公開紀錄');
  }

  function coverageView(coverage, eventCount) {
    if (!eventCount) return { label: l10n('尚未收錄 Log'), quality: 'unavailable', detail: l10n('目前沒有可排列的公開事件；自己的手牌快照仍獨立保留。') };
    let label = l10n('部分公開紀錄');
    let quality = 'partial';
    if (coverage.hasGaps || coverage.unmergedCaptureCount) label = l10n('有待確認缺口');
    else if (coverage.publicLogComplete) { label = l10n('已見開局與結束'); quality = 'complete'; }
    else if (coverage.completeFromStart) label = l10n('從開局收錄中');
    const detail = [
      Number.isInteger(coverage.firstTurn) && Number.isInteger(coverage.lastTurn) ? l10n("已見 T{0}–T{1}", coverage.firstTurn, coverage.lastTurn) : l10n('回合範圍未確認'),
      coverage.gameStarted ? l10n('有開局標記') : l10n('未見開局標記'),
      coverage.gameEnded ? l10n('有結束標記') : l10n('未見結束標記'),
      coverage.hasGaps ? l10n('存在待確認缺口') : l10n('未標出已知缺口'),
      coverage.unmergedCaptureCount ? l10n("{0} 次擷取尚未合併", coverage.unmergedCaptureCount) : ''
    ].filter(Boolean).join(' · ');
    return { label, quality, detail: l10n('公開 Log：') + detail + '。' };
  }

  function allEvents() {
    return groups.flatMap((group) => Array.isArray(group.events) ? group.events : []);
  }

  function makeTimeline(current) {
    if (typeof globalThis.MSABattleLogCore?.buildTimeline !== 'function') {
      throw new Error(l10n('公開 Log 核心未載入，請重新載入擴充功能。'));
    }
    const result = globalThis.MSABattleLogCore.buildTimeline(current);
    if (!result || !Array.isArray(result.turns)) throw new Error(l10n('回合資料格式無法辨識。'));
    return result;
  }

  function createGroups(result) {
    const list = result.turns.map((group, index) => ({ ...group, key: String(group.key ?? `turn-${index}`) }));
    const events = Array.isArray(result.unassignedEvents) ? result.unassignedEvents : [];
    // The core already keeps uncalibrated snapshots in separate observed groups.
    // Its unassignedSnapshots list is an audit view, not another timeline group.
    if (events.length) list.push({
      key: 'unassigned', turn: null, turnSource: 'unknown', observedTurn: null, activePlayer: null,
      events, plays: events.filter((event) => event.isPlay === true),
      first: null, last: null, snapshotCount: 0,
      handFlags: { observedOnly: true, openingConfirmed: false, endConfirmed: false }
    });
    return list;
  }

  function renderOverview() {
    const openIssues = new Set(Array.from($('review-warnings').querySelectorAll('details[data-detail-key]'))
      .filter((node) => node.open).map((node) => node.dataset.detailKey));
    const issueFocus = $('review-warnings').contains(document.activeElement) ? document.activeElement?.dataset.focusKey : '';
    const events = allEvents();
    const coverage = coverageView(timeline.coverage || {}, events.length);
    $('match-heading').textContent = session.playerName ? l10n("{0} 的對局記錄", session.playerName) : l10n('公開對局記錄（無本人手牌身份）');
    $('match-meta').textContent = l10n("對局 {0} · {1} · {2} 起", session.gameId || l10n('未知'), session.isCombined ? l10n("合併 {0} 段", session.sourceSessions.length) : l10n("段落 {0}", session.id || selectedId), dateText(session.startedAt));
    $('review-snapshot-count').textContent = String((session.snapshots || []).length);
    $('review-event-count').textContent = String(events.length);
    $('review-play-count').textContent = String(events.filter((event) => event.isPlay === true).length);
    $('review-turn-count').textContent = String(groups.length);
    $('coverage-badge').className = `badge ${coverage.quality}`;
    $('coverage-badge').textContent = coverage.label;
    $('coverage-detail').textContent = coverage.detail;
    $('capture-reminder').textContent = l10n('公開 Log 已見起尾，不代表手牌全程完整；未觀察的歷史手牌無法補回。');
    renderExportStatus();
    $('review-warnings').replaceChildren();
    for (const warning of Array.isArray(timeline.warnings) ? timeline.warnings : []) {
      $('review-warnings').append(element('li', '', globalThis.MSAI18n?.message(warning)||warning));
    }
    for (const issue of timeline.handCaptureIssues || []) {
      const entry = element('li');
      const details = keyedDetails(`issue:${issue.sourceSessionId}:${issue.sourceIssueIndex}`, l10n('手牌擷取缺口原始欄位'));
      details.open = openIssues.has(details.dataset.detailKey);
      details.append(element('pre', '', JSON.stringify(issue, null, 2)));
      entry.append(details);
      $('review-warnings').append(entry);
    }
    $('review-warnings').hidden = !$('review-warnings').children.length;
    if (issueFocus) Array.from($('review-warnings').querySelectorAll('[data-focus-key]'))
      .find((node) => node.dataset.focusKey === issueFocus)?.focus({ preventScroll: true });
    $('raw-log-text').textContent = session.battleLog ? JSON.stringify(session.battleLog, null, 2) : l10n('這筆記錄沒有已儲存的公開 Log。');
  }

  function handCard(snapshot, label) {
    const box = element('section', 'hand-card');
    const heading = element('div', 'hand-card-header');
    const quality = snapshot && Object.hasOwn(qualityLabels, snapshot.quality) ? snapshot.quality : 'unavailable';
    heading.append(element('h4', '', label), element('span', `badge ${quality}`, snapshot ? l10n(qualityLabels[quality]) : l10n('未觀察')));
    box.append(heading);
    if (!snapshot) {
      box.append(element('p', 'muted', l10n('沒有這個回合的手牌快照。這不代表沒有手牌。')));
      return box;
    }
    box.append(element('p', 'hand-time', `${dateText(snapshot.timestamp)} · ${sourceLabel(snapshot)}`));
    const cards = Array.isArray(snapshot.hand) ? snapshot.hand.filter((card) => card && typeof card.cardCode === 'string' && Number.isInteger(card.count) && card.count > 0) : [];
    const count = element('p', 'hand-count');
    count.append(element('strong', '', cards.reduce((sum, card) => sum + card.count, 0)), element('span', '', l10n('張已辨識')));
    box.append(count, element('p', 'muted', l10n("預期 {0} · 未辨識 {1} · {2}", countText(snapshot.expectedCount), countText(snapshot.unknownCount), snapshot.phase || l10n('階段未知'))));
    const list = element('ul', 'hand-list');
    for (const card of cards) {
      const row = element('li');
      row.append(element('span', 'card-code', card.cardCode), element('span', 'card-count', `× ${card.count}`));
      list.append(row);
    }
    box.append(list);
    if (!cards.length) box.append(element('p', 'muted', quality === 'complete' && snapshot.expectedCount === 0 && snapshot.unknownCount === 0
      ? l10n('這次快照已確認為 0 張手牌。') : l10n('沒有可確認的卡號，不能視為空手。')));
    if (snapshot.reason && quality !== 'complete') box.append(element('p', 'small-note', l10n("辨識原因：{0}", snapshot.reason)));
    if (snapshot.resources) box.append(element('p', 'resource-line', typeof globalThis.MSARecorderCore.resourceText === 'function'
      ? globalThis.MSARecorderCore.resourceText(snapshot.resources)
      : l10n("資源等級 {0} · 一般可用 {1} · EX 可用未知", countText(snapshot.resources.level), countText(snapshot.resources.active))));
    const metadata = keyedDetails(`snapshot:${snapshot.id || snapshot.timestamp}:${label}`, l10n('來源與原始快照欄位'), 'snapshot-metadata');
    if (snapshot.id) metadata.append(element('p', 'snapshot-id', snapshot.id));
    if (snapshot.sourceSessionId) metadata.append(element('p', 'muted', l10n("來源段落 {0}", snapshot.sourceSessionId)));
    metadata.append(element('pre', '', JSON.stringify(snapshot, null, 2)));
    box.append(metadata);
    const noteButton = workspace?.buttonForSnapshot(snapshot);
    if (noteButton) box.append(noteButton);
    return box;
  }

  function actionText(event) {
    return Object.hasOwn(actionLabels, event.action) ? l10n(actionLabels[event.action]) : event.action || l10n('公開事件');
  }

  function rawDetails(event, expanded) {
    const details = keyedDetails(`play:${event.id || event.sourceIndex}`, l10n('查看公開 Log 原文'));
    details.open = Boolean(expanded);
    details.append(element('pre', 'raw-event', event.rawText || l10n('（沒有原文）')));
    return details;
  }

  function playColumns(group, expanded) {
    const container = element('div', 'player-plays');
    const plays = Array.isArray(group.plays) ? group.plays : (group.events || []).filter((event) => event.isPlay === true);
    const knownPlayers = Array.isArray(timeline.players) ? timeline.players.filter((player) => typeof player === 'string' && player) : [];
    const names = [...new Set([session.playerName, ...knownPlayers, ...plays.map((event) => event.actor)].filter((name) => typeof name === 'string' && name))];
    if (plays.some((event) => !event.actor) || !names.length) names.push(null);
    for (const name of names) {
      const own = name && session.playerName && name === session.playerName;
      const column = element('section', `player-column ${!name ? 'unknown' : own ? 'own' : 'other'}`);
      const list = element('ul', 'play-list');
      const ownPlays = plays.filter((event) => (event.actor || null) === name);
      const heading = element('div', 'player-heading');
      heading.append(element('h4', '', name ? `${own ? l10n('自己 · ') : ''}${name}` : l10n('玩家未確認')), element('span', 'badge', l10n("{0} 次", ownPlays.length)));
      column.append(heading);
      for (const event of ownPlays) {
        const row = element('li');
        const card = event.primaryCard;
        row.append(element('div', 'play-title', card?.name || card?.cardCode || actionText(event)));
        row.append(element('p', 'play-meta', [actionText(event), card?.cardCode || '', l10n('來源區域未確認')].filter(Boolean).join(' · ')));
        row.append(rawDetails(event, expanded));
        list.append(row);
      }
      column.append(list);
      if (!ownPlays.length) column.append(element('p', 'muted', l10n('此群組未收錄這位玩家的公開出牌。')));
      container.append(column);
    }
    return container;
  }

  function eventList(group, expanded) {
    const panel = element('div', 'event-panel');
    const list = element('ol', 'event-list');
    const events = Array.isArray(group.events) ? group.events : [];
    events.forEach((event, index) => {
      const row = element('li');
      const heading = element('div', 'event-heading');
      heading.append(element('span', 'event-order', `#${Number.isInteger(event.sourceIndex) ? event.sourceIndex + 1 : index + 1}`),
        element('span', 'event-kind', actionText(event)), element('span', 'event-actor', event.actor || l10n('玩家未標示')));
      for (const card of Array.isArray(event.cards) ? event.cards : []) {
        if (card?.cardCode) heading.append(element('span', 'inline-card', card.cardCode));
      }
      row.append(heading, element('pre', 'raw-event', event.rawText || l10n('（沒有原文）')));
      const metadata = keyedDetails(`event:${event.id || event.sourceIndex || index}`, l10n('來源與擷取資訊'));
      if (event.capturedAt) metadata.append(element('p', 'muted', l10n("首次擷取 {0}；不是事件發生時間", dateText(event.capturedAt))));
      metadata.append(element('pre', 'raw-event', JSON.stringify(event, null, 2)));
      row.append(metadata);
      list.append(row);
    });
    panel.append(list);
    if (!events.length) panel.append(element('p', 'muted', l10n('這個群組沒有已收錄的公開事件。沒有紀錄不代表沒有行動。')));
    return panel;
  }

  function turnSection(title, note) {
    const section = element('section', 'turn-section');
    const heading = element('div', 'section-heading');
    heading.append(element('h3', '', title));
    if (note) heading.append(element('span', 'muted', note));
    section.append(heading);
    return section;
  }

  function renderTurn(group, expanded = false) {
    const root = element('article', 'turn-article');
    const titlebar = element('div', 'turn-titlebar');
    const title = element('div');
    const actorSource = { 'turn-ended-log': l10n('回合結束 Log'), 'hand-observation': l10n('畫面觀察'), 'first-player-order': l10n('依先後手推計'), unknown: l10n('來源未知') };
    const heading = element('h2', '', turnTitle(group));
    heading.tabIndex = -1;
    heading.dataset.focusKey = 'turn-heading';
    title.append(heading, element('p', 'muted', [group.activePlayer ? l10n("行動方：{0}（{1}）", group.activePlayer, actorSource[group.activePlayerSource] || l10n('來源待核對')) : l10n('行動方未確認'),
      l10n("{0} 筆公開事件", (group.events || []).length), l10n("{0} 筆手牌觀察", group.snapshotCount || 0)].join(' · ')));
    titlebar.append(title);
    const position = visibleGroups.findIndex((item) => item.key === group.key);
    const pager = element('nav', 'turn-pager');
    pager.setAttribute('aria-label', l10n('切換目前篩選的回合'));
    for (const [offset, label] of [[-1, l10n('← 上一回合')], [1, l10n('下一回合 →')]]) {
      const button = element('button', 'button subtle', label);
      button.type = 'button';
      button.disabled = position + offset < 0 || position + offset >= visibleGroups.length;
      button.dataset.focusKey = offset < 0 ? 'previous-turn' : 'next-turn';
      button.addEventListener('click', () => {
        const target = visibleGroups[position + offset];
        if (target) { selectedTurnKey = target.key; renderNavigation('heading'); }
      });
      pager.append(button);
    }
    pager.append(element('span', 'turn-position', `${position + 1} / ${visibleGroups.length}${$('turn-search').value.trim() ? l10n(' · 搜尋結果') : l10n(' 個群組')}`));
    titlebar.append(pager);
    root.append(titlebar);
    const jumpLinks = element('nav', 'turn-jump-links');
    jumpLinks.setAttribute('aria-label', l10n('本回合內容捷徑'));
    for (const [id, label] of [['turn-hands', l10n('手牌快照')], ['turn-plays', l10n('雙方出牌')], ['turn-events', l10n('公開事件')]]) {
      const link = element('a', '', label);
      link.href = `#${id}`;
      link.dataset.focusKey = `jump:${id}`;
      jumpLinks.append(link);
    }
    root.append(jumpLinks);
    const uncalibrated = !Number.isInteger(group.turn);
    if (uncalibrated || group.key === 'unassigned') root.append(element('p', 'boundary-note', group.key === 'unassigned'
      ? l10n('這些公開事件沒有回合編號，可能屬於開局前流程；保留原文及順序，不與未校準手牌強行對應。')
      : l10n("此觀察群組未校準到絕對回合，與 Battle Log 的第 N 回合分開列出。來源段落：{0}。", group.first?.sourceSessionId || session.id || l10n('未知'))));
    if (group.handFlags?.turnAlignment === 'estimated') root.append(element('p', 'boundary-note', l10n('本回合有依行動方切換推計對齊的手牌；不是每一筆都直接由 Log 校準。請搭配快照時間與各筆來源核對。')));
    if (group.handFlags?.hasIncompleteObservations) root.append(element('p', 'boundary-note', l10n('這個回合含有部分或無法辨識的手牌快照。全部觀察仍逐筆保留；不跨越未知狀態推算數量差。')));
    const hands = keyedDetails('hand-summary', l10n('手牌首末摘要'), 'summary-panel');
    hands.querySelector('summary').append(element('span', '', l10n('展開比較最早／最晚觀察；不保證是回合起訖')));
    const pair = element('div', 'hand-pair');
    pair.append(handCard(group.first || group.hand?.first || null, l10n('最早觀察')), handCard(group.last || group.hand?.last || null, l10n('最晚觀察')));
    hands.append(pair);
    root.append(hands);
    const history = turnSection(l10n('全部手牌快照'), l10n("{0} 筆觀察 · 數量差不代表進出原因", group.snapshotCount || 0));
    history.id = 'turn-hands';
    history.tabIndex = -1;
    history.dataset.focusKey = 'section:turn-hands';
    const observations = Array.isArray(group.observations) ? group.observations : [];
    const historyList = element('div', 'snapshot-history');
    for (const observation of observations) {
      const card = handCard(observation.snapshot, l10n("快照 {0}", observation.index));
      card.dataset.snapshotId = observation.snapshot.id || '';
      card.dataset.sourceSessionId = observation.snapshot.sourceSessionId || session?.id || '';
      card.append(element('p', 'snapshot-delta', ((value)=>globalThis.MSAI18n?.message(value)||value)(globalThis.MSABattleLogCore.deltaDescription(observation))));
      historyList.append(card);
    }
    if (!observations.length) historyList.append(element('p', 'muted', l10n('沒有這個回合的手牌觀察，不能視為空手。')));
    history.append(historyList);
    root.append(history);
    const plays = turnSection(l10n('雙方公開出牌'), l10n('只依公開 Log 分類，不由手牌差值推測'));
    plays.id = 'turn-plays';
    plays.tabIndex = -1;
    plays.dataset.focusKey = 'section:turn-plays';
    plays.append(playColumns(group, expanded));
    root.append(plays);
    const events = turnSection(l10n('公開事件與原文'), l10n('保留出現順序與原文'));
    events.id = 'turn-events';
    events.tabIndex = -1;
    events.dataset.focusKey = 'section:turn-events';
    events.append(eventList(group, expanded));
    root.append(events);
    return root;
  }

  function renderNavigation(focusTarget = '') {
    const search = $('turn-search').value.trim().toLocaleLowerCase();
    const filtered = groups.filter((group) => !search || [turnTitle(group), group.activePlayer || '',
      ...(group.events || []).map((event) => `${event.actor || ''} ${event.rawText || ''} ${(event.cards || []).map((card) => `${card.cardCode || ''} ${card.name || ''}`).join(' ')}`),
      ...(group.snapshots || []).flatMap((snapshot) => (snapshot.hand || []).map((card) => card.cardCode)),
      ...(group.first?.hand || []).map((card) => card.cardCode), ...(group.last?.hand || []).map((card) => card.cardCode)
    ].join(' ').toLocaleLowerCase().includes(search));
    if (!filtered.some((group) => group.key === selectedTurnKey)) selectedTurnKey = filtered[0]?.key || '';
    visibleGroups = filtered;
    const contextKey = `${selectedId}|${Boolean(session?.isCombined)}|${session?.playerName || ''}`;
    const preserveTurnState = renderedSessionKey === contextKey && renderedTurnKey === selectedTurnKey;
    const openDetails = new Set(preserveTurnState ? Array.from($('turn-content').querySelectorAll('details[data-detail-key]'))
      .filter((node) => node.open).map((node) => node.dataset.detailKey) : []);
    const focusedKey = preserveTurnState ? document.activeElement?.dataset.focusKey : '';
    const sidebarScroll = $('turn-navigation').scrollTop;
    if ($('clear-turn-search')) $('clear-turn-search').hidden = !search;
    $('turn-navigation').replaceChildren();
    $('turn-filter-count').textContent = `${filtered.length} / ${groups.length}`;
    $('turn-search-empty').hidden = filtered.length > 0 || !search;
    for (const group of filtered) {
      const button = element('button', 'turn-link');
      button.type = 'button';
      button.dataset.focusKey = `turn-nav:${group.key}`;
      button.setAttribute('aria-current', group.key === selectedTurnKey ? 'true' : 'false');
      button.setAttribute('aria-controls', 'turn-content');
      button.append(element('strong', '', turnTitle(group)), element('span', '', l10n("{0} 事件 · {1} 手牌快照", (group.events || []).length, group.snapshotCount || 0)));
      if (!Number.isInteger(group.turn) && group.first?.sourceSessionId) button.append(element('span', '', l10n("段落 {0}", String(group.first.sourceSessionId).slice(-12))));
      button.addEventListener('click', () => { selectedTurnKey = group.key; renderNavigation('navigation'); });
      button.addEventListener('keydown', (event) => {
        const index = filtered.findIndex((item) => item.key === group.key);
        const target = event.key === 'ArrowDown' ? index + 1 : event.key === 'ArrowUp' ? index - 1 :
          event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : null;
        if (target === null) return;
        event.preventDefault();
        if (filtered[target]) { selectedTurnKey = filtered[target].key; renderNavigation('navigation'); }
      });
      $('turn-navigation').append(button);
    }
    const selected = filtered.find((group) => group.key === selectedTurnKey);
    $('turn-content').replaceChildren();
    $('turn-unavailable').hidden = Boolean(selected);
    if (selected) $('turn-content').append(renderTurn(selected));
    else {
      $('turn-empty-heading').textContent = search ? l10n('沒有符合的回合') : l10n('尚無可整理的回合');
      $('turn-empty-description').textContent = search ? l10n('換一個卡號、玩家名稱或回合關鍵字試試。') : l10n('原始資料仍可下載 JSON；請在 MSA 顯示手牌或開啟 Battle Log 後再重新整理。');
    }
    for (const node of $('turn-content').querySelectorAll('details[data-detail-key]')) {
      if (openDetails.has(node.dataset.detailKey)) node.open = true;
    }
    $('turn-navigation').scrollTop = sidebarScroll;
    renderedTurnKey = selectedTurnKey;
    renderedSessionKey = contextKey;
    const requestedFocus = focusTarget === 'heading' ? 'turn-heading' : focusTarget === 'navigation' ? `turn-nav:${selectedTurnKey}` : focusedKey;
    if (requestedFocus) {
      const target = Array.from(document.querySelectorAll('[data-focus-key]')).find((node) => node.dataset.focusKey === requestedFocus);
      target?.focus({ preventScroll: true });
      if (focusTarget === 'navigation') target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function compatibleSessions(current) {
    if (!current.gameId) return { sources: [current], note: l10n('沒有可核對的對局 ID，僅顯示此段。') };
    if (current.isCombined) return { sources: [current], note: l10n('此筆已是合併報告，保留其原始合併結果，避免再次加入來源段落。') };
    const sameGame = sessions.map((entry) => entry.session).filter((item) => item.gameId === current.gameId && !item.isCombined);
    const names = [...new Set(sameGame.map((item) => typeof item.playerName === 'string' ? item.playerName.trim() : '').filter(Boolean))];
    const ownName = typeof current.playerName === 'string' ? current.playerName.trim() : '';
    if (!ownName && current.snapshots.length) return { sources: [current], note: l10n('此段手牌身份未確認，避免混合玩家，僅顯示此段。') };
    if (!ownName && names.length > 1) return { sources: [current], note: l10n('同局有多位手牌玩家；請選定具名段落後再合併。') };
    const targetName = ownName || names[0] || '';
    const sources = sameGame.filter((item) => {
      const name = typeof item.playerName === 'string' ? item.playerName.trim() : '';
      return name ? name === targetName : item.snapshots.length === 0;
    });
    return { sources: sources.length ? sources : [current], note: sources.length > 1
      ? l10n("{0} 段相容記錄；只合併同一玩家手牌與無名的純公開 Log。", sources.length) : l10n('只有 1 段相容記錄。') };
  }

  function renderSelected() {
    const entry = sessions.find((item) => item.id === selectedId);
    session = entry?.session || null;
    timeline = null;
    groups = [];
    $('review-empty').hidden = Boolean(session);
    $('review-content').hidden = !session;
    $('download-review').disabled = !session || exportInProgress;
    $('export-format').disabled = !session || exportInProgress;
    updateExportControls();
    if (!session) { $('combine-segments').disabled = true; $('merge-status').textContent = l10n('尚無記錄段落。'); workspace?.render(); return; }
    try {
      const compatible = compatibleSessions(session);
      $('combine-segments').disabled = exportInProgress || compatible.sources.length < 2;
      const combine = $('combine-segments').checked && compatible.sources.length > 1;
      $('merge-status').textContent = (combine ? l10n('合併檢視：') : l10n('單段檢視：')) + compatible.note;
      if (combine) session = globalThis.MSABattleLogCore.combineSessions(compatible.sources);
      const contextKey = `${selectedId}|${Boolean(session.isCombined)}|${session.playerName || ''}`;
      if (renderedSessionKey && renderedSessionKey !== contextKey) {
        for (const details of $('review-content').querySelectorAll('details')) details.open = false;
      }
      timeline = makeTimeline(session);
      groups = createGroups(timeline);
      renderOverview();
      renderNavigation();
      workspace?.render();
    } catch (error) {
      failure(l10n('無法整理回合報告；仍可選擇 JSON 下載原始資料。'), error);
      timeline = null;
      groups = [];
      $('review-content').hidden = true;
      $('export-format').value = 'json';
      updateExportControls();
    }
  }

  function applyData(values) {
    workspaceValues = values;
    sessions = Object.entries(values).filter(([key, value]) => key.startsWith(PREFIX) && value && typeof value === 'object' && Array.isArray(value.snapshots))
      .map(([key, value]) => ({ id: key.slice(PREFIX.length), session: value }))
      .sort((a, b) => (Date.parse(b.session.updatedAt) || 0) - (Date.parse(a.session.updatedAt) || 0));
    if (!sessions.some((entry) => entry.id === selectedId)) {
      if (selectedId && sessions.length) notice(l10n('指定記錄已不存在，現在顯示最近一筆本機記錄。'));
      selectedId = sessions[0]?.id || '';
    }
    $('review-session').replaceChildren();
    for (const entry of sessions) {
      const option = element('option', '', `${dateText(entry.session.startedAt)} · ${entry.session.playerName || l10n('僅公開 Log／玩家未辨識')} · ${(entry.session.gameId || entry.id).slice(0, 12)}`);
      option.value = entry.id;
      $('review-session').append(option);
    }
    if (!sessions.length) $('review-session').append(element('option', '', l10n('尚無本機記錄')));
    $('review-session').value = selectedId;
    $('review-session').disabled = !sessions.length || exportInProgress;
    renderSelected();
  }

  async function loadData() {
    if (exportInProgress) { pendingReload = true; return; }
    const sequence = ++loadSequence;
    $('review-content').setAttribute('aria-busy', 'true');
    $('refresh-review').disabled = true;
    $('refresh-review').textContent = l10n('讀取中…');
    try {
      const values = await chrome.storage.local.get(null);
      if (sequence !== loadSequence || exportInProgress) return;
      applyData(values);
    } catch (error) { failure(l10n('無法讀取本機記錄，請重新整理後再試。'), error); }
    finally {
      if (sequence === loadSequence && !exportInProgress) {
        $('review-content').setAttribute('aria-busy', 'false');
        $('refresh-review').disabled = false;
        $('refresh-review').textContent = l10n('重新整理');
      }
    }
  }

  function standaloneHTML(current, exportInfo) {
    return globalThis.MSABattleLogCore.toHTML(current, { exportInfo });
  }

  function download(contents, extension, mimeType, suffix, current, exportInfo) {
    if (typeof contents !== 'string') throw new Error(l10n('匯出資料格式不正確。'));
    const game = String(current.gameId || current.id || 'session').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = element('a');
    anchor.href = url; anchor.download = `msa-${suffix}-${game}-${stamp}.${extension}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(l10n("已發起下載：{0} 筆手牌快照、{1} 筆公開事件，不受搜尋條件影響。{2} {3} 請到 Chrome 下載項目確認。", (current.snapshots || []).length, current.battleLog?.events?.length || 0, refreshSummary(exportInfo), exportInfo.summaryError ? l10n('回合摘要不可用，原始資料與匯出資訊仍已保留。') : exportInfo.coverage?.publicLogComplete ? l10n('公開 Log 已見起尾。') : l10n('公開 Log 尚未確認整場完整。')), !exportInfo.refresh?.refreshed || exportInfo.refresh?.partial || Boolean(exportInfo.summaryError));
  }

  async function prepareExport(selection) {
    let timer;
    try {
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: 'MSA_PREPARE_EXPORT', gameId: selection.gameId, playerName: selection.playerName }),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, refreshed: false, partial: true, reason: l10n('匯出前刷新逾時；只匯出已儲存資料。') }), 35000); })
      ]);
      return response && typeof response === 'object' ? response : { ok: false, refreshed: false, partial: true, reason: l10n('沒有收到刷新結果。') };
    } catch (error) {
      return { ok: false, refreshed: false, partial: true, reason: l10n("無法要求刷新：{0}", error.message || l10n('連線失敗')) };
    } finally { clearTimeout(timer); }
  }

  $('download-review').addEventListener('click', async () => {
    if (!session || exportInProgress) return;
    const selection = { id: selectedId, gameId: session.gameId, playerName: session.playerName || '',
      combine: $('combine-segments').checked, format: $('export-format').value,savedOnly:Boolean($('export-saved-only')?.checked) };
    exportInProgress = true;
    loadSequence += 1;
    clearTimeout(reloadTimer);
    for (const id of ['download-review', 'review-session', 'export-format', 'combine-segments', 'refresh-review']) $(id).disabled = true;
    updateExportControls();
    notice(selection.savedOnly?l10n('正在讀取本機已存資料並建立匯出檔…'):l10n('正在刷新對應 MSA 分頁的手牌與公開 Log；完成後會重新讀取本機資料，再建立匯出檔。'));
    try {
      const refresh = selection.savedOnly ? {ok:true,refreshed:false,partial:true,code:'saved-only',reason:l10n('未要求刷新 MSA')} : await prepareExport(selection);
      // One storage snapshot after the producer/storage queues finish supplies
      // both the visible report and every byte of this export. Do not re-use
      // the pre-refresh session or silently export another recently saved game.
      const values = await chrome.storage.local.get(null);
      const selectedRecord = values[PREFIX + selection.id];
      if (!selectedRecord || !Array.isArray(selectedRecord.snapshots)) throw new Error(l10n('原選取記錄已不存在，未改匯出其他對局。'));
      if (selectedRecord.gameId !== selection.gameId || (selection.playerName && selectedRecord.playerName && selectedRecord.playerName !== selection.playerName)) {
        throw new Error(l10n('所選記錄的對局或玩家身份已改變，請重新選取後再匯出。'));
      }
      selectedId = selection.id;
      $('combine-segments').checked = selection.combine;
      applyData(values);
      const current = JSON.parse(JSON.stringify(session));
      let exportCoverage = null;
      let summaryError = '';
      try { exportCoverage = globalThis.MSABattleLogCore.buildTimeline(current).coverage; }
      catch (error) {
        if (selection.format !== 'json') throw error;
        summaryError = l10n('回合摘要不可用；原始記錄仍保留。') + (error.message ? ` ${globalThis.MSAI18n?.message(error.message)||error.message}` : '');
      }
      const exportInfo = { exportedAt: new Date().toISOString(), storageReadAt: new Date().toISOString(),
        gameId: current.gameId, playerName: current.playerName, selectedSessionId: selection.id,
        combined: Boolean(current.isCombined), refresh: JSON.parse(JSON.stringify(refresh)),
        snapshotCount: current.snapshots.length, eventCount: current.battleLog?.events?.length || 0,
        coverage: exportCoverage, workspaceRecords: workspace?.exportRecords(current, values) || {},
        ...(summaryError ? { summaryError } : {}) };
      lastExportInfo = exportInfo;
      renderExportStatus();
      const format = selection.format;
      if (format === 'json') {
        // Keep the session shape and all original fields, including an existing
        // exportInfo property. An extra audit object records this export only.
        const jsonRecord = { ...current };
        let infoKey = 'exportInfo';
        while (Object.hasOwn(jsonRecord, infoKey)) infoKey = `recorder${infoKey[0].toUpperCase()}${infoKey.slice(1)}`;
        jsonRecord[infoKey] = exportInfo;
        download(JSON.stringify(jsonRecord, null, 2), 'json', 'application/json;charset=utf-8', 'record', current, exportInfo);
      }
      else if (format === 'html') download(standaloneHTML(current, exportInfo), 'html', 'text/html;charset=utf-8', 'review', current, exportInfo);
      else if (format === 'markdown') download(globalThis.MSABattleLogCore.toMarkdown(current, { exportInfo }), 'md', 'text/markdown;charset=utf-8', 'review', current, exportInfo);
      else {
        const csv = format === 'hands-csv' ? globalThis.MSARecorderCore.toCSV(current)
          : format === 'combined-csv' ? globalThis.MSABattleLogCore.toCSV(current) : globalThis.MSABattleLogCore.toEventsCSV(current);
        download(csv.startsWith('\uFEFF') ? csv : '\uFEFF' + csv, 'csv', 'text/csv;charset=utf-8', format, current, exportInfo);
      }
    } catch (error) { failure(l10n('未建立匯出檔；請檢查本機記錄後再試。'), error); }
    finally {
      exportInProgress = false;
      $('export-format').disabled = !session;
      $('refresh-review').disabled = false;
      $('refresh-review').textContent = l10n('重新整理');
      $('review-content').setAttribute('aria-busy', 'false');
      $('review-session').disabled = !sessions.length;
      $('download-review').disabled = !session;
      $('combine-segments').disabled = !session || compatibleSessions(sessions.find((entry) => entry.id === selectedId)?.session || session).sources.length < 2;
      updateExportControls();
      if (pendingReload) { pendingReload = false; loadData(); }
    }
  });
  $('review-session').addEventListener('change', (event) => {
    selectedId = event.target.value; selectedTurnKey = '';
    $('turn-search').value = '';
    const url = new URL(window.location.href); url.searchParams.set('id', selectedId);
    window.history.replaceState(null, '', url.href);
    notice(''); renderSelected();
  });
  $('turn-search').addEventListener('input', renderNavigation);
  $('clear-turn-search')?.addEventListener('click', () => {
    $('turn-search').value = '';
    renderNavigation();
    $('turn-search').focus();
  });
  $('export-format').addEventListener('change', updateExportControls);
  $('combine-segments').addEventListener('change', () => { selectedTurnKey = ''; notice(''); renderSelected(); });
  $('refresh-review').addEventListener('click', () => { notice(''); loadData(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.keys(changes).some((key) => [PREFIX,'msa.note.','msa.deck.','msa.match.','msa.import.'].some(prefix => key.startsWith(prefix)))) return;
    if (exportInProgress) { pendingReload = true; return; }
    clearTimeout(reloadTimer); reloadTimer = setTimeout(loadData, 180);
  });
  await globalThis.MSAI18n?.mount(document, () => { if (!exportInProgress) { renderSelected(); updateExportControls(); } });
  loadData();
})();
