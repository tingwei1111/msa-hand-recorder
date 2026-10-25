'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/recorder-core.js');

function session(overrides = {}) {
  return core.createSession({ id: 'session-1', gameId: 'game-1', playerName: 'Demo Player',
    startedAt: '2026-10-24T01:00:00.000Z', ...overrides });
}

function observation(overrides = {}) {
  return { timestamp: '2026-10-24T01:01:00.000Z', turn: 2, turnSource: 'log', observedTurn: 1,
    activePlayer: 'Demo Player', phase: 'MAIN', hand: [{ cardCode: 'GD05-002', count: 2 }],
    expectedCount: 2, unknownCount: 0, quality: 'complete', reason: '',
    resources: { level: 2, active: 1 }, ...overrides };
}

function freezeDeep(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freezeDeep(child);
  }
  return value;
}

function parseCSV(source) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) {
      row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  return rows.slice(1).map(values => Object.fromEntries(rows[0].map((key, index) => [key, values[index]])));
}

test('exports the same dependency-free API for CommonJS and browser scripts', () => {
  assert.equal(globalThis.MSARecorderCore, core);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../extension/recorder-core.js'), 'utf8'), context);
  assert.equal(typeof context.MSARecorderCore.appendSnapshot, 'function');
  assert.equal(context.MSARecorderCore.normalizeCardCode('GD05-002'), 'GD05-002');
});

test('normalizes every supported code family and parallel image suffixes', () => {
  for (const code of ['GD05-002', 'ST04-010', 'EB01-054', 'SC01-001', 'SLB01-001', 'PR-001', 'P-001', 'EXB-001', 'EXR-001', 'R-001', 'T-021']) {
    assert.equal(core.normalizeCardCode(code.toLowerCase()), code);
    assert.equal(core.normalizeCardCode(`https://example.test/cards/${code}_p1.webp?version=2`), code);
    assert.equal(core.normalizeCardCode(`${code}_parallel_02.png`), code);
    assert.equal(core.normalizeCardCode(`#${code}`), code);
  }
  assert.equal(core.normalizeCardCode('/cards/gd05%2D002-alt2.webp'), 'GD05-002');
});

test('does not identify card backs, unrelated numbers, or partial code matches', () => {
  for (const value of [null, {}, '', 'back.webp', 'cardback.png', '/GD05-002_back.webp',
    '/back/GD05-002.png', 'GD05-002 背面', 'gd05-0023', 'notGD05-002', 'GD05-02', '123-456']) {
    assert.equal(core.normalizeCardCode(value), null, String(value));
  }
});

test('countCards aggregates duplicates after normalization and ignores unknowns', () => {
  assert.deepEqual(core.countCards(['ST04-001', 'GD05-002', 'GD05-002_p1.png', 'back.png', null]), [
    { cardCode: 'GD05-002', count: 2 }, { cardCode: 'ST04-001', count: 1 }
  ]);
  assert.deepEqual(core.countCards(undefined), []);
});

test('createSession has the required versioned metadata and no observations', () => {
  assert.deepEqual(session(), { schemaVersion: 1, recorderVersion: require('../extension/manifest.json').version, id: 'session-1', gameId: 'game-1', playerName: 'Demo Player',
    startedAt: '2026-10-24T01:00:00.000Z', updatedAt: '2026-10-24T01:00:00.000Z', snapshots: [] });
});

test('append is immutable, copies nested input, and assigns stable snapshot IDs', () => {
  const original = freezeDeep(session());
  const input = observation();
  const next = core.appendSnapshot(original, input);
  input.hand[0].count = 99;
  input.resources.active = 99;
  assert.equal(original.snapshots.length, 0);
  assert.notEqual(next, original);
  assert.equal(next.snapshots[0].hand[0].count, 2);
  assert.equal(next.snapshots[0].resources.active, 1);
  assert.equal(next.snapshots[0].id, 'session-1:1');
  assert.equal(next.updatedAt, '2026-10-24T01:01:00.000Z');
  assert.equal(next.snapshots[0].delta, null);
});

test('normalizes duplicate hand rows and deduplicates equivalent observations', () => {
  const first = core.appendSnapshot(session(), observation());
  const duplicate = core.appendSnapshot(freezeDeep(first), observation({ timestamp: '2026-10-24T01:02:00.000Z',
    hand: [{ cardCode: 'GD05-002', count: 1 }, { cardCode: 'GD05-002_p1.png', count: 1 }] }));
  assert.equal(duplicate.snapshots.length, 1);
  assert.notEqual(duplicate, first);
  assert.notEqual(duplicate.snapshots, first.snapshots);
  assert.equal(duplicate.updatedAt, first.updatedAt);
  duplicate.snapshots[0].hand[0].count = 100;
  assert.equal(first.snapshots[0].hand[0].count, 2);
});

