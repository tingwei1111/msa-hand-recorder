'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');

// Both event and hand histories are built from fictional test templates.
const synthetic = require('./fixtures/synthetic-match.js');
const gameId = synthetic.gameId;
const start = '2000-01-01T00:00:00.000Z';
const syntheticLog = battle.ingest(core.createSession({id:'synthetic-log', gameId, startedAt:start}), synthetic.createBatch(350)).battleLog;

function fixture() {
  let session = core.createSession({id: 'export-regression', gameId,
    playerName: 'Demo North', startedAt: start});
  for (let index = 0; index < 135; index += 1) {
    const observedTurn = Math.floor(index / 8) + 1;
    const partial = index === 44;
    const unavailable = index === 45;
    const hand = unavailable ? [] : [{cardCode: 'GD04-003', count: 1 + index % 4}];
    // This card exists only in the middle of its turn. First/last-only reports
    // cannot reproduce it and must fail the complete-observation regression.
    if (index === 67) hand.push({cardCode: 'ST03-007', count: 1});
    session = core.appendSnapshot(session, {
      timestamp: new Date(Date.parse(start) + index * 1000).toISOString(),
      turn: index < 64 ? null : observedTurn,
      turnSource: index < 64 ? 'unknown' : index === 64 ? 'log' : 'phase-observed',
      observedTurn, activePlayer: observedTurn % 2 ? 'Demo North' : 'Demo South',
      phase: index % 8 === 7 ? 'END' : 'MAIN', hand,
      expectedCount: unavailable ? null : hand.reduce((sum, card) => sum + card.count, 0) + Number(partial),
      unknownCount: Number(partial), quality: unavailable ? 'unavailable' : partial ? 'partial' : 'complete',
      reason: 'observation-' + String(index + 1).padStart(3, '0'),
      resources: {level: observedTurn, active: index % 3,
        exActive: index < 64 ? 1 : 0, totalActive: index % 3 + Number(index < 64),
        rawText: `Lv. ${observedTurn} • ${index % 3}${index < 64 ? '+1Use EX' : ''}`}
    });
  }
  session.battleLog = structuredClone(syntheticLog);
  // Export is a preservation operation, not a schema migration. Unknown future
  // fields and the original stored delta must survive a standalone report.
  session.futureAudit = {source: 'synthetic 135 hands + synthetic 350 public events', retained: true};
  session.snapshots[67].futureSnapshotField = {keep: 'middle-observation'};
  return session;
}

