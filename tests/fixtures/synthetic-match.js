(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSASyntheticFixtures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Constructed from scratch for parser/export tests. No captured match is an
  // input. Event sequences and card labels are fictional, not legal-game claims.
  const players = Object.freeze(['Demo North', 'Demo South']);
  const gameId = '00000000-0000-4000-8000-000000000101';
  const capturedAt = '2000-01-01T00:30:00.000Z';
  const card = (cardCode, name) => ({cardCode, name});
  const unit = card('GD05-002', 'Sample Unit Alpha');
  const target = card('GD04-068', 'Sample Unit Beta');
  const pilot = card('ST04-010', 'Sample Pilot');
  const command = card('GD01-100', 'Sample Test Order');
  const token = card('T-001', 'Sample Token');
  const row = (text, actor = '', cards = []) => ({text, actor, cards:cards.map(item => ({...item}))});

  function createBatch(size = 537) {
    if (size !== 350 && size !== 537) throw new RangeError('Supported synthetic sizes: 350 and 537');
    const turnCount = size === 350 ? 17 : 24;
    const turns = [];
    for (let turn = 1; turn <= turnCount; turn += 1) {
      const actor = players[(turn-1)%2];
      const rows = [row(`Turn ${turn} started!`), row('Draw a card', actor), row(`${unit.name} deployed`, actor, [unit])];
      // Adjacent identical actions intentionally exercise duplicate preservation.
      const passCount = size === 537 ? 4 + Number(turn <= 6) : 2;
      for (let n = 0; n < passCount; n += 1) rows.push(row('Passed', actor));
      if (turn % 2 === 0 && turn <= (size === 537 ? 10 : 6)) rows.push(row(`${token.name} deployed`, actor, [token]));
      if (turn === (size === 537 ? 20 : 8)) {
        rows.push(row(`Played command: ${command.name}`, actor, [command]));
        rows.push(row(`Played command: ${command.name}`, actor, [command]));
      }
      if (size === 350 && turn === 7) {
        rows.push(row('Played command: Uncatalogued Test Order', actor));
        rows.push(row('Synthetic future event: parser extension example', actor));
      }
      if (turn === turnCount) rows.push(row(`Linked pilot: ${pilot.name} to ${target.name}`, actor, [pilot,target]));
      turns.push({actor, rows});
    }
    const startRows = [row('Game started!'), row('Choose to play first', players[0])];
    // Repeated recognized actions scale the fixtures to the regression sizes;
    // generated filler never changes the exact pass/token/command assertions.
    const fillActions = ['Action step', 'Battle initiated', 'Assigned no blocker', 'Battle ended',
      'No blockers available', 'Activated: Sample Unit Alpha', 'Rested unit: Sample Unit Beta',
      'Sample Unit Alpha received 1 damage, leaving 2 HP remaining', 'Draw 2 cards'];
    const initialCount = startRows.length + turns.reduce((sum, turn) => sum + turn.rows.length + 1, 0) + 1;
    for (let index = 0; index < size-initialCount; index += 1) {
      const group = turns[index%turnCount];
      group.rows.push(row(fillActions[index%fillActions.length], group.actor));
    }
    const rows = startRows.concat(turns.flatMap(group => group.rows.concat(row('Turn ended!', group.actor))), row('Game ended!'))
      .map((item, sourceIndex) => ({...item, sourceIndex}));
    if (rows.length !== size) throw new Error('Synthetic fixture row count drifted');
    return {observedAt:capturedAt, rows, players:[...players], order:'oldest-first',
      completeFromStart:true, ended:true, structure:'msa-drawer-v1', synthetic:true};
  }
  return Object.freeze({players, gameId, capturedAt, createBatch});
});
