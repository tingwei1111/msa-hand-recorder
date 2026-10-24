'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const synthetic = require('./fixtures/synthetic-match.js');
const battle = require('../extension/battle-log-core.js');

test('browser demo and Node tests receive identical independently generated fixtures', () => {
  const browser = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-match.js'), 'utf8'), browser);
  for (const size of [350, 537]) {
    const first = synthetic.createBatch(size);
    assert.deepEqual(JSON.parse(JSON.stringify(browser.MSASyntheticFixtures.createBatch(size))), first);
    first.rows[0].text = 'mutation';
    first.players.push('mutation');
    assert.equal(synthetic.createBatch(size).rows[0].text, 'Game started!');
    assert.deepEqual(synthetic.createBatch(size).players, ['Demo North', 'Demo South']);
  }
});

test('350-row export fixture includes duplicate plays, unknown card identity and a future format', () => {
  const batch = synthetic.createBatch(350);
  const events = battle.parseRows(batch.rows);
  assert.equal(events.length, 350);
  assert.deepEqual(events.filter(event => event.action === 'turn-start').map(event => event.turn),
    Array.from({length:17}, (_, index) => index+1));
  assert.equal(events.filter(event => event.turn === 8 && event.action === 'play-command').length, 2);
  const unknownCard = events.find(event => event.rawText === 'Played command: Uncatalogued Test Order');
  assert.equal(unknownCard.action, 'play-command');
  assert.equal(unknownCard.primaryCard, null);
  assert.equal(events.filter(event => event.action === 'unknown').length, 1);
  assert.ok(events.every(event => !event.actor || synthetic.players.includes(event.actor)));
  assert.ok(events.flatMap(event => event.cards).every(card => card.name.startsWith('Sample ')));
});