function jsonBlock(html, id) {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const found = blocks.find(([, attributes]) =>
    new RegExp(`\\bid=["']${id}["']`).test(attributes));
  assert.ok(found, `Missing embedded JSON block ${id}`);
  assert.match(found[1], /\btype=["']application\/json["']/i);
  return JSON.parse(found[2]);
}

function visibleHTML(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
}

function dataAttributeValues(html, name) {
  return [...visibleHTML(html).matchAll(new RegExp(`\\b${name}=["']([^"']*)["']`, 'g'))]
    .map(match => match[1]);
}

function batch(rows, completeFromStart = true) {
  return {observedAt: '2000-01-01T05:30:00.000Z', order: 'oldest-first', completeFromStart,
    players: ['Demo North', 'Demo South'], rows: rows.map((row, sourceIndex) => ({sourceIndex, cards: [], actor: '', ...row}))};
}

test('synthetic fixture has 350 events across T1–T17 with complete markers', () => {
  assert.equal(syntheticLog.events.length, 350);
  assert.equal(syntheticLog.events[0].rawText, 'Game started!');
  assert.equal(syntheticLog.events.at(-1).rawText, 'Game ended!');
  assert.equal(syntheticLog.coverage.publicLogComplete, true);
  assert.equal(syntheticLog.coverage.lastTurn, 17);
});

test('standalone HTML preserves all 135 hand observations and all 350 public events', () => {
  const session = fixture();
  assert.equal(session.snapshots.length, 135);
  const before = JSON.stringify(session);
  const exportInfo = {requestedGameId: gameId, flush: {ok: true, eventCount: 350}, capturedAt: start, exportedAt: start};
  const html = battle.toHTML(session, {exportInfo});
  assert.deepEqual(jsonBlock(html, 'msa-record-data'), session);
  assert.deepEqual(jsonBlock(html, 'msa-export-info'), exportInfo);
  const snapshotIds = dataAttributeValues(html, 'data-snapshot-id');
  const eventIds = dataAttributeValues(html, 'data-event-id');
  assert.equal(snapshotIds.length, 135, 'Each stored hand observation needs a visible report entry');
  assert.deepEqual(new Set(snapshotIds), new Set(session.snapshots.map(item => item.id)));
  assert.equal(eventIds.length, 350, 'Each public event needs a visible report entry');
  assert.deepEqual(new Set(eventIds), new Set(session.battleLog.events.map(item => item.id)));
  assert.match(visibleHTML(html), /ST03-007/, 'The transient middle-of-turn hand must be readable without parsing JSON');
  assert.equal(JSON.stringify(session), before, 'Export must not rewrite stored source data');
});

test('timeline retains every observation once while unknown turns stay separate', () => {
  const session = fixture();
  const timeline = battle.buildTimeline(session);
  const observations = timeline.turns.flatMap(turn => turn.observations);
  assert.equal(observations.length, 135);
  assert.equal(timeline.turns.reduce((sum, turn) => sum + turn.snapshots.length, 0), 135);
  assert.deepEqual(new Set(observations.map(item => item.snapshot.id)), new Set(session.snapshots.map(item => item.id)));
  const unknown = timeline.turns.filter(turn => turn.turn === null);
  assert.equal(unknown.reduce((sum, turn) => sum + turn.snapshots.length, 0), 64);
  assert.ok(unknown.every(turn => turn.events.length === 0), 'A late complete Log must not silently assign early hands to absolute turns');
  const afterGap = observations.find(item => item.snapshot.reason === 'observation-047');
  assert.equal(afterGap.delta, null, 'An unreadable prior observation cannot become a draw/discard comparison');
  const first = observations.find(item => item.snapshot.id === session.snapshots[0].id);
  assert.equal(first.delta, null);
});

test('Markdown also includes every stored observation, including transient hands', () => {
  const session = fixture();
  const markdown = battle.toMarkdown(session).replace(/\\([\\`*_{}\[\]()#+.!|~-])/g, '$1');
  for (const snapshot of session.snapshots) assert.ok(markdown.includes(snapshot.reason), `Missing ${snapshot.reason}`);
  assert.match(markdown, /ST03-007/);
  for (const event of session.battleLog.events) assert.ok(markdown.includes(event.id), `Missing event ${event.id}`);
});

test('embedded JSON and visible HTML do not turn hostile stored strings into markup', () => {
  const payload = '</script><img src=x onerror="globalThis.PWNED=1"><svg onload=alert(1)>&\u2028\u2029';
  assert.equal(JSON.parse(battle.serializeForHTML({payload})).payload, payload);
  assert.doesNotMatch(battle.serializeForHTML({payload}), /[<>&\u2028\u2029]/);
  const session = fixture();
  session.playerName = payload;
  session.id = payload;
  session.snapshots[67].id = payload;
  session.snapshots[67].phase = payload;
  session.snapshots[67].reason = payload;
  session.battleLog.events[70].id = payload;
  session.battleLog.events[70].rawText = payload;
  session.battleLog.events[70].actor = payload;
  session.battleLog.events[70].cards.push({cardCode: null, name: payload});
  const html = battle.toHTML(session, {exportInfo: {warning: payload}});
  assert.deepEqual(jsonBlock(html, 'msa-record-data'), session);
  assert.equal(jsonBlock(html, 'msa-export-info').warning, payload);
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.equal(scripts.length, 2, 'Only the two inert JSON data blocks are permitted');
  assert.ok(scripts.every(([, attributes]) => /type=["']application\/json["']/i.test(attributes)));
  assert.doesNotMatch(visibleHTML(html), /<(?:img|svg|iframe|object)\b/i);
  const tagsWithoutQuotedValues = [...visibleHTML(html).matchAll(/<[^>]+>/g)]
    .map(([tag]) => tag.replace(/"[^"]*"|'[^']*'/g, '""')).join('\n');
  assert.doesNotMatch(tagsWithoutQuotedValues, /\bon(?:error|load|focus|mouseover)\s*=/i);
});

test('old schema-1 hand-only sessions retain unknown resources and partial readings', () => {
  const session = core.createSession({id: 'legacy', gameId, playerName: 'Demo North', startedAt: start});
  session.snapshots = [{id: 'legacy:1', timestamp: start, turn: null, observedTurn: 1,
    turnSource: 'unknown', activePlayer: '', phase: '', hand: [], expectedCount: null,
    unknownCount: 0, quality: 'unavailable', reason: 'legacy hand hidden',
    resources: {level: 3, active: 0}, delta: null}];
  const html = battle.toHTML(session);
  const restored = jsonBlock(html, 'msa-record-data');
  assert.deepEqual(restored, session);
  assert.equal(Object.hasOwn(restored.snapshots[0].resources, 'exActive'), false);
  assert.equal(Object.hasOwn(restored, 'battleLog'), false);
  assert.equal(dataAttributeValues(html, 'data-snapshot-id').length, 1);
  assert.equal(dataAttributeValues(html, 'data-event-id').length, 0);
  assert.match(visibleHTML(html), /未知|無法辨識|未辨識/);
});

test('a hand-only estimated turn is explicitly labelled as estimated in exported reports', () => {
  const session = fixture();
  delete session.battleLog;
  session.snapshots = [{...session.snapshots[80], turn: 10, turnSource: 'phase-observed'}];
  const html = battle.toHTML(session);
  assert.match(visibleHTML(html), /推計第\s*10\s*回合/);
  assert.match(battle.toMarkdown(session), /推計第\s*10\s*回合/);
});

test('unmerged captures survive export but are not asserted as chronological events', () => {
  let session = core.createSession({id: 'conflict', gameId, playerName: 'Demo North', startedAt: start});
  session = battle.ingest(session, batch([{text: 'Game started!'}, {text: 'Turn 1 started!'}, {text: 'Passed', actor: 'Demo North'}]));
  session = battle.ingest(session, batch([{text: 'Turn 20 started!'}, {text: 'UNCERTAIN_CAPTURE_ROW'}], false));
  const html = battle.toHTML(session);
  const restored = jsonBlock(html, 'msa-record-data');
  assert.deepEqual(restored, session);
  assert.equal(restored.battleLog.events.length, 3);
  assert.ok(restored.battleLog.captures.some(capture => capture.rows?.some(row => row.text === 'UNCERTAIN_CAPTURE_ROW')));
  assert.equal(dataAttributeValues(html, 'data-event-id').length, 3);
  assert.match(visibleHTML(html), /UNCERTAIN_CAPTURE_ROW/, 'Raw unmerged evidence must remain available to the reviewer');
  assert.equal(battle.buildTimeline(session).turns.some(turn => turn.turn === 20), false);
});

test('combining same-game segments retains source records without joining unrelated hand deltas', () => {
  const first = fixture();
  const second = core.createSession({id: 'later-run', gameId, playerName: first.playerName,
    startedAt: '2000-01-01T06:00:00.000Z'});
  second.snapshots = [{...structuredClone(first.snapshots[0]), id: 'later-run:1',
    delta: {added: [{cardCode: 'ST03-007', count: 99}], removed: []}}];
  const combined = battle.combineSessions([first, second]);
  const html = battle.toHTML(combined);
  const restored = jsonBlock(html, 'msa-record-data');
  assert.equal(restored.snapshots.length, 136);
  assert.equal(dataAttributeValues(html, 'data-snapshot-id').length, 136);
  assert.ok(restored.sourceRecords, 'Combined export must preserve original segment data');
  assert.ok(JSON.stringify(restored.sourceRecords).includes('middle-observation'));
  const observations = battle.buildTimeline(combined).turns.flatMap(turn => turn.observations);
  const newRunFirst = observations.find(item => item.snapshot.sourceSessionId === 'later-run');
  assert.equal(newRunFirst.delta, null);
  const groups = battle.buildTimeline(combined).turns.filter(turn => turn.turn === null && turn.observedTurn === 1);
  assert.equal(groups.length, 2, 'Identical observed-turn numbers from separate runs are independent');
  assert.throws(() => battle.combineSessions([first, {...second, gameId: 'different-game'}]), /different game/);
  assert.throws(() => battle.combineSessions([first, {...second, playerName: 'different-player'}]), /different player/);
});

test('persisted hand-capture gaps remain visible after a later complete public-log capture and combining', () => {
  const first = fixture();
  first.captureIssues = [{code: 'navigation-pending', observedAt: start, pendingCount: 2,
    reason: 'NAVIGATION_CAPTURE_GAP: two hand observations were not confirmed saved'}];
  const second = core.createSession({id: 'after-navigation', gameId, playerName: first.playerName,
    startedAt: '2000-01-01T06:00:00.000Z'});
  second.battleLog = structuredClone(syntheticLog);
  for (const session of [first, battle.combineSessions([first, second])]) {
    const timeline = battle.buildTimeline(session);
    assert.equal(timeline.coverage.publicLogComplete, true, 'A hand capture gap is independent of public-log coverage');
    assert.match(timeline.warnings.join('\n'), /NAVIGATION_CAPTURE_GAP/, 'A permanent capture issue must be surfaced beyond raw JSON');
    const html = battle.toHTML(session);
    assert.deepEqual(jsonBlock(html, 'msa-record-data'), session);
    const visibleWarnings = [...visibleHTML(html).matchAll(/<p class="note">([\s\S]*?)<\/p>/g)].map(match => match[1]).join('\n');
    assert.match(visibleWarnings, /NAVIGATION_CAPTURE_GAP/);
    assert.match(battle.toMarkdown(session).replace(/\\([\\`*_{}\[\]()#+.!|~-])/g, '$1'), /NAVIGATION_CAPTURE_GAP/);
  }
});
