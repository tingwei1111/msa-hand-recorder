(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSARecorderCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var QUALITIES = ['complete', 'partial', 'unavailable'];
  var TURN_SOURCES = ['log', 'phase-observed', 'unknown'];
  var VERSION = '0.6.0';

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
      return result;
    }
    return value;
  }

  function integer(value, minimum) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
  }

  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function timestamp(value) {
    if (typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))) return value;
    return new Date().toISOString();
  }

  // Accept card labels, image URLs, and parallel-art filenames. A back image
  // is never evidence of a card, even if its filename contains a card code.
  function normalizeCardCode(value) {
    if (typeof value !== 'string') return null;
    var source = value.trim();
    try { source = decodeURIComponent(source); } catch (_) { /* Keep malformed URLs readable. */ }
    if (/(?:^|[^a-z])(?:back|backside|cardback|card-back)(?:[^a-z]|$)|裏面|背面|牌背/i.test(source)) return null;
    var match = source.toUpperCase().match(/(?:^|[^A-Z0-9])((?:GD|ST|EB|SC|SLB)\d{2,3}|EXB|EXR|PR|P|R|T)[-_](\d{3})(?=$|[^A-Z0-9])/);
    return match ? match[1] + '-' + match[2] : null;
  }

  function sortedCounts(counts) {
    return Array.from(counts.keys()).sort().map(function (cardCode) {
      return { cardCode: cardCode, count: counts.get(cardCode) };
    });
  }

  function countCards(codes) {
    var counts = new Map();
    (Array.isArray(codes) ? codes : []).forEach(function (value) {
      var cardCode = normalizeCardCode(value);
      if (cardCode) counts.set(cardCode, (counts.get(cardCode) || 0) + 1);
    });
    return sortedCounts(counts);
  }

  function createSession(options) {
    options = options || {};
    var startedAt = timestamp(options.startedAt);
    return {
      schemaVersion: 1,
      recorderVersion: VERSION,
      id: text(options.id) || 'msa-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
      gameId: text(options.gameId),
      playerName: text(options.playerName),
      startedAt: startedAt,
      updatedAt: startedAt,
      snapshots: []
    };
  }

  function parseResources(value) {
    var rawText = text(value).replace(/\s+/g, ' ').trim();
    var match = rawText.match(/^Lv\.\s*(\d+)\s*[•·]\s*(\d+)\s*(?:\+\s*(\d+))?(?:\s*Use\s+EX)?$/i);
    if (!match) return null;
    var active = Number(match[2]);
    var exActive = match[3] ? Number(match[3]) : 0;
    return {level:Number(match[1]), active:active, exActive:exActive,
      totalActive:active + exActive, rawText:rawText, source:'visible-resource-counter'};
  }

  function resourceText(resources) {
    if (!resources) return '資源未辨識';
    var show = function(value) { return integer(value, 0) === null ? '未知' : String(value); };
    return '等級 ' + show(resources.level) + ' · 一般可用 ' + show(resources.active) +
      ' · EX 可用 ' + show(resources.exActive) + ' · 合計 ' + show(resources.totalActive);
  }

  function normalizeSnapshot(input, id) {
    input = input || {};
    var counts = new Map();
    var unrecognizedCount = 0;
    (Array.isArray(input.hand) ? input.hand : []).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var count = integer(entry.count, 1);
      if (count === null) return;
      var cardCode = normalizeCardCode(entry.cardCode);
      if (cardCode) counts.set(cardCode, (counts.get(cardCode) || 0) + count);
      else unrecognizedCount += count;
    });
    var hand = sortedCounts(counts);
    var knownCount = hand.reduce(function (sum, entry) { return sum + entry.count; }, 0);
    var expectedCount = integer(input.expectedCount, 0);
    var unknownCount = (integer(input.unknownCount, 0) || 0) + unrecognizedCount;
    if (expectedCount !== null) unknownCount = Math.max(unknownCount, expectedCount - knownCount);
    var quality = QUALITIES.indexOf(input.quality) >= 0 ? input.quality : 'unavailable';
    var inconsistent = expectedCount !== null && knownCount + unknownCount !== expectedCount;
    if (quality === 'complete' && (unknownCount > 0 || inconsistent)) quality = 'partial';
    var resources = input.resources && typeof input.resources === 'object' ? {
      level: integer(input.resources.level, 0),
      active: integer(input.resources.active, 0)
    } : null;
    // Old snapshots never recorded EX. Missing fields stay unknown, not zero.
    if (resources && Object.prototype.hasOwnProperty.call(input.resources, 'exActive')) {
      resources.exActive = integer(input.resources.exActive, 0);
      resources.totalActive = resources.active !== null && resources.exActive !== null ? resources.active + resources.exActive : null;
      resources.rawText = text(input.resources.rawText).slice(0, 160);
      resources.source = text(input.resources.source).slice(0, 60);
    }
    return {
      id: id,
      timestamp: timestamp(input.timestamp),
      turn: integer(input.turn, 1),
      turnSource: TURN_SOURCES.indexOf(input.turnSource) >= 0 ? input.turnSource : 'unknown',
      observedTurn: integer(input.observedTurn, 1) || 1,
      activePlayer: text(input.activePlayer),
      phase: text(input.phase),
      hand: hand,
      expectedCount: expectedCount,
      unknownCount: unknownCount,
      quality: quality,
      reason: text(input.reason),
      resources: resources,
      delta: null
    };
  }

  function observationKey(snapshot) {
    // An incomplete observation with a different missing-card count, or an
    // observed turn change without a log number, must not disappear as a duplicate.
    return JSON.stringify([
      snapshot.hand, snapshot.turn, snapshot.turnSource, snapshot.observedTurn,
      snapshot.activePlayer, snapshot.phase, snapshot.quality,
      snapshot.expectedCount, snapshot.unknownCount, snapshot.resources, snapshot.reason
    ]);
  }

  function handDelta(previous, current) {
    var before = new Map(previous.hand.map(function (entry) { return [entry.cardCode, entry.count]; }));
    var after = new Map(current.hand.map(function (entry) { return [entry.cardCode, entry.count]; }));
    var codes = Array.from(new Set(Array.from(before.keys()).concat(Array.from(after.keys())))).sort();
    var result = { added: [], removed: [] };
    codes.forEach(function (cardCode) {
      var difference = (after.get(cardCode) || 0) - (before.get(cardCode) || 0);
      if (difference > 0) result.added.push({ cardCode: cardCode, count: difference });
      if (difference < 0) result.removed.push({ cardCode: cardCode, count: -difference });
    });
    return result;
  }

  function appendSnapshot(session, input) {
    if (!session || session.schemaVersion !== 1 || !Array.isArray(session.snapshots)) {
      throw new TypeError('A schemaVersion 1 recorder session is required.');
    }
    var next = clone(session);
    var snapshot = normalizeSnapshot(input, text(session.id) + ':' + (session.snapshots.length + 1));
    var previous = next.snapshots[next.snapshots.length - 1];
    if (previous && observationKey(previous) === observationKey(snapshot)) return next;
    // A gap or partial reading breaks the chain. These are observed count
    // differences, not claims that a card was drawn, played, or discarded.
    if (previous && previous.quality === 'complete' && snapshot.quality === 'complete') {
      snapshot.delta = handDelta(previous, snapshot);
    }
    next.snapshots.push(snapshot);
    next.updatedAt = snapshot.timestamp;
    return next;
  }

  function csvCell(value) {
    var output = text(value);
    // Quoting alone does not prevent Excel/Sheets from evaluating formulas.
    if (/^[\t\r\n]|^[\s\u0000-\u0020]*[=+@-]/.test(output)) output = "'" + output;
    return '"' + output.replace(/"/g, '""') + '"';
  }

  function toCSV(session) {
    var headers = ['session_id', 'game_id', 'player_name', 'snapshot_id', 'timestamp', 'turn',
      'turn_source', 'observed_turn', 'active_player', 'phase', 'quality', 'expected_count',
      'unknown_count', 'hand_status', 'card_code', 'count', 'resource_level', 'resource_active', 'reason',
      'resource_ex_active', 'resource_total_active', 'resource_raw_text'];
    var rows = [headers];
    (session.snapshots || []).forEach(function (snapshot) {
      var empty = snapshot.quality === 'complete' && snapshot.hand.length === 0 && snapshot.unknownCount === 0;
      var status = empty ? 'empty' : snapshot.quality;
      var cards = snapshot.hand.map(function (entry) { return { cardCode: entry.cardCode, count: entry.count }; });
      if (snapshot.unknownCount > 0 || snapshot.quality !== 'complete') {
        cards.push({ cardCode: '[UNKNOWN]', count: snapshot.unknownCount > 0 ? snapshot.unknownCount : '' });
      }
      if (empty) cards.push({ cardCode: '[EMPTY]', count: 0 });
      cards.forEach(function (entry) {
        rows.push([session.id, session.gameId, session.playerName, snapshot.id, snapshot.timestamp,
          snapshot.turn, snapshot.turnSource, snapshot.observedTurn, snapshot.activePlayer,
          snapshot.phase, snapshot.quality, snapshot.expectedCount, snapshot.unknownCount,
          status, entry.cardCode, entry.count, snapshot.resources && snapshot.resources.level,
          snapshot.resources && snapshot.resources.active, snapshot.reason,
          snapshot.resources && snapshot.resources.exActive, snapshot.resources && snapshot.resources.totalActive,
          snapshot.resources && snapshot.resources.rawText]);
      });
    });
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function summarizeTurns(session) {
    var groups = new Map();
    (session.snapshots || []).forEach(function (snapshot) {
      var key = snapshot.turn !== null ? 'turn:' + snapshot.turn :
        snapshot.turnSource + ':' + snapshot.observedTurn + ':' + snapshot.activePlayer;
      var group = groups.get(key);
      if (!group) {
        group = {
          key: key,
          turn: snapshot.turn,
          turnSource: snapshot.turnSource,
          observedTurn: snapshot.observedTurn,
          activePlayer: snapshot.activePlayer,
          first: clone(snapshot),
          last: clone(snapshot),
          snapshotCount: 0
        };
        groups.set(key, group);
      }
      group.last = clone(snapshot);
      group.snapshotCount += 1;
    });
    return Array.from(groups.values());
  }

  return {
    VERSION: VERSION,
    normalizeCardCode: normalizeCardCode,
    parseResources: parseResources,
    resourceText: resourceText,
    countCards: countCards,
    createSession: createSession,
    appendSnapshot: appendSnapshot,
    toCSV: toCSV,
    summarizeTurns: summarizeTurns
  };
});