test('retains unchanged hand on a new log turn, observed turn, or phase', () => {
  let result = core.appendSnapshot(session(), observation());
  result = core.appendSnapshot(result, observation({ turn: 3 }));
  result = core.appendSnapshot(result, observation({ turn: 3, phase: 'END' }));
  result = core.appendSnapshot(result, observation({ turn: null, turnSource: 'phase-observed', observedTurn: 2 }));
  result = core.appendSnapshot(result, observation({ turn: null, turnSource: 'phase-observed', observedTurn: 3 }));
  assert.equal(result.snapshots.length, 5);
  assert.deepEqual(result.snapshots[1].delta, { added: [], removed: [] });
});

test('retains changes in coverage, resource observations, and availability', () => {
  let result = core.appendSnapshot(session(), observation({ quality: 'partial', expectedCount: 3, unknownCount: 1 }));
  result = core.appendSnapshot(result, observation({ quality: 'partial', expectedCount: 4, unknownCount: 2 }));
  result = core.appendSnapshot(result, observation({ quality: 'partial', expectedCount: 4, unknownCount: 2,
    resources: { level: 2, active: 0 } }));
  result = core.appendSnapshot(result, observation({ quality: 'unavailable', expectedCount: 4, unknownCount: 2,
    reason: 'hand not visible' }));
  assert.equal(result.snapshots.length, 4);
  assert.ok(result.snapshots.every(item => item.delta === null));
});

test('missing expected cards become unknown and prevent a complete reading', () => {
  const result = core.appendSnapshot(session(), observation({ expectedCount: 5, unknownCount: 0 }));
  assert.equal(result.snapshots[0].unknownCount, 3);
  assert.equal(result.snapshots[0].quality, 'partial');
  assert.equal(result.snapshots[0].hand[0].count, 2);
});

test('unrecognized card rows remain counted as unknown instead of disappearing', () => {
  const result = core.appendSnapshot(session(), observation({ expectedCount: 3,
    hand: [{ cardCode: 'GD05-002', count: 1 }, { cardCode: 'back.png', count: 2 }] }));
  assert.deepEqual(result.snapshots[0].hand, [{ cardCode: 'GD05-002', count: 1 }]);
  assert.equal(result.snapshots[0].unknownCount, 2);
  assert.equal(result.snapshots[0].quality, 'partial');
});

test('an inconsistent expected count cannot be labelled complete', () => {
  const result = core.appendSnapshot(session(), observation({ expectedCount: 1 }));
  assert.equal(result.snapshots[0].quality, 'partial');
  assert.equal(result.snapshots[0].expectedCount, 1);
  assert.equal(result.snapshots[0].hand[0].count, 2);
});

test('records exact count differences only across adjacent complete snapshots', () => {
  let result = core.appendSnapshot(session(), observation());
  result = core.appendSnapshot(result, observation({ expectedCount: 3,
    hand: [{ cardCode: 'GD05-002', count: 1 }, { cardCode: 'ST04-001', count: 2 }] }));
  assert.deepEqual(result.snapshots[1].delta, {
    added: [{ cardCode: 'ST04-001', count: 2 }], removed: [{ cardCode: 'GD05-002', count: 1 }]
  });
  result = core.appendSnapshot(result, observation({ hand: [], quality: 'unavailable', expectedCount: null }));
  result = core.appendSnapshot(result, observation({ hand: [], quality: 'complete', expectedCount: 0 }));
  assert.equal(result.snapshots[2].delta, null);
  assert.equal(result.snapshots[3].delta, null);
});

test('partial observations break delta inference even when a later hand is complete', () => {
  let result = core.appendSnapshot(session(), observation());
  result = core.appendSnapshot(result, observation({ quality: 'partial', expectedCount: 3, unknownCount: 1 }));
  result = core.appendSnapshot(result, observation());
  assert.equal(result.snapshots[1].delta, null);
  assert.equal(result.snapshots[2].delta, null);
});

test('known empty hand differs from an unreadable hand of unknown size', () => {
  let result = core.appendSnapshot(session(), observation({ hand: [], expectedCount: 0 }));
  result = core.appendSnapshot(result, observation({ hand: [], expectedCount: null, quality: 'unavailable',
    reason: 'No visible hand container' }));
  const rows = parseCSV(core.toCSV(result));
  assert.equal(result.snapshots.length, 2);
  assert.equal(rows[0].hand_status, 'empty');
  assert.equal(rows[0].card_code, '[EMPTY]');
  assert.equal(rows[0].count, '0');
  assert.equal(rows[1].hand_status, 'unavailable');
  assert.equal(rows[1].card_code, '[UNKNOWN]');
  assert.equal(rows[1].count, '');
  assert.equal(rows[1].expected_count, '');
});

test('known missing-card count is explicit in CSV and never exported as empty', () => {
  const result = core.appendSnapshot(session(), observation({ hand: [], expectedCount: 4,
    unknownCount: 4, quality: 'unavailable' }));
  const rows = parseCSV(core.toCSV(result));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_code, '[UNKNOWN]');
  assert.equal(rows[0].count, '4');
  assert.equal(rows[0].unknown_count, '4');
  assert.notEqual(rows[0].hand_status, 'empty');
});

