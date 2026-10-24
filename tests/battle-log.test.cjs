'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const synthetic = require('./fixtures/synthetic-match.js');

const when = '2026-10-24T02:00:00.000Z';
const card = (cardCode, name = '') => ({ cardCode, name });
const row = (text, actor = '', cards = [], sourceIndex = null) => ({ text, actor, cards, sourceIndex });
const indexed = rows => rows.map((item, sourceIndex) => ({ ...item, sourceIndex }));
const start = () => core.createSession({ id: 's1', gameId: 'g1', playerName: 'Alice', startedAt: when });
const batch = (rows, overrides = {}) => ({ observedAt: when, completeFromStart: true, order: 'oldest-first',
  players: ['Alice', 'Bob'], rows: indexed(rows), ...overrides });
function frozen(value) {
  Object.freeze(value);
  Object.values(value).forEach(child => { if (child && typeof child === 'object' && !Object.isFrozen(child)) frozen(child); });
  return value;
}
function hand(session, overrides = {}) {
  return core.appendSnapshot(session, { timestamp: when, turn: 1, turnSource: 'log', observedTurn: 1,
    activePlayer: 'Alice', phase: 'MAIN', hand: [{ cardCode: 'GD05-002', count: 1 }],
    expectedCount: 1, unknownCount: 0, quality: 'complete', reason: '', resources: null, ...overrides });
}

test('browser and CommonJS exports work without dependencies', () => {
  assert.equal(globalThis.MSABattleLogCore, battle);
  const context = vm.createContext({});
  for (const file of ['recorder-core.js', 'battle-log-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'), context);
  }
  assert.equal(typeof context.MSABattleLogCore.ingest, 'function');
  assert.equal(context.MSABattleLogCore.parseRows([row('Passed')])[0].action, 'pass');
});

test('ingest preserves repeated identical events rather than deduplicating by text', () => {
  const result = battle.ingest(start(), batch([row('Game started!'), row('Turn 1 started!'),
    row('Played command: Overflowing Affection', 'Alice', [card('GD01-118')]),
    row('Played command: Overflowing Affection', 'Alice', [card('GD01-118')])]));
  assert.equal(result.battleLog.events.length, 4);
  assert.equal(result.battleLog.events.filter(event => event.action === 'play-command').length, 2);
  assert.equal(new Set(result.battleLog.events.map(event => event.id)).size, 4);
});

