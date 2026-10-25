(function (root, factory) {
  'use strict';
  var core = typeof module === 'object' && module.exports ? require('./recorder-core.js') : root.MSARecorderCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSABattleLogCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';
  if (!core) throw new Error('MSARecorderCore must be loaded before MSABattleLogCore.');

  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function text(value) { return value === null || value === undefined ? '' : String(value); }
  function nonnegative(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
  function compact(value) { return text(value).replace(/\s+/g, ' ').trim(); }
  function unique(values) { return Array.from(new Set(values.filter(Boolean))); }
  function addWarning(log, warning) { if (log.warnings.indexOf(warning) < 0) log.warnings.push(warning); }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && typeof row.text === 'string' && row.text.trim();
    }).map(function (row) {
      return {
        rawText: row.text,
        actor: text(row.actor).trim(),
        sourceIndex: nonnegative(row.sourceIndex),
        capturedAt: text(row.capturedAt) || null,
        cards: (Array.isArray(row.cards) ? row.cards : []).map(function (card) {
          return { cardCode: core.normalizeCardCode(card && card.cardCode), name: text(card && card.name) };
        }).filter(function (card) { return card.cardCode || card.name; })
      };
    });
  }

  function classify(rawText, cards) {
    var line = compact(rawText);
    var action = 'unknown';
    var isPlay = false;
    var primaryCard = null;
    var details = {};
    var match;
    if (/^Game started!$/i.test(line)) action = 'game-start';
    else if (/^Game ended!$/i.test(line)) action = 'game-end';
    else if (/^Turn \d+ started!$/i.test(line)) action = 'turn-start';
    else if (/^Turn end phase started$/i.test(line)) action = 'end-phase';
    else if (/^Turn ended!$/i.test(line)) action = 'turn-end';
    else if (/^Choose to play first$/i.test(line)) action = 'choose-first';
    else if (/^Choose to mulligan starting hand$/i.test(line)) action = 'mulligan';
    else if (/^Passed$/i.test(line)) action = 'pass';
    else if (/^Played command:/i.test(line)) { action = 'play-command'; isPlay = true; }
    else if (/^Played action:/i.test(line)) { action = 'play-action'; isPlay = true; }
    else if (/^Played base:/i.test(line)) { action = 'play-base'; isPlay = true; }
    else if (/^Replaced .+ base:/i.test(line)) { action = 'replace-base'; isPlay = true; }
    else if (/^Linked pilot:/i.test(line)) { action = 'link-pilot'; isPlay = true; }
    else if (/^Paired pilot:/i.test(line)) { action = 'pair-pilot'; isPlay = true; }
    else if (/ deployed$/i.test(line)) {
      action = cards[0] && /^T-/.test(cards[0].cardCode || '') ? 'deploy-token' : 'deploy-unit';
      isPlay = action !== 'deploy-token';
    }
    else if (/^Battle declared:/i.test(line)) action = 'attack';
    else if (/^Battle started:/i.test(line)) action = 'battle-start';
    else if (/^Battle initiated$/i.test(line)) action = 'battle-initiated';
    else if (/^Battle ended$/i.test(line)) action = 'battle-end';
    else if (/^Assigned no blocker$/i.test(line)) action = 'no-block';
    else if (/^No blockers available$/i.test(line)) action = 'no-blockers';
    else if (/^Assigned .+ to block$/i.test(line)) action = 'block';
    else if (/^Action step$/i.test(line)) action = 'action-step';
    else if ((match = line.match(/(?:^|: )Draw (a card|\d+ cards?)$/i))) {
      action = 'draw'; details.drawCount = /^a /i.test(match[1]) ? 1 : Number.parseInt(match[1], 10);
    }
    else if (/^Shield card added to hand(?:\:|$)/i.test(line)) action = 'shield-to-hand';
    else if (/^(?:Breach \d+ )?Shield card:/i.test(line)) action = 'shield-reveal';
    else if (/ returned to hand$/i.test(line)) action = 'return-hand';
    else if (/ returned to deck$/i.test(line)) action = 'return-deck';
    else if (/ removed from play$/i.test(line)) action = 'remove';
    else if (/ discarded$/i.test(line)) action = 'discard';
    else if ((match = line.match(/ received (\d+) damage\s*,\s*(now destroyed|leaving (\d+) HP remaining)$/i))) {
      action = 'damage'; details.damage = Number(match[1]); details.destroyed = match[2] === 'now destroyed';
      details.remainingHP = match[3] === undefined ? null : Number(match[3]);
    }
    else if (/^Rested unit:/i.test(line)) action = 'rest';
    else if (/^Activated:/i.test(line)) action = 'activate';
    else if (/^Selecting target for /i.test(line)) action = 'select-target';
    else if (/^No targets for /i.test(line)) action = 'no-target';
    else if (/: Modifier applied to:/i.test(line)) action = 'modifier';
    else if (/: chose /i.test(line)) action = 'choice';
    else if (/^Winner!$/i.test(line)) action = 'winner';
    else if (/^No more shields available, game is over!$/i.test(line)) action = 'game-over';
    if (isPlay || action === 'deploy-token') {
      primaryCard = cards.length ? copy(cards[action === 'replace-base' ? cards.length - 1 : 0]) : null;
    }
    return { action: action, isPlay: isPlay, primaryCard: primaryCard,
      sourceZone: action === 'deploy-token' ? 'generated' : 'unknown', details: details };
  }

  function parseRows(rows, options) {
    options = options || {};
    var normalized = normalizeRows(rows);
    if (options.order === 'newest-first') normalized.reverse();
    var currentTurn = Number.isSafeInteger(options.initialTurn) && options.initialTurn > 0 ? options.initialTurn : null;
    var previousSourceIndex = null;
    return normalized.map(function (row, index) {
      if (row.sourceIndex !== null && previousSourceIndex !== null && Math.abs(row.sourceIndex - previousSourceIndex) > 1) currentTurn = null;
      var match = compact(row.rawText).match(/^Turn (\d+) started!$/i);
      if (match) currentTurn = Number(match[1]);
      previousSourceIndex = row.sourceIndex;
      var parsed = classify(row.rawText, row.cards);
      return Object.assign({
        id: text(options.idPrefix || 'event') + ':' + (index + 1),
        rawText: row.rawText,
        turn: currentTurn,
        actor: row.actor,
        cards: copy(row.cards),
        sourceIndex: row.sourceIndex,
        sourceOrder: options.order === 'newest-first' ? 'newest-first' : 'oldest-first',
        capturedAt: row.capturedAt || text(options.capturedAt) || null
      }, parsed);
    });
  }

  function signature(row) {
    return JSON.stringify([compact(row.rawText), row.actor, row.cards]);
  }

  function fingerprint(value) {
    var hash = 2166136261;
    for (var index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return value.length + ':' + (hash >>> 0).toString(16);
  }

  function startsWithRows(longer, shorter) {
    return longer.length >= shorter.length && shorter.every(function (row, index) {
      return signature(row) === signature(longer[index]);
    });
  }

  function findSequence(haystack, needle) {
    if (!needle.length) return 0;
    for (var index = 0; index <= haystack.length - needle.length; index += 1) {
      if (needle.every(function (row, offset) { return signature(row) === signature(haystack[index + offset]); })) return index;
    }
    return -1;
  }

  function overlap(left, right) {
    for (var count = Math.min(left.length, right.length); count > 0; count -= 1) {
      if (startsWithRows(right, left.slice(left.length - count))) return count;
    }
    return 0;
  }

  function mergeRows(existing, incoming, completeFromStart, existingComplete, order) {
    if (!existing.length) return { rows: incoming, status: completeFromStart ? 'initial-full' : 'initial-partial', full: completeFromStart };
    if (!incoming.length) return { rows: existing, status: 'empty', full: existingComplete };
    if (completeFromStart && existingComplete) {
      if (startsWithRows(incoming, existing)) {
        existing.forEach(function (event, index) {
          event.sourceIndex = incoming[index].sourceIndex;
          event.sourceOrder = incoming[index].sourceOrder;
        });
        return { rows: existing.concat(incoming.slice(existing.length)), status: 'prefix-appended', full: true };
      }
      if (startsWithRows(existing, incoming)) return { rows: existing, status: 'stale-prefix', full: true };
      return { rows: existing, status: 'conflict', full: existingComplete, warning: '公開紀錄已出現的前綴與新擷取不一致；新原文保留在 captures，未覆寫既有事件。' };
    }
    if (completeFromStart) {
      var position = findSequence(incoming, existing);
      if (position >= 0) {
        // A later complete DOM capture can rebase indices from an earlier
        // partial/virtualized window. Preserve IDs and first capture times,
        // while taking positions from the now-complete source sequence.
        existing.forEach(function (event, index) {
          event.sourceIndex = incoming[position + index].sourceIndex;
          event.sourceOrder = incoming[position + index].sourceOrder;
        });
        return { rows: incoming.slice(0, position).concat(existing, incoming.slice(position + existing.length)), status: 'completed-history', full: true };
      }
      return { rows: existing, status: 'conflict', full: existingComplete, warning: '完整起點擷取無法與既有部分紀錄對齊；新原文保留在 captures，未推測事件次序。' };
    }
    // Stable rendered indices disambiguate successive identical lines in an
    // oldest-first window. Text equality alone would lose the newer occurrence.
    var indexed = order === 'oldest-first' && existing.every(function (row, i) {
      return row.sourceOrder !== 'newest-first' && row.sourceIndex !== null && (i === 0 || row.sourceIndex > existing[i - 1].sourceIndex);
    }) && incoming.every(function (row, i) {
      return row.sourceIndex !== null && (i === 0 || row.sourceIndex > incoming[i - 1].sourceIndex);
    });
    if (indexed) {
      var byIndex = new Map(existing.map(function (row) { return [row.sourceIndex, row]; }));
      var matches = incoming.filter(function (row) { return byIndex.has(row.sourceIndex); });
      var consistent = matches.every(function (row) { return signature(row) === signature(byIndex.get(row.sourceIndex)); });
      var adjacent = incoming[0].sourceIndex === existing[existing.length - 1].sourceIndex + 1;
      if (consistent && (matches.length > 0 || adjacent)) {
        incoming.forEach(function (row) { if (!byIndex.has(row.sourceIndex)) byIndex.set(row.sourceIndex, row); });
        return { rows: Array.from(byIndex.values()).sort(function (a, b) { return a.sourceIndex - b.sourceIndex; }), status: 'indexed-merge', full: existingComplete };
      }
    }
    if (findSequence(existing, incoming) >= 0) return { rows: existing, status: 'already-observed', full: existingComplete };
    var common = overlap(existing, incoming);
    if (common) return { rows: existing.concat(incoming.slice(common)), status: 'overlap-appended', full: existingComplete };
    common = overlap(incoming, existing);
    if (common) return { rows: incoming.slice(0, incoming.length - common).concat(existing), status: 'overlap-prepended', full: false };
    return { rows: existing, status: 'unmerged', full: existingComplete, warning: '新擷取與既有公開紀錄沒有可確認的重疊；原文保留在 captures，未推測其先後順序。' };
  }

  function refreshEvents(log) {
    var turn = null;
    var previousSourceIndex = null;
    log.events.forEach(function (event) {
      if (event.sourceIndex !== null && previousSourceIndex !== null && Math.abs(event.sourceIndex - previousSourceIndex) > 1) turn = null;
      var match = compact(event.rawText).match(/^Turn (\d+) started!$/i);
      if (match) turn = Number(match[1]);
      event.turn = turn;
      previousSourceIndex = event.sourceIndex;
    });
    var turns = log.events.map(function (event) { return event.turn; }).filter(function (value) { return value !== null; });
    var gameStarted = log.events.some(function (event) { return event.action === 'game-start'; });
    var gameEnded = log.events.some(function (event) { return event.action === 'game-end'; });
    var unmerged = log.captures.filter(function (capture) { return capture.mergeStatus === 'conflict' || capture.mergeStatus === 'unmerged'; }).length;
    var missingTurns = false;
    var starts = log.events.filter(function (event) { return event.action === 'turn-start'; }).map(function (event) { return event.turn; });
    if ((gameStarted && starts.length && starts[0] !== 1) || (gameEnded && !starts.length)) missingTurns = true;
    starts.forEach(function (number, index) { if (index && number !== starts[index - 1] + 1) missingTurns = true; });
    var missingIndices = log.events.some(function (event, index) {
      var previous = log.events[index - 1];
      return previous && previous.sourceOrder === 'oldest-first' && event.sourceOrder === 'oldest-first' &&
        previous.sourceIndex !== null && event.sourceIndex !== null && Math.abs(event.sourceIndex - previous.sourceIndex) > 1;
    });
    log.coverage = {
      completeFromStart: Boolean(log.coverage.completeFromStart),
      hasGaps: !log.coverage.completeFromStart || missingTurns || missingIndices || unmerged > 0,
      gameStarted: gameStarted,
      gameEnded: gameEnded,
      firstTurn: turns.length ? Math.min.apply(null, turns) : null,
      lastTurn: turns.length ? Math.max.apply(null, turns) : null,
      unmergedCaptureCount: unmerged,
      publicLogComplete: Boolean(log.coverage.completeFromStart && gameStarted && gameEnded && !missingTurns && !missingIndices && !unmerged)
    };
  }

  function ingest(session, batch) {
    if (!session || session.schemaVersion !== 1 || !Array.isArray(session.snapshots)) throw new TypeError('A schemaVersion 1 recorder session is required.');
    batch = batch || {};
    var next = copy(session);
    var capturedAt = typeof batch.observedAt === 'string' ? batch.observedAt : new Date().toISOString();
    var order = batch.order === 'newest-first' ? 'newest-first' : 'oldest-first';
    var incoming = parseRows(batch.rows, { capturedAt: capturedAt, order: order });
    var starts = incoming.length > 0 && incoming[0].action === 'game-start';
    var full = batch.completeFromStart === true && starts;
    var log = next.battleLog || {
      schemaVersion: 1, events: [], captures: [], players: [], coverage: { completeFromStart: false }, warnings: [], nextEventNumber: 1
    };
    next.battleLog = log;
    if (log.schemaVersion !== 1) throw new TypeError('Unsupported battle log schema version.');
    log.players = unique(log.players.concat((Array.isArray(batch.players) ? batch.players : []).map(text), incoming.map(function (event) { return event.actor; })));
    if (batch.completeFromStart && !starts) addWarning(log, '擷取標示從開局開始，但首行並非 Game started!；仍視為部分公開紀錄。');
    var captureFingerprint = fingerprint(JSON.stringify([order, full, incoming.map(function (event) { return [signature(event), event.sourceIndex]; })]));
    var lastCapture = log.captures[log.captures.length - 1];
    var repeatedRows = lastCapture && lastCapture.rows ? normalizeRows(lastCapture.rows) : log.events;
    var sameSequence = findSequence(repeatedRows, incoming);
    var sameIndexedRows = sameSequence >= 0 && incoming.every(function (event, index) {
      return event.sourceIndex === repeatedRows[sameSequence + index].sourceIndex;
    });
    if (lastCapture && lastCapture.fingerprint === captureFingerprint && sameIndexedRows) {
      lastCapture.lastObservedAt = capturedAt;
      lastCapture.repeatCount += 1;
      next.updatedAt = capturedAt;
      return next;
    }
    var merged = mergeRows(log.events, incoming, full, log.coverage.completeFromStart, order);
    var priorIds = new Set(log.events.map(function (event) { return event.id; }));
    var priorObjects = new Set(log.events);
    var added = 0;
    merged.rows.forEach(function (event) {
      if (!priorObjects.has(event)) {
        var number = log.nextEventNumber || log.events.length + 1;
        event.id = text(session.id) + ':log:' + number;
        log.nextEventNumber = number + 1;
        added += 1;
      }
    });
    log.events = merged.rows;
    log.coverage.completeFromStart = merged.full;
    var capture = {
      id: text(session.id) + ':capture:' + (log.captures.length + 1),
      observedAt: capturedAt,
      lastObservedAt: capturedAt,
      repeatCount: 1,
      rowCount: incoming.length,
      order: order,
      completeFromStart: full,
      ended: batch.ended === true,
      mergeStatus: merged.status,
      addedEventCount: added,
      fingerprint: captureFingerprint,
      eventIds: log.events.filter(function (event) { return !priorIds.has(event.id); }).map(function (event) { return event.id; })
    };
    if (merged.warning) {
      capture.warning = merged.warning;
      capture.rows = copy(incoming.map(function (event) {
        return { text: event.rawText, actor: event.actor, cards: event.cards, sourceIndex: event.sourceIndex };
      }));
      addWarning(log, merged.warning);
    }
    log.captures.push(capture);
    refreshEvents(log);
    next.updatedAt = capturedAt;
    return next;
  }

  function completeHand(snapshot) {
    if (!snapshot || snapshot.quality !== 'complete' || (snapshot.unknownCount || 0) > 0 || !Array.isArray(snapshot.hand)) return false;
    if (!snapshot.hand.every(function (card) { return card && typeof card.cardCode === 'string' && Number.isSafeInteger(card.count) && card.count > 0; })) return false;
    var total = snapshot.hand.reduce(function (sum, card) { return sum + card.count; }, 0);
    return snapshot.expectedCount === undefined || snapshot.expectedCount === null || snapshot.expectedCount === total;
  }

  function snapshotObservations(session) {
    var snapshots = Array.isArray(session.snapshots) ? session.snapshots : [];
    return snapshots.map(function (snapshot, index) {
      var previous = snapshots[index - 1];
      var deltaStatus = 'first-observation';
      var delta = null;
      if (previous) {
        if ((previous.sourceSessionId || session.id) !== (snapshot.sourceSessionId || session.id)) deltaStatus = 'segment-boundary';
        else if (!completeHand(previous) || !completeHand(snapshot)) deltaStatus = 'incomplete-observation';
        else {
          deltaStatus = 'compared';
          var before = new Map();
          var after = new Map();
          previous.hand.forEach(function (card) { before.set(card.cardCode, (before.get(card.cardCode) || 0) + card.count); });
          snapshot.hand.forEach(function (card) { after.set(card.cardCode, (after.get(card.cardCode) || 0) + card.count); });
          delta = { added: [], removed: [] };
          unique(Array.from(before.keys()).concat(Array.from(after.keys()))).sort().forEach(function (code) {
            var change = (after.get(code) || 0) - (before.get(code) || 0);
            if (change > 0) delta.added.push({ cardCode: code, count: change });
            if (change < 0) delta.removed.push({ cardCode: code, count: -change });
          });
        }
      }
      return { index: index + 1, snapshot: copy(snapshot), previousSnapshotId: previous ? previous.id || null : null,
        delta: delta, deltaStatus: deltaStatus };
    });
  }

  function deltaDescription(observation) {
    if (!observation || observation.deltaStatus === 'first-observation') return '首筆觀察，沒有可比較的前一筆。';
    if (observation.deltaStatus === 'segment-boundary') return '不同來源段落，不跨段推算手牌差值。';
    if (observation.deltaStatus !== 'compared' || !observation.delta) return '相鄰觀察含不完整或未知手牌，不推算差值。';
    var added = observation.delta.added.map(function (card) { return card.cardCode + ' +' + card.count; });
    var removed = observation.delta.removed.map(function (card) { return card.cardCode + ' -' + card.count; });
    if (!added.length && !removed.length) return '與前一筆完整觀察相比，卡號與數量未變。';
    return '與前一筆完整觀察相比：' + added.concat(removed).join('、') + '。僅表示觀察數量差，進出原因未知。';
  }

  function collectHandCaptureIssues(session) {
    var issues = [];
    var seen = new Set();
    function visit(record, fallbackId) {
      if (!record || typeof record !== 'object') return;
      var sourceId = text(record.id || fallbackId);
      (Array.isArray(record.captureIssues) ? record.captureIssues : []).forEach(function (raw, index) {
        // Keep unfamiliar fields, and identify the original issue position so
        // repeated issues within a source survive while combined audit copies
        // do not produce the same warning twice.
        var issue = raw && typeof raw === 'object' && !Array.isArray(raw) ? copy(raw) : { rawValue: copy(raw) };
        if (issue.sourceSessionId === undefined) issue.sourceSessionId = sourceId;
        if (issue.sourceIssueIndex === undefined) issue.sourceIssueIndex = index;
        var key = JSON.stringify(issue);
        if (!seen.has(key)) { seen.add(key); issues.push(issue); }
      });
      (Array.isArray(record.sourceRecords) ? record.sourceRecords : []).forEach(function (source, index) {
        visit(source, sourceId + ':source:' + index);
      });
    }
    visit(session, 'unknown');
    return issues;
  }

  function handCaptureIssueDescription(issue) {
    return '手牌擷取缺口：來源段落 ' + text(issue.sourceSessionId || '未知') +
      '；觀察時間 ' + text(issue.observedAt || '未知') +
      '；代碼 ' + text(issue.code || '未知') +
      (issue.pendingCount !== undefined ? '；待存觀察 ' + text(issue.pendingCount) + ' 筆' : '') +
      (issue.reason ? '；' + text(issue.reason) : '；原因未提供') +
      '。公開 Log 的完整性不能補回這段手牌觀察缺口。';
  }

  function buildTimeline(session) {
    var log = session.battleLog || { events: [], players: [], coverage: { completeFromStart: false, hasGaps: true, publicLogComplete: false }, warnings: [] };
    var groups = new Map();
    function groupFor(turn, observedTurn, turnSource, sourceSessionId) {
      var key = turn !== null ? 'turn:' + turn : 'observed:' + text(sourceSessionId || session.id) + ':' + turnSource + ':' + observedTurn;
      if (!groups.has(key)) groups.set(key, {
        key: key, turn: turn, turnSource: turnSource, observedTurn: observedTurn,
        activePlayer: '', activePlayerSource: 'unknown', first: null, last: null, snapshotCount: 0,
        snapshots: [], observations: [], events: [], plays: [], handFlags: { observedOnly: true, openingConfirmed: false, endConfirmed: false, turnAlignment: 'unknown', hasIncompleteObservations: false }
      });
      return groups.get(key);
    }
    var unassignedEvents = [];
    var firstPlayer = '';
    log.events.forEach(function (event) {
      if (event.action === 'choose-first' && event.actor) firstPlayer = event.actor;
      if (event.turn === null) { unassignedEvents.push(copy(event)); return; }
      var group = groupFor(event.turn, null, 'log');
      group.events.push(copy(event));
      if (event.isPlay) group.plays.push(copy(event));
      if (event.action === 'turn-end' && event.actor) { group.activePlayer = event.actor; group.activePlayerSource = 'turn-ended-log'; }
    });
    var unassignedSnapshots = [];
    snapshotObservations(session).forEach(function (observation) {
      var snapshot = observation.snapshot;
      var turn = Number.isSafeInteger(snapshot.turn) && snapshot.turn > 0 ? snapshot.turn : null;
      var group = groupFor(turn, snapshot.observedTurn, snapshot.turnSource, snapshot.sourceSessionId);
      if (!group.first) group.first = copy(snapshot);
      group.last = copy(snapshot);
      group.snapshots.push(copy(snapshot));
      group.observations.push(copy(observation));
      group.snapshotCount += 1;
      if (group.observedTurn === null) group.observedTurn = snapshot.observedTurn;
      if (!group.activePlayer && snapshot.activePlayer) { group.activePlayer = snapshot.activePlayer; group.activePlayerSource = 'hand-observation'; }
      if (snapshot.turnSource === 'log' && group.handFlags.turnAlignment !== 'estimated') group.handFlags.turnAlignment = 'log';
      else group.handFlags.turnAlignment = turn === null ? 'unassigned' : 'estimated';
      if (snapshot.quality !== 'complete') group.handFlags.hasIncompleteObservations = true;
      if (turn === null) unassignedSnapshots.push(copy(snapshot));
    });
    var players = unique((log.players || []).concat(text(session.playerName)));
    var turns = Array.from(groups.values());
    turns.forEach(function (group) {
      if (!group.activePlayer && group.turn !== null && firstPlayer && players.length === 2) {
        group.activePlayer = group.turn % 2 === 1 ? firstPlayer : players.find(function (name) { return name !== firstPlayer; });
        group.activePlayerSource = 'first-player-order';
      }
    });
    turns.sort(function (a, b) {
      if (a.turn !== null && b.turn !== null) return a.turn - b.turn;
      if (a.turn !== null) return -1;
      if (b.turn !== null) return 1;
      return (a.observedTurn || 0) - (b.observedTurn || 0);
    });
    var handCaptureIssues = collectHandCaptureIssues(session);
    return { players: players, turns: turns, unassignedEvents: unassignedEvents, unassignedSnapshots: unassignedSnapshots,
      coverage: copy(log.coverage), handCaptureIssues: handCaptureIssues,
      warnings: copy(log.warnings || []).concat(handCaptureIssues.map(handCaptureIssueDescription)) };
  }

  function combineSessions(sessions) {
    if (!Array.isArray(sessions) || !sessions.length) throw new TypeError('At least one recorder session is required.');
    sessions.forEach(function (session) {
      if (!session || session.schemaVersion !== 1 || !Array.isArray(session.snapshots) || !text(session.gameId).trim()) {
        throw new TypeError('Every source must be a schemaVersion 1 session with a gameId.');
      }
      if (!text(session.playerName).trim() && session.snapshots.length) {
        throw new TypeError('A session containing hand observations needs an identified player before combining.');
      }
    });
    var gameIds = unique(sessions.map(function (session) { return text(session.gameId); }));
    var names = unique(sessions.map(function (session) { return text(session.playerName).trim(); }));
    if (gameIds.length !== 1) throw new TypeError('Cannot combine different game IDs.');
    if (names.length > 1) throw new TypeError('Cannot combine different player names.');
    var sources = sessions.slice().sort(function (a, b) { return text(a.startedAt).localeCompare(text(b.startedAt)); });
    var combined = core.createSession({
      id: 'combined-' + fingerprint(sources.map(function (source) { return text(source.id); }).join('|')),
      gameId: gameIds[0], playerName: names[0] || '', startedAt: sources[0].startedAt
    });
    combined.isCombined = true;
    // Keep complete source records, including unfamiliar/legacy fields and
    // original capture metadata, alongside the non-destructive merged view.
    combined.sourceRecords = sources.map(copy);
    var handCaptureIssues = collectHandCaptureIssues(combined);
    if (handCaptureIssues.length) combined.captureIssues = handCaptureIssues;
    combined.sourceSessions = sources.map(function (source) {
      return { id: source.id, playerName: source.playerName, startedAt: source.startedAt, updatedAt: source.updatedAt };
    });
    sources.forEach(function (source) {
      source.snapshots.forEach(function (snapshot, index) {
        var observation = copy(snapshot);
        observation.sourceSessionId = snapshot.sourceSessionId || source.id;
        if (index === 0) observation.delta = null;
        combined.snapshots.push(observation);
      });
      if (!source.battleLog) return;
      var log = source.battleLog;
      combined = ingest(combined, {
        observedAt: source.updatedAt,
        order: 'oldest-first',
        completeFromStart: Boolean(log.coverage && log.coverage.completeFromStart),
        ended: Boolean(log.coverage && log.coverage.gameEnded),
        players: log.players || [],
        rows: (log.events || []).map(function (event) {
          return { text: event.rawText, actor: event.actor, cards: event.cards, sourceIndex: event.sourceIndex, capturedAt: event.capturedAt };
        })
      });
      (log.captures || []).filter(function (capture) { return capture.rows; }).forEach(function (capture) {
        combined = ingest(combined, { observedAt: capture.observedAt, order: 'oldest-first',
          completeFromStart: capture.completeFromStart, rows: capture.rows, players: log.players || [] });
      });
      (log.warnings || []).forEach(function (warning) { addWarning(combined.battleLog, warning); });
    });
    combined.updatedAt = sources.map(function (source) { return text(source.updatedAt); }).sort().pop() || combined.startedAt;
    return combined;
  }

  function csvCell(value) {
    var output = text(value);
    if (/^[\t\r\n]|^[\s\u0000-\u0020]*[=+@-]/.test(output)) output = "'" + output;
    return '"' + output.replace(/"/g, '""') + '"';
  }
  function csv(rows) { return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }
  function cardList(cards) { return cards.map(function (card) { return (card.cardCode || '?') + (card.name ? ' ' + card.name : ''); }).join(' | '); }

  function toEventsCSV(session) {
    var coverage = buildTimeline(session).coverage;
    var rows = [['session_id', 'game_id', 'event_id', 'captured_at', 'turn', 'actor', 'action', 'is_play',
      'primary_card_code', 'primary_card_name', 'source_zone', 'cards', 'source_index', 'raw_text',
      'coverage_complete_from_start', 'coverage_has_gaps', 'coverage_public_log_complete']];
    ((session.battleLog && session.battleLog.events) || []).forEach(function (event) {
      rows.push([session.id, session.gameId, event.id, event.capturedAt, event.turn, event.actor, event.action,
        event.isPlay, event.primaryCard && event.primaryCard.cardCode, event.primaryCard && event.primaryCard.name,
        event.sourceZone, cardList(event.cards), event.sourceIndex, event.rawText,
        coverage.completeFromStart, coverage.hasGaps, coverage.publicLogComplete]);
    });
    return csv(rows);
  }

  function toCSV(session) {
    var coverage = buildTimeline(session).coverage;
    var rows = [['record_type', 'session_id', 'game_id', 'record_id', 'observed_at', 'turn', 'turn_source',
      'observed_turn', 'actor', 'action', 'card_code', 'count', 'quality', 'expected_count', 'unknown_count',
      'phase', 'is_play', 'source_zone', 'source_index', 'raw_text', 'source_session_id',
      'coverage_complete_from_start', 'coverage_has_gaps', 'coverage_public_log_complete',
      'resource_level', 'resource_active', 'resource_ex_active', 'resource_total_active']];
    ((session.battleLog && session.battleLog.events) || []).forEach(function (event) {
      rows.push(['event', session.id, session.gameId, event.id, event.capturedAt, event.turn, 'log', '', event.actor,
        event.action, event.primaryCard && event.primaryCard.cardCode, '', '', '', '', '', event.isPlay,
        event.sourceZone, event.sourceIndex, event.rawText, '',
        coverage.completeFromStart, coverage.hasGaps, coverage.publicLogComplete, '', '', '', '']);
    });
    (session.snapshots || []).forEach(function (snapshot) {
      var hand = copy(snapshot.hand || []);
      if (snapshot.quality !== 'complete' || snapshot.unknownCount > 0) hand.push({ cardCode: '[UNKNOWN]', count: snapshot.unknownCount || '' });
      if (!hand.length) hand.push({ cardCode: '[EMPTY]', count: 0 });
      hand.forEach(function (card) {
        rows.push(['hand', session.id, session.gameId, snapshot.id, snapshot.timestamp, snapshot.turn,
          snapshot.turnSource, snapshot.observedTurn, session.playerName, 'hand-observation', card.cardCode,
          card.count, snapshot.quality, snapshot.expectedCount, snapshot.unknownCount, snapshot.phase,
          false, 'visible-hand', '', snapshot.reason, snapshot.sourceSessionId || session.id,
          coverage.completeFromStart, coverage.hasGaps, coverage.publicLogComplete,
          snapshot.resources && snapshot.resources.level, snapshot.resources && snapshot.resources.active,
          snapshot.resources && snapshot.resources.exActive, snapshot.resources && snapshot.resources.totalActive]);
      });
    });
    return csv(rows);
  }

  function markdown(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r?\n/g, ' ⏎ ');
  }
  function handDescription(snapshot) {
    if (!snapshot) return '未記錄；不可還原當時手牌。';
    var known = (snapshot.hand || []).map(function (card) { return card.count + 'x' + card.cardCode; }).join('、');
    if (!known && completeHand(snapshot)) known = '已觀察到空手';
    if (snapshot.unknownCount) known += (known ? '；' : '') + '未辨識 ' + snapshot.unknownCount + ' 張';
    if (snapshot.quality !== 'complete' && !snapshot.unknownCount) known += (known ? '；' : '') + '未知張數，並非確認空手';
    if (!known) known = '沒有可確認卡號，不能視為空手';
    return markdown(known) + '；品質 ' + markdown(snapshot.quality) + '；觀察時間 ' + markdown(snapshot.timestamp) +
      '；回合來源 ' + markdown(snapshot.turnSource) + (snapshot.sourceSessionId ? '；記錄段落 ' + markdown(snapshot.sourceSessionId) : '') +
      '；階段 ' + markdown(snapshot.phase || '未知') + '；' + markdown(resourceDescription(snapshot.resources)) +
      (snapshot.reason ? '；原因 ' + markdown(snapshot.reason) : '');
  }
  function resourceDescription(resources) {
    if (typeof core.resourceText === 'function') return core.resourceText(resources);
    return resources ? '資源等級 ' + text(resources.level) + '，一般可用 ' + text(resources.active) + '，EX 可用未知' : '資源未辨識';
  }
  function eventLine(event) {
    return '- [' + markdown(event.id) + '] ' + markdown(event.actor || '系統') + '：' + markdown(event.rawText) +
      (event.cards.length ? ' ｜卡牌：' + markdown(cardList(event.cards)) : '');
  }

  function workspaceSummary(session, info) {
    var records = {}, notes = [], matches = [];
    var player = typeof session.playerName === 'string' ? session.playerName.trim() : '';
    var game = typeof session.gameId === 'string' ? session.gameId : '';
    var sources = session.isCombined || Array.isArray(session.sourceSessions) ? (Array.isArray(session.sourceSessions) ? session.sourceSessions : []).map(function (source) {
      return typeof source === 'string' ? source : source && source.id;
    }) : [session.id];
    var ids = new Set(sources.filter(function (id) { return typeof id === 'string' && id.trim(); }));
    var values = info && info.workspaceRecords;
    var result = {records:records, notes:notes, match:null, deck:null, identityConfirmed:Boolean(game && player && ids.size)};
    if (!result.identityConfirmed || !values || typeof values !== 'object' || Array.isArray(values)) return result;
    Object.keys(values).forEach(function (key) {
      var value = values[key];
      if (!value || value.schemaVersion !== 1 || typeof value.id !== 'string' || !value.id ||
        value.gameId !== game || value.playerName !== player) return;
      if (key === 'msa.note.' + value.id && ids.has(value.sourceSessionId)) {
        records[key] = copy(value);
        if (!value.deletedAt && typeof value.note === 'string') notes.push(value);
      } else if (key === 'msa.match.' + value.id && value.source === 'manual' && value.identityConfirmed === true) {
        // Manual results describe the whole game, including other runs of this
        // same player. Notes, unlike results, belong to selected source runs.
        records[key] = copy(value); matches.push(value);
      }
    });
    matches.forEach(function (match) {
      var id = typeof match.deckVersionId === 'string' ? match.deckVersionId : '';
      var deck = id && values['msa.deck.' + id];
      if (deck && deck.schemaVersion === 1 && deck.id === id) records['msa.deck.' + id] = copy(deck);
    });
    function time(value) { var parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : -Infinity; }
    notes.sort(function (a,b) { return time(a.createdAt) - time(b.createdAt) || text(a.id).localeCompare(text(b.id)); });
    matches.sort(function (a,b) { return time(b.updatedAt) - time(a.updatedAt) || text(b.id).localeCompare(text(a.id)); });
    var latest = matches[0];
    if (latest && latest.resultConfirmed === true && ['win','loss','draw','concede'].includes(latest.result)) {
      result.match = latest;
      var frozen = latest.frozenDeckVersion, deckId = latest.deckVersionId;
      result.deck = frozen && frozen.schemaVersion === 1 && frozen.id === deckId ? frozen : records['msa.deck.' + deckId] || null;
    }
    return result;
  }
  function bookmarkTurn(note) {
    if (Number.isSafeInteger(note.turn) && note.turn > 0) {
      if (note.turnSource === 'log') return 'Log 校準 · T' + note.turn;
      if (note.turnSource === 'phase-observed') return '推計回合 · T' + note.turn;
    }
    return (Number.isSafeInteger(note.observedTurn) && note.observedTurn > 0 ? '觀察 ' + note.observedTurn + ' · ' : '') + '回合未校準';
  }
  function bookmarkAnchor(session, note) {
    var present = (session.snapshots || []).some(function (snapshot) {
      return snapshot.id === note.snapshotId && (snapshot.sourceSessionId || session.id) === note.sourceSessionId;
    });
    return '來源段落 ' + text(note.sourceSessionId) + ' · 來源快照 ' + text(note.snapshotId || '未標示') +
      (present ? '' : '；來源快照未在本次匯出中，不改接其他回合。');
  }
  function matchDescription(match) {
    var results = {win:'勝',loss:'負',draw:'和局',concede:'本人投降（負）'};
    var orders = {first:'先手',second:'後手',unknown:'先後手未確認'};
    return '人工確認結果：' + results[match.result] + ' · ' + (orders[match.firstPlayer] || orders.unknown) +
      ' · 確認更新 ' + text(match.updatedAt || '時間未知') + '。這是整局人工記錄，不是依 Log 自動推定。';
  }
  function deckDescription(deck) {
    function total(rows) {
      if (!Array.isArray(rows) || rows.some(function (row) { return !row || !Number.isSafeInteger(row.count) || row.count < 1; })) return '未知';
      var sum = rows.reduce(function (amount,row) { return amount + row.count; },0);
      return Number.isSafeInteger(sum) ? sum + ' 張' : '未知';
    }
    return '牌組：' + text(deck.name || '未命名') + ' · 版本 ' + text(deck.id) +
      ' · 主牌 ' + total(deck.main) + ' · 資源 ' + total(deck.resources) + ' · Token ' + total(deck.tokens) +
      ' · 內容識別 ' + text(deck.contentHash || '未提供') + '。此摘要不驗證賽制合法性。';
  }
  function workspaceMarkdown(session, summary) {
    var lines = ['', '## 書籤與筆記', '', '- 僅顯示本玩家、本次來源段落的有效筆記；已刪除筆記不列在閱讀內容。', ''];
    if (!summary.notes.length) lines.push('- ' + (summary.identityConfirmed ? '本次來源段落沒有有效筆記。' : '玩家身分或來源段落未確認，不顯示筆記。'));
    summary.notes.forEach(function (note) {
      lines.push('### ' + markdown(note.tag || '未設標籤'), '', '- ' + markdown(bookmarkTurn(note)),
        '- ' + markdown(bookmarkAnchor(session,note)), '- 建立 ' + markdown(note.createdAt || '時間未知') +
        ' · 更新 ' + markdown(note.updatedAt || '時間未知'), '', markdown(note.note || '（未填寫筆記）'), '');
    });
    lines.push('', '## 人工戰績與牌組', '');
    if (!summary.match) lines.push('- 尚無本玩家可顯示的最新人工確認結果；不從公開事件猜測勝負。');
    else {
      lines.push('- ' + markdown(matchDescription(summary.match)), '- 結果來源段落：' + markdown(summary.match.sourceSessionId || '未標示'));
      lines.push('- ' + (summary.deck ? markdown(deckDescription(summary.deck)) : '未提供可核對的綁定牌組版本。'));
    }
    return lines;
  }
  function workspaceHTML(session, summary) {
    var parts = ['<section class="turn" data-workspace-section="notes"><h2>書籤與筆記</h2><p class="meta">僅顯示本玩家、本次來源段落的有效筆記；已刪除筆記只保留於匯出資訊原始資料。</p>'];
    if (!summary.notes.length) parts.push('<p>' + (summary.identityConfirmed ? '本次來源段落沒有有效筆記。' : '玩家身分或來源段落未確認，不顯示筆記。') + '</p>');
    summary.notes.forEach(function (note) {
      parts.push('<article class="snapshot" data-note-id="' + html(note.id) + '"><h3>' + html(note.tag || '未設標籤') + '</h3>' +
        '<p class="meta">' + html(bookmarkTurn(note)) + '</p><p class="meta">' + html(bookmarkAnchor(session,note)) +
        '</p><p class="meta">建立 ' + html(note.createdAt || '時間未知') + ' · 更新 ' + html(note.updatedAt || '時間未知') +
        '</p><pre>' + html(note.note || '（未填寫筆記）') + '</pre></article>');
    });
    parts.push('</section><section class="turn" data-workspace-section="match"><h2>人工戰績與牌組</h2>');
    if (!summary.match) parts.push('<p>尚無本玩家可顯示的最新人工確認結果；不從公開事件猜測勝負。</p>');
    else {
      parts.push('<p>' + html(matchDescription(summary.match)) + '</p><p class="meta">結果來源段落：' + html(summary.match.sourceSessionId || '未標示') + '</p>',
        '<p>' + (summary.deck ? html(deckDescription(summary.deck)) : '未提供可核對的綁定牌組版本。') + '</p>');
    }
    parts.push('</section>'); return parts.join('\n');
  }

  function toMarkdown(session, options) {
    options = options || {};
    var timeline = buildTimeline(session);
    var lines = ['# MSA 對局分析資料', '', '- 對局：' + markdown(session.gameId), '- 我的玩家名稱：' + markdown(session.playerName),
      '- 公開紀錄：' + (timeline.coverage.publicLogComplete ? '已觀察到 Game started 至 Game ended 的連續公開紀錄。' : '部分或仍在進行；請確認 coverage 與擷取警告。'),
      '- 手牌首末代表該回合「第一次／最後一次觀察」，不保證是真正回合開始／結束手牌。',
      '- 公開事件的 capturedAt 是擷取時間，不是事件發生時間；不把手牌數量差推論成出牌、抽牌或棄牌。',
      '- 公開部署／使用事件未必來自手牌；token 生成不列為手牌出牌。對手隱藏手牌未知。', ''];
    if (options.exportInfo) {
      lines.push('- 匯出前刷新：' + markdown(refreshDescription(options.exportInfo)),
        '- 匯出時間：' + markdown(options.exportInfo.exportedAt || '未標示'), '');
      if (Object.prototype.hasOwnProperty.call(options.exportInfo,'workspaceRecords')) {
        lines.push.apply(lines,workspaceMarkdown(session,workspaceSummary(session,options.exportInfo)));
      }
    }
    timeline.warnings.forEach(function (warning) { lines.push('- 警告：' + markdown(warning)); });
    if (timeline.handCaptureIssues.length) {
      lines.push('', '## 手牌擷取缺口', '', '以下缺口獨立於公開 Log 涵蓋狀態；即使公開 Log 已見完整起尾，未存入的手牌觀察仍不可還原。', '');
      timeline.handCaptureIssues.forEach(function (issue) {
        lines.push('- ' + markdown(handCaptureIssueDescription(issue)), '- 原始欄位：' + markdown(JSON.stringify(issue)), '');
      });
    }
    if (timeline.unassignedEvents.length) {
      lines.push('', '## 開局或無法歸屬回合的公開事件', '');
      timeline.unassignedEvents.forEach(function (event) { lines.push(eventLine(event)); });
    }
    timeline.turns.forEach(function (turn) {
      lines.push('', '## ' + (turn.turn === null ? '觀察回合 ' + turn.observedTurn + '（未對齊絕對回合）' :
        (turn.turnSource === 'phase-observed' && !turn.events.length ? '推計第 ' : '第 ') + turn.turn + ' 回合'), '',
        '- 行動方：' + markdown(turn.activePlayer || '未知') + '（' + markdown(turn.activePlayerSource) + '）',
        '- 手牌對齊：' + markdown(turn.handFlags.turnAlignment) + '；觀察數：' + turn.snapshotCount,
        '- 首次手牌觀察：' + handDescription(turn.first), '- 最後手牌觀察：' + handDescription(turn.last), '', '### 全部手牌快照', '');
      if (!turn.observations.length) lines.push('- 未記錄手牌快照，不代表空手。');
      turn.observations.forEach(function (observation) {
        lines.push('#### 手牌快照 ' + observation.index + '：' + markdown(observation.snapshot.id || '無 ID'), '',
          '- ' + handDescription(observation.snapshot), '- 快照差值：' + markdown(deltaDescription(observation)), '');
      });
      lines.push('### 公開事件', '');
      if (!turn.events.length) lines.push('- 未取得可對齊的公開事件。');
      turn.events.forEach(function (event) { lines.push(eventLine(event)); });
    });
    var unmerged = ((session.battleLog && session.battleLog.captures) || []).filter(function (capture) { return capture.rows; });
    if (unmerged.length) {
      lines.push('', '## 未合併擷取原文（先後次序待確認）', '');
      unmerged.forEach(function (capture) {
        lines.push('### ' + markdown(capture.id), '', '- 擷取時間：' + markdown(capture.observedAt), '- 原因：' + markdown(capture.warning), '');
        capture.rows.forEach(function (row) { lines.push('- ' + markdown(row.actor || '系統') + '：' + markdown(row.text)); });
      });
    }
    return lines.join('\n') + '\n';
  }

  function serializeForHTML(value) {
    // JSON inside a non-executable script still follows HTML's script end-tag
    // parsing rules. Escape delimiters so user text can never close the tag.
    return JSON.stringify(value === undefined ? null : value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function html(value) {
    return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function refreshDescription(info) {
    var refresh = info && info.refresh;
    if (!refresh) return '此匯出未提供刷新結果；只保留當時已儲存資料。';
    return (refresh.refreshed ? (refresh.partial ? '已刷新，但仍有部分資料未確認' : '已完成匯出前刷新') : '未能確認刷新，匯出既有資料') +
      (refresh.reason ? '：' + text(refresh.reason) : '') + '。刷新成功也不表示所有歷史手牌均已記錄。';
  }

  function toHTML(session, options) {
    options = options || {};
    var timeline = buildTimeline(session);
    var info = copy(options.exportInfo || {});
    var workspace = null;
    if (Object.prototype.hasOwnProperty.call(info,'workspaceRecords')) {
      workspace = workspaceSummary(session,info);
      // Keep deleted/inactive in-scope metadata for restoration, but never
      // embed another player's/game's records even if a caller passes a wider map.
      info.workspaceRecords = workspace.records;
    }
    if (!info.exportedAt) info.exportedAt = new Date().toISOString();
    var parts = ['<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>MSA 完整觀察紀錄</title>',
      '<style>body{max-width:1120px;margin:32px auto;padding:0 22px;background:#f3f6f8;color:#203b4d;font:14px/1.6 system-ui,sans-serif}h1{font-size:28px}h2{margin-bottom:4px}h3{font-size:17px}.turn{border-top:2px solid #a4c7c5;margin-top:30px;padding-top:18px}.snapshot,.event{background:white;border:1px solid #d5e1e7;border-radius:8px;padding:14px 18px;margin:12px 0}.snapshot h4{margin:0}.meta{color:#587283;font-size:12px;overflow-wrap:anywhere}.note{background:#fff3db;padding:12px;border-radius:6px}.cards{display:flex;gap:8px 16px;flex-wrap:wrap;padding:0;list-style:none}.cards li{font-family:monospace}.delta{font-size:12px;color:#506758}.quality{font-size:12px;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin-top:24px}summary{cursor:pointer}footer{margin-top:30px;font-size:12px;color:#627785}@media print{body{background:white;margin:0}.snapshot,.event{break-inside:avoid}}</style></head><body>',
      '<h1>MSA 完整觀察紀錄</h1><p>對局 ' + html(session.gameId) + ' · 玩家 ' + html(session.playerName || '未辨識') + '</p>',
      '<p class="meta">匯出 ' + html(info.exportedAt) + ' · 手牌快照 ' + (session.snapshots || []).length +
      ' 筆 · 公開事件 ' + ((session.battleLog && session.battleLog.events) || []).length + ' 筆</p>',
      '<p class="note">' + html(refreshDescription(info)) + '</p>',
      '<p class="note">' + (timeline.coverage.publicLogComplete ? '已見開局與結束，未標出已知公開紀錄缺口。' : '公開紀錄仍有缺口或未見完整起尾，不能稱為整場完整。') +
      ' 每筆手牌皆是觀察，不能保證捕捉了每次變動；最早／最晚不等於真正回合起訖。數量差不代表已確認的抽牌、出牌或棄牌。</p>'];
    if (workspace) parts.push(workspaceHTML(session,workspace));
    timeline.warnings.forEach(function (warning) { parts.push('<p class="note">' + html(warning) + '</p>'); });
    if (timeline.handCaptureIssues.length) {
      parts.push('<section class="turn"><h2>手牌擷取缺口</h2><p>以下缺口獨立於公開 Log 涵蓋狀態；公開 Log 完整也不能補回未存入的手牌觀察。</p>');
      timeline.handCaptureIssues.forEach(function (issue) {
        parts.push('<article class="note"><p>' + html(handCaptureIssueDescription(issue)) +
          '</p><details><summary>缺口原始欄位</summary><pre>' + html(JSON.stringify(issue, null, 2)) + '</pre></details></article>');
      });
      parts.push('</section>');
    }
    function renderEvents(events) {
      if (!events.length) { parts.push('<p class="meta">未取得可對齊的公開事件；不代表沒有行動。</p>'); return; }
      events.forEach(function (event) {
        parts.push('<article class="event" data-event-id="' + html(event.id) + '"><p class="meta">' + html(event.id) +
          ' · ' + html(event.actor || '玩家未標示') + ' · ' + html(event.action) + '</p><pre>' + html(event.rawText) + '</pre>' +
          (event.cards && event.cards.length ? '<p class="meta">' + html(cardList(event.cards)) + '</p>' : '') +
          '<p class="meta">首次擷取 ' + html(event.capturedAt || '未知') + '；不是事件發生時間</p></article>');
      });
    }
    if (timeline.unassignedEvents.length) {
      parts.push('<section class="turn"><h2>開局前／未標回合事件</h2>');
      renderEvents(timeline.unassignedEvents); parts.push('</section>');
    }
    timeline.turns.forEach(function (turn) {
      parts.push('<section class="turn"><h2>' + (turn.turn === null ? '觀察回合 ' + html(turn.observedTurn) + '（未校準）' :
        (turn.turnSource === 'phase-observed' && !turn.events.length ? '推計第 ' : '第 ') + html(turn.turn) + ' 回合') +
        '</h2><p class="meta">行動方：' + html(turn.activePlayer || '未知') + ' · 來源 ' + html(turn.activePlayerSource) +
        ' · ' + turn.snapshotCount + ' 筆手牌觀察</p><h3>全部手牌快照</h3>');
      if (!turn.observations.length) parts.push('<p class="meta">未觀察到手牌，不代表空手。</p>');
      turn.observations.forEach(function (observation) {
        var snapshot = observation.snapshot;
        var known = (snapshot.hand || []).reduce(function (sum, card) { return sum + (Number(card.count) || 0); }, 0);
        parts.push('<article class="snapshot" data-snapshot-id="' + html(snapshot.id || '') + '"><h4>手牌快照 ' + observation.index + '</h4>' +
          '<p class="meta">' + html(snapshot.id || '無 ID') + ' · ' + html(snapshot.timestamp || '時間未知') + '</p>' +
          '<p class="meta">回合 ' + html(snapshot.turn === null || snapshot.turn === undefined ? '未確認' : snapshot.turn) +
          ' · 回合來源 ' + html(snapshot.turnSource || 'unknown') + ' · 觀察回合 ' + html(snapshot.observedTurn) +
          ' · 階段 ' + html(snapshot.phase || '未知') + ' · 來源段落 ' + html(snapshot.sourceSessionId || session.id) + '</p>' +
          '<p class="quality">品質 ' + html(snapshot.quality || 'unavailable') + ' · 已辨識 ' + known +
          ' · 預期 ' + html(snapshot.expectedCount === null || snapshot.expectedCount === undefined ? '未知' : snapshot.expectedCount) +
          ' · 未辨識 ' + html(snapshot.unknownCount === null || snapshot.unknownCount === undefined ? '未知' : snapshot.unknownCount) + '</p><ul class="cards">');
        (snapshot.hand || []).forEach(function (card) { parts.push('<li>' + html(card.cardCode) + ' × ' + html(card.count) + '</li>'); });
        parts.push('</ul>');
        if (!(snapshot.hand || []).length) parts.push('<p>' + (completeHand(snapshot) ? '已觀察到空手。' : '沒有可確認卡號，不能視為空手。') + '</p>');
        parts.push('<p class="meta">' + html(resourceDescription(snapshot.resources)) + '</p><p class="delta">快照差值：' + html(deltaDescription(observation)) + '</p>');
        if (snapshot.reason) parts.push('<p class="meta">辨識原因：' + html(snapshot.reason) + '</p>');
        parts.push('</article>');
      });
      parts.push('<h3>雙方公開事件與原文</h3>'); renderEvents(turn.events); parts.push('</section>');
    });
    var conflicts = ((session.battleLog && session.battleLog.captures) || []).filter(function (capture) { return capture.rows; });
    if (conflicts.length) {
      parts.push('<section class="turn"><h2>未合併擷取原文（先後順序待確認）</h2>');
      conflicts.forEach(function (capture) { parts.push('<details open><summary>' + html(capture.id) + '</summary><pre>' + html(JSON.stringify(capture, null, 2)) + '</pre></details>'); });
      parts.push('</section>');
    }
    parts.push('<details><summary>完整原始資料 JSON（全部快照、Battle Log 與原有欄位）</summary><pre>' + html(JSON.stringify(session, null, 2)) + '</pre></details>',
      '<footer>此報告只保留已觀察與已擷取的內容，不補造未記錄手牌。下方非執行型 JSON 可供工具重新讀取；原始資料位於 msa-record-data，匯出資訊位於 msa-export-info。</footer>',
      '<script id="msa-record-data" type="application/json">' + serializeForHTML(session) + '</script>',
      '<script id="msa-export-info" type="application/json">' + serializeForHTML(info) + '</script>', '</body></html>');
    return parts.join('\n');
  }

  return { ingest: ingest, parseRows: parseRows, buildTimeline: buildTimeline, combineSessions: combineSessions,
    snapshotObservations: snapshotObservations, deltaDescription: deltaDescription, serializeForHTML: serializeForHTML,
    toEventsCSV: toEventsCSV, toCSV: toCSV, toMarkdown: toMarkdown, toHTML: toHTML };
});