test('CSV has one row per aggregated card code plus explicit unknown coverage', () => {
  const result = core.appendSnapshot(session(), observation({ expectedCount: 5, unknownCount: 2, quality: 'partial',
    hand: [{ cardCode: 'ST04-001', count: 1 }, { cardCode: 'GD05-002', count: 1 },
      { cardCode: 'GD05-002_p1.png', count: 1 }] }));
  const rows = parseCSV(core.toCSV(result));
  assert.deepEqual(rows.map(row => [row.card_code, row.count]), [
    ['GD05-002', '2'], ['ST04-001', '1'], ['[UNKNOWN]', '2']
  ]);
  assert.ok(rows.every(row => row.snapshot_id === 'session-1:1'));
});

test('CSV escapes commas, quotes, and embedded newlines without splitting a row', () => {
  const result = core.appendSnapshot(session({ playerName: 'Player, "A"\n第二行' }),
    observation({ reason: 'observed, then "checked"\nagain' }));
  const rows = parseCSV(core.toCSV(result));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_name, 'Player, "A"\n第二行');
  assert.equal(rows[0].reason, 'observed, then "checked"\nagain');
});

test('CSV neutralizes formulas in every user-controlled text field', () => {
  const result = core.appendSnapshot(session({ id: '=ID()', gameId: '+GAME()', playerName: '@NAME' }),
    observation({ activePlayer: '-PLAYER', phase: '  =PHASE()', reason: '\t=HYPERLINK("x")' }));
  const row = parseCSV(core.toCSV(result))[0];
  assert.equal(row.session_id, "'=ID()");
  assert.equal(row.game_id, "'+GAME()");
  assert.equal(row.player_name, "'@NAME");
  assert.equal(row.snapshot_id, "'=ID():1");
  assert.equal(row.active_player, "'-PLAYER");
  assert.equal(row.phase, "'  =PHASE()");
  assert.equal(row.reason, "'\t=HYPERLINK(\"x\")");
});

test('summarizeTurns returns first/last observations and keeps unknown turns distinct', () => {
  let result = core.appendSnapshot(session(), observation());
  result = core.appendSnapshot(result, observation({ phase: 'END' }));
  result = core.appendSnapshot(result, observation({ turn: 3, observedTurn: 2 }));
  result = core.appendSnapshot(result, observation({ turn: null, turnSource: 'phase-observed', observedTurn: 3 }));
  result = core.appendSnapshot(result, observation({ turn: null, turnSource: 'phase-observed', observedTurn: 4 }));
  const groups = core.summarizeTurns(freezeDeep(result));
  assert.equal(groups.length, 4);
  assert.equal(groups[0].turn, 2);
  assert.equal(groups[0].snapshotCount, 2);
  assert.equal(groups[0].first.phase, 'MAIN');
  assert.equal(groups[0].last.phase, 'END');
  assert.equal(groups[2].turn, null);
  assert.equal(groups[2].turnSource, 'phase-observed');
  assert.notEqual(groups[2].key, groups[3].key);
  groups[0].first.hand[0].count = 100;
  assert.equal(result.snapshots[0].hand[0].count, 2);
  assert.equal(groups[0].last.hand[0].count, 2);
});

test('rejects invalid session schemas and exports a header for a new session', () => {
  assert.throws(() => core.appendSnapshot({ snapshots: [] }, observation()), /schemaVersion 1/);
  assert.deepEqual(parseCSV(core.toCSV(session())), []);
  assert.deepEqual(core.summarizeTurns(session()), []);
});

test('resource counter records spendable EX separately from ordinary resources', () => {
  const resources = core.parseResources('Lv. 4• 3+1Use EX');
  assert.deepEqual(resources, {level:4,active:3,exActive:1,totalActive:4,
    rawText:'Lv. 4• 3+1Use EX',source:'visible-resource-counter'});
  assert.equal(core.parseResources('Lv. 4 • 0 +1').totalActive, 1);
  assert.equal(core.parseResources('Lv. 8 • 0').exActive, 0);
  assert.equal(core.parseResources('Lv. 4 • 3 +EX'), null);
  assert.equal(core.parseResources('Lv. ? • 3'), null);
});

test('EX changes are snapshots even when the ordinary active number is unchanged', () => {
  let result = core.appendSnapshot(session(), observation({resources:core.parseResources('Lv. 4 • 3+1Use EX')}));
  result = core.appendSnapshot(result, observation({resources:core.parseResources('Lv. 3 • 3')}));
  assert.equal(result.snapshots.length, 2);
  const rows = parseCSV(core.toCSV(result));
  assert.equal(rows[0].resource_ex_active, '1');
  assert.equal(rows[0].resource_total_active, '4');
  assert.equal(rows[1].resource_ex_active, '0');
});

test('legacy resource observations keep EX unknown instead of inventing zero', () => {
  const result = core.appendSnapshot(session(), observation({resources:{level:4,active:3}}));
  const saved = result.snapshots[0].resources;
  assert.deepEqual(saved, {level:4,active:3});
  assert.match(core.resourceText(saved), /EX 可用 未知/);
  assert.equal(parseCSV(core.toCSV(result))[0].resource_ex_active, '');
});