test('same full capture compresses capture metadata and preserves stable IDs', () => {
  const input = batch([row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')]);
  const first = battle.ingest(start(), input);
  const second = battle.ingest(frozen(first), { ...input, observedAt: '2026-10-24T02:01:00.000Z' });
  assert.notEqual(first, second);
  assert.equal(second.battleLog.events.length, 3);
  assert.equal(second.battleLog.captures.length, 1);
  assert.equal(second.battleLog.captures[0].repeatCount, 2);
  assert.equal(second.battleLog.captures[0].lastObservedAt, '2026-10-24T02:01:00.000Z');
  assert.deepEqual(second.battleLog.events.map(event => event.id), first.battleLog.events.map(event => event.id));
  assert.equal(second.battleLog.events[0].capturedAt, when);
});

test('a longer append-prefix capture adds only new occurrences and stays immutable', () => {
  const input = frozen(batch([row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')]));
  const first = frozen(battle.ingest(frozen(start()), input));
  const second = battle.ingest(first, batch([...input.rows, row('Passed', 'Alice')]));
  assert.equal(first.battleLog.events.length, 3);
  assert.equal(second.battleLog.events.length, 4);
  assert.equal(second.battleLog.captures[1].addedEventCount, 1);
  second.battleLog.events[0].cards.push(card('GD05-002'));
  assert.deepEqual(first.battleLog.events[0].cards, []);
});

test('stale shorter prefixes do not delete newer events', () => {
  const rows = [row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')];
  const result = battle.ingest(battle.ingest(start(), batch(rows)), batch(rows.slice(0, 2)));
  assert.equal(result.battleLog.events.length, 3);
  assert.equal(result.battleLog.captures[1].mergeStatus, 'stale-prefix');
});

test('prefix corrections keep original chronology and retain conflicting raw capture', () => {
  const first = battle.ingest(start(), batch([row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')]));
  const result = battle.ingest(first, batch([row('Game started!'), row('Turn 1 started!'), row('Winner!', 'Bob')]));
  assert.equal(result.battleLog.events[2].rawText, 'Passed');
  assert.equal(result.battleLog.captures[1].rows[2].text, 'Winner!');
  assert.equal(result.battleLog.coverage.unmergedCaptureCount, 1);
  assert.equal(result.battleLog.coverage.hasGaps, true);
  assert.ok(result.battleLog.warnings.length);
});

test('full later history can prepend missing events without changing existing IDs', () => {
  const rows = indexed([row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice'), row('Turn ended!', 'Alice')]);
  const partial = battle.ingest(start(), batch(rows.slice(1, 3), { completeFromStart: false, rows: rows.slice(1, 3) }));
  const originalId = partial.battleLog.events[0].id;
  const result = battle.ingest(partial, batch(rows));
  assert.equal(result.battleLog.events.length, 4);
  assert.equal(result.battleLog.events[1].id, originalId);
  assert.equal(result.battleLog.events[2].turn, 1);
  assert.equal(result.battleLog.coverage.completeFromStart, true);
});

test('complete history rebases partial-window indices without inventing a gap', () => {
  const partialRows = [row('Turn 2 started!'), row('Silver Bullet deployed', 'Bob', [card('GD04-068')])];
  const first = battle.ingest(start(), batch(partialRows, { completeFromStart: false }));
  const originalId = first.battleLog.events[0].id;
  const fullRows = [row('Game started!'), row('Turn 1 started!'), row('Turn ended!', 'Alice'),
    ...partialRows, row('Passed', 'Alice'), row('Game ended!')];
  const result = battle.ingest(first, batch(fullRows, { observedAt: '2026-10-24T02:05:00.000Z' }));
  assert.deepEqual(result.battleLog.events.map(event => event.sourceIndex), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(result.battleLog.events[3].id, originalId);
  assert.equal(result.battleLog.events[3].capturedAt, when);
  assert.equal(result.battleLog.events[5].turn, 2);
  assert.equal(result.battleLog.events[6].turn, 2);
  assert.equal(result.battleLog.coverage.publicLogComplete, true);
});

test('partial overlap retains duplicate tail events and source indices', () => {
  const initial = indexed([row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')]);
  let result = battle.ingest(start(), batch(initial));
  result = battle.ingest(result, batch([], { completeFromStart: false,
    rows: [row('Passed', 'Alice', [], 2), row('Passed', 'Alice', [], 3)] }));
  assert.equal(result.battleLog.events.length, 4);
  result = battle.ingest(result, batch([], { completeFromStart: false, rows: [row('Passed', 'Alice', [], 4)] }));
  assert.equal(result.battleLog.events.length, 5);
  assert.deepEqual(result.battleLog.events.slice(2).map(event => event.sourceIndex), [2, 3, 4]);
});

test('newest-first captures normalize chronological order without reversing source provenance', () => {
  const rows = [row('Turn ended!', 'Alice', [], 0), row('Turn 1 started!', '', [], 1), row('Game started!', '', [], 2)];
  const result = battle.ingest(start(), batch(rows, { rows, order: 'newest-first' }));
  assert.deepEqual(result.battleLog.events.map(event => event.action), ['game-start', 'turn-start', 'turn-end']);
  assert.deepEqual(result.battleLog.events.map(event => event.sourceIndex), [2, 1, 0]);
});

test('unrelated partial windows are preserved but not invented into the timeline', () => {
  const first = battle.ingest(start(), batch([row('Game started!'), row('Turn 1 started!')]));
  const result = battle.ingest(first, batch([row('Turn 20 started!'), row('Unknown future action')], { completeFromStart: false }));
  assert.equal(result.battleLog.events.length, 2);
  assert.equal(result.battleLog.captures[1].mergeStatus, 'unmerged');
  assert.equal(result.battleLog.captures[1].rows.length, 2);
});

test('actors come only from each row; system messages do not inherit the previous actor', () => {
  const events = battle.parseRows([row('Turn 4 started!'), row('Passed', 'Alice'), row('Action step')]);
  assert.equal(events[2].actor, '');
  assert.equal(events[2].turn, 4);
  assert.equal(events[0].capturedAt, null);
  assert.equal(Object.hasOwn(events[0], 'timestamp'), false);
});

test('source index gaps clear turn attribution until another explicit turn marker', () => {
  const initial = [row('Turn 1 started!', '', [], 0), row('Passed', 'Alice', [], 1)];
  const added = [row('Passed', 'Alice', [], 1), row('Silver Bullet deployed', 'Bob', [card('GD04-068')], 8),
    row('Turn 4 started!', '', [], 9), row('Passed', 'Alice', [], 10)];
  let result = battle.ingest(start(), batch([], { rows: initial, completeFromStart: false }));
  result = battle.ingest(result, batch([], { rows: added, completeFromStart: false }));
  assert.equal(result.battleLog.events.find(event => event.action === 'deploy-unit').turn, null);
  assert.equal(result.battleLog.events.at(-1).turn, 4);
  assert.equal(result.battleLog.coverage.hasGaps, true);
  const parsed = battle.parseRows(initial.concat(added.slice(1)));
  assert.equal(parsed[2].turn, null);
  assert.equal(parsed[3].turn, 4);
});

test('pilot attachment exposes only the pilot as primary played card', () => {
  const events = battle.parseRows([row('Linked pilot: Kira Yamato on unit Aile Strike Gundam', 'Alice',
    [card('ST04-010', 'Kira Yamato'), card('ST04-001', 'Aile Strike Gundam')])]);
  assert.equal(events[0].action, 'link-pilot');
  assert.equal(events[0].isPlay, true);
  assert.equal(events[0].primaryCard.cardCode, 'ST04-010');
  assert.equal(events[0].cards.length, 2);
  assert.equal(events[0].sourceZone, 'unknown');
});

test('generated tokens and card returns are not recorded as hand plays', () => {
  const events = battle.parseRows([row('Parts deployed', 'Alice', [card('T-021', 'Parts')]),
    row('Silver Bullet returned to hand', 'Bob', [card('GD04-068', 'Silver Bullet')])]);
  assert.equal(events[0].action, 'deploy-token');
  assert.equal(events[0].sourceZone, 'generated');
  assert.equal(events[0].isPlay, false);
  assert.equal(events[1].isPlay, false);
  assert.equal(events[1].action, 'return-hand');
});

test('base deployment does not claim a hand source, and replacement selects the new base', () => {
  const events = battle.parseRows([row('Played base: Reineforce Jr.', 'Alice', [card('GD04-121')]),
    row('Replaced Reineforce Jr. base: Argama', 'Alice', [card('GD04-121'), card('GD02-129')])]);
  assert.equal(events[0].sourceZone, 'unknown');
  assert.equal(events[1].primaryCard.cardCode, 'GD02-129');
});

test('unknown formats and card names remain raw without guessed card identities', () => {
  const raw = '  A future event\nwith text <img src=x>  ';
  const event = battle.parseRows([row(raw, 'Player', [card('not-a-card', 'Mysterious Unit')])])[0];
  assert.equal(event.rawText, raw);
  assert.equal(event.action, 'unknown');
  assert.deepEqual(event.cards, [card(null, 'Mysterious Unit')]);
});

test('coverage requires observed opening, every turn from 1, and an ending', () => {
  const full = battle.ingest(start(), batch([row('Game started!'), row('Turn 1 started!'), row('Game ended!')]));
  assert.equal(full.battleLog.coverage.publicLogComplete, true);
  for (const rows of [[row('Game started!'), row('Turn 10 started!'), row('Game ended!')],
    [row('Game started!'), row('Game ended!')], [row('Game started!'), row('Turn 1 started!'), row('Turn 3 started!'), row('Game ended!')]]) {
    assert.equal(battle.ingest(start(), batch(rows)).battleLog.coverage.publicLogComplete, false);
  }
  const indexedGap = battle.ingest(start(), batch([], { rows: [row('Game started!', '', [], 0),
    row('Turn 1 started!', '', [], 2), row('Game ended!', '', [], 3)] }));
  assert.equal(indexedGap.battleLog.coverage.hasGaps, true);
  const falselyFull = battle.ingest(start(), batch([row('Turn 1 started!'), row('Game ended!')]));
  assert.equal(falselyFull.battleLog.coverage.completeFromStart, false);
});

test('timeline combines observed hands with public events without inventing plays', () => {
  let result = hand(start());
  result = hand(result, { hand: [], expectedCount: 0, phase: 'END' });
  result = battle.ingest(result, batch([row('Game started!'), row('Choose to play first', 'Alice'),
    row('Turn 1 started!'), row('Turn ended!', 'Alice')]));
  const turn = battle.buildTimeline(frozen(result)).turns[0];
  assert.equal(turn.snapshotCount, 2);
  assert.equal(turn.first.hand[0].cardCode, 'GD05-002');
  assert.deepEqual(turn.last.hand, []);
  assert.equal(turn.plays.length, 0);
  assert.equal(turn.activePlayer, 'Alice');
  assert.equal(turn.handFlags.openingConfirmed, false);
  assert.equal(turn.handFlags.endConfirmed, false);
  assert.equal(turn.handFlags.observedOnly, true);
  turn.first.hand[0].count = 100;
  assert.equal(result.snapshots[0].hand[0].count, 1);
});

test('estimated and unknown hand turns keep alignment uncertainty', () => {
  let result = hand(start(), { turnSource: 'phase-observed' });
  result = hand(result, { turn: null, turnSource: 'unknown', observedTurn: 2 });
  const timeline = battle.buildTimeline(result);
  assert.equal(timeline.turns[0].handFlags.turnAlignment, 'estimated');
  assert.equal(timeline.turns[1].turn, null);
  assert.equal(timeline.unassignedSnapshots.length, 1);
});

test('empty hand and unreadable hand stay distinct in combined CSV and Markdown', () => {
  let result = hand(start(), { hand: [], expectedCount: 0 });
  result = hand(result, { hand: [], expectedCount: null, quality: 'unavailable' });
  const csv = battle.toCSV(result);
  const md = battle.toMarkdown(result);
  assert.match(csv, /\[EMPTY\]/);
  assert.match(csv, /\[UNKNOWN\]/);
  assert.match(md, /已觀察到空手/);
  assert.match(md, /未知張數，並非確認空手/);
  assert.match(md, /不保證是真正回合開始／結束手牌/);
});

test('exports escape CSV formulas and Markdown/HTML-injection characters', () => {
  const input = start();
  input.playerName = '<script>alert(1)</script>|[link](javascript:bad)';
  input.gameId = '=GAME()';
  const result = battle.ingest(input, batch([row('Game started!'), row('Turn 1 started!'),
    row('=HYPERLINK("x")', '+attacker', [card(null, '<img src=x onerror=alert(1)>|bad')])]));
  const csv = battle.toEventsCSV(result);
  const md = battle.toMarkdown(result);
  assert.match(csv, /"'=GAME\(\)"/);
  assert.match(csv, /"'\+attacker"/);
  assert.match(csv, /"'=HYPERLINK/);
  assert.doesNotMatch(md, /<script>|<img/);
  assert.match(md, /&lt;script&gt;/);
  assert.ok(md.includes('\\|'));
  assert.ok(md.includes('\\[link\\]\\(javascript:bad\\)'));
});

test('capture fingerprints stay compact as the public log grows', () => {
  let result = start();
  const rows = [row('Game started!'), row('Turn 1 started!')];
  for (let index = 0; index < 25; index += 1) {
    rows.push(row('Passed', index % 2 ? 'Alice' : 'Bob'));
    result = battle.ingest(result, batch(rows));
  }
  assert.ok(result.battleLog.captures.every(capture => capture.fingerprint.length < 30));
  assert.equal(result.battleLog.captures.reduce((sum, capture) => sum + capture.eventIds.length, 0), rows.length);
});

test('synthetic 537-row fixture parses all 24 turns and keeps repeated actions', () => {
  const fixture = synthetic.createBatch(537);
  const result = battle.ingest({ ...start(), playerName: 'Demo South' }, fixture);
  const events = result.battleLog.events;
  const timeline = battle.buildTimeline(result);
  assert.equal(events.length, 537);
  assert.equal(timeline.turns.length, 24);
  assert.equal(events.filter(event => event.action === 'pass').length, 102);
  assert.equal(events.filter(event => event.action === 'unknown').length, 0);
  assert.equal(events.filter(event => event.turn === 20 && event.action === 'play-command').length, 2);
  assert.equal(events.filter(event => event.action === 'deploy-token').length, 5);
  assert.equal(result.battleLog.coverage.publicLogComplete, true);
  assert.equal(timeline.turns[23].activePlayer, 'Demo South');
  assert.equal(timeline.turns[23].first, null);
  assert.equal(timeline.turns[23].plays.filter(event => event.action === 'link-pilot')[0].primaryCard.cardCode, 'ST04-010');
});

test('combineSessions joins same-game hand and log segments with source provenance', () => {
  const first = hand(start(), { turn: null, turnSource: 'unknown' });
  let second = core.createSession({ id: 's2', gameId: 'g1', playerName: 'Alice', startedAt: '2026-10-24T03:00:00.000Z' });
  second = hand(second, { turn: null, turnSource: 'unknown', timestamp: '2026-10-24T03:01:00.000Z' });
  second.snapshots[0].delta = { added: [{ cardCode: 'ST04-001', count: 1 }], removed: [] };
  let logOnly = core.createSession({ id: 's3', gameId: 'g1', playerName: '', startedAt: '2026-10-24T04:00:00.000Z' });
  logOnly = battle.ingest(logOnly, batch([row('Game started!'), row('Turn 1 started!'), row('Game ended!')]));
  const result = battle.combineSessions(frozen([second, first, logOnly]));
  assert.equal(result.playerName, 'Alice');
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.snapshots.length, 2);
  assert.deepEqual(result.snapshots.map(snapshot => snapshot.sourceSessionId), ['s1', 's2']);
  assert.equal(result.snapshots[1].delta, null);
  assert.equal(result.battleLog.events.length, 3);
  const unknown = battle.buildTimeline(result).turns.filter(turn => turn.turn === null);
  assert.equal(unknown.length, 2);
  assert.notEqual(unknown[0].key, unknown[1].key);
  assert.equal(second.snapshots[0].delta.added[0].cardCode, 'ST04-001');
  assert.match(battle.toCSV(result), /source_session_id/);
  assert.match(battle.toCSV(result), /"s1","true","false","true"/);
  assert.match(battle.toEventsCSV(result), /coverage_has_gaps/);
});

test('combineSessions merges append-prefix logs without duplicating actions or replacing capture times', () => {
  const rows = [row('Game started!'), row('Turn 1 started!'), row('Passed', 'Alice')];
  const first = battle.ingest(start(), batch(rows));
  let second = core.createSession({ id: 's2', gameId: 'g1', playerName: 'Alice', startedAt: '2026-10-24T03:00:00.000Z' });
  second = battle.ingest(second, batch([...rows, row('Game ended!')], { observedAt: '2026-10-24T03:01:00.000Z' }));
  const result = battle.combineSessions([first, second]);
  assert.equal(result.battleLog.events.length, 4);
  assert.equal(result.battleLog.events[0].capturedAt, when);
  assert.equal(result.battleLog.events[3].capturedAt, '2026-10-24T03:01:00.000Z');
  assert.equal(result.battleLog.coverage.publicLogComplete, true);
});

test('combineSessions rejects different games, different players, and unidentified hand sources', () => {
  assert.throws(() => battle.combineSessions([]), /At least one/);
  assert.throws(() => battle.combineSessions([start(), { ...start(), gameId: 'g2' }]), /different game/);
  assert.throws(() => battle.combineSessions([start(), { ...start(), playerName: 'Bob' }]), /different player/);
  assert.throws(() => battle.combineSessions([{ ...hand(start()), playerName: '' }]), /identified player/);
});

test('timeline and exports retain every intermediate snapshot and label observational deltas', () => {
  let result = hand(start(), { hand: [{cardCode:'GD05-002',count:2}], expectedCount:2 });
  result = hand(result, { phase:'ACTION', hand:[{cardCode:'GD05-002',count:1},{cardCode:'ST04-001',count:1}], expectedCount:2,
    timestamp:'2026-10-24T02:01:00.000Z', reason:'unique intermediate observation' });
  result = hand(result, { phase:'END', hand:[], expectedCount:0, timestamp:'2026-10-24T02:02:00.000Z' });
  const group = battle.buildTimeline(frozen(result)).turns[0];
  assert.equal(group.snapshots.length,3);
  assert.equal(group.observations.length,3);
  assert.deepEqual(group.observations[1].delta,{added:[{cardCode:'ST04-001',count:1}],removed:[{cardCode:'GD05-002',count:1}]});
  assert.match(battle.deltaDescription(group.observations[1]),/進出原因未知/);
  assert.match(battle.toMarkdown(result),/unique intermediate observation/);
  assert.equal((battle.toHTML(result).match(/data-snapshot-id=/g)||[]).length,3);
  assert.equal((battle.toMarkdown(result).match(/#### 手牌快照 /g)||[]).length,3);
});

test('HTML embeds the exact original record including arbitrary legacy fields safely', () => {
  const result=hand(start());
  result.customField={message:'</script><script>alert(1)</script><img src=x onerror="bad">&\u2028\u2029'};
  const info={exportedAt:when,refresh:{ok:false,refreshed:false,reason:'</script><script>bad</script>'}};
  const output=battle.toHTML(frozen(result),{exportInfo:frozen(info)});
  const encoded=output.match(/<script id="msa-record-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  const metadata=output.match(/<script id="msa-export-info" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(encoded),result);
  assert.deepEqual(JSON.parse(metadata),info);
  assert.doesNotMatch(encoded,/[<>&\u2028\u2029]/);
  assert.equal((output.match(/<script\b/g)||[]).length,2);
  assert.match(output,/未能確認刷新/);
});

test('combined records retain complete source objects and never bridge observation gaps', () => {
  let first=hand(start());
  first.customField={legacy:true};
  first=hand(first,{quality:'partial',unknownCount:1,expectedCount:2});
  first=hand(first,{phase:'END'});
  const second=hand({...start(),id:'s2',startedAt:'2026-10-24T03:00:00.000Z'});
  const result=battle.combineSessions(frozen([first,second]));
  assert.deepEqual(result.sourceRecords,[first,second]);
  const observations=battle.snapshotObservations(result);
  assert.equal(observations[2].delta,null);
  assert.equal(observations[2].deltaStatus,'incomplete-observation');
  assert.equal(observations[3].delta,null);
  assert.equal(observations[3].deltaStatus,'segment-boundary');
});

test('estimated-only turn headings and EX resource uncertainty survive readable exports', () => {
  const result=hand(start(),{turn:10,turnSource:'phase-observed',resources:{level:6,active:5}});
  assert.match(battle.toHTML(result),/推計第 10 回合/);
  assert.match(battle.toMarkdown(result),/推計第 10 回合/);
  assert.match(battle.toHTML(result),/EX 可用 未知/);
  assert.match(battle.toCSV(result),/resource_ex_active/);
});

test('hand capture issues remain visible independently of complete public coverage', () => {
  const result = battle.ingest(hand(start()), batch([row('Game started!'), row('Turn 1 started!'), row('Game ended!')]));
  result.captureIssues = [{code:'context-changed-pending',observedAt:when,pendingCount:3,
    reason:'切局時仍有三筆未存',futureField:{value:'</script><img src=x onerror="bad">'}}];
  const before = JSON.stringify(result);
  const timeline = battle.buildTimeline(frozen(result));
  assert.equal(timeline.coverage.publicLogComplete,true);
  assert.equal(timeline.handCaptureIssues.length,1);
  assert.equal(timeline.handCaptureIssues[0].sourceSessionId,'s1');
  assert.match(timeline.warnings.join('\n'),/手牌擷取缺口.*切局時仍有三筆未存/);
  assert.match(battle.toMarkdown(result),/## 手牌擷取缺口/);
  assert.match(battle.toMarkdown(result),/futureField/);
  assert.doesNotMatch(battle.toMarkdown(result),/<img/);
  const output = battle.toHTML(result);
  assert.match(output,/<h2>手牌擷取缺口<\/h2>/);
  assert.doesNotMatch(output,/<img/);
  const embedded = output.match(/<script id="msa-record-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(embedded),result);
  assert.equal(JSON.stringify(result),before);
});

test('combined capture issue audit copies are deduplicated while repeated original issues survive', () => {
  const first = hand(start());
  const issue = {code:'buffer-full',observedAt:when,pendingCount:1,reason:'緩衝區滿載',unknown:['kept']};
  first.captureIssues = [issue,{...issue}];
  const second = {...start(),id:'s2',startedAt:'2026-10-24T03:00:00.000Z',captureIssues:[{...issue}]};
  const combined = battle.combineSessions(frozen([first,second]));
  assert.deepEqual(combined.sourceRecords,[first,second]);
  assert.equal(combined.captureIssues.length,3);
  assert.deepEqual(combined.captureIssues.map(item=>[item.sourceSessionId,item.sourceIssueIndex]),[['s1',0],['s1',1],['s2',0]]);
  assert.equal(battle.buildTimeline(combined).handCaptureIssues.length,3);
  const sourceOnly = {...combined};
  delete sourceOnly.captureIssues;
  assert.equal(battle.buildTimeline(sourceOnly).handCaptureIssues.length,3);
  assert.equal(battle.buildTimeline(battle.combineSessions([combined])).handCaptureIssues.length,3);
  assert.deepEqual(battle.buildTimeline(start()).handCaptureIssues,[]);
});
