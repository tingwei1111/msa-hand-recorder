'use strict';

// Synthetic storage/context fixtures only. These checks do not establish live
// match capture coverage or the correctness of MSA's current page layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const panelController = require('../extension/live-panel-controller.js');

const GAME_A = '00000000-0000-4000-8000-000000000201';
const GAME_B = '00000000-0000-4000-8000-000000000202';
const RUN_A = '10000000-0000-4000-8000-000000000201';
const RUN_B = '10000000-0000-4000-8000-000000000202';
const PREFS_KEY = 'msa.livePanel';
const key = (game, run) => `msa.session.${game}.${run}`;
const ownContext = (overrides = {}) => ({
  gameId: GAME_A, runId: RUN_A, playerName: 'Demo North', enabled: true,
  pendingCount: 0, writeError: '', captureNote: '', statusMessage: '', quality: 'complete', ...overrides
});
const record = (game = GAME_A, run = RUN_A, marker = 'saved-a') => ({
  id: `${game}.${run}`, gameId: game, playerName: 'Demo North',
  snapshots: [{id: marker, timestamp: '2026-01-01T00:00:00Z', hand: [{cardCode: 'GD01-001', count: 1}]}]
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const settle = async () => {
  await new Promise(setImmediate);
  await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(setImmediate);
};

function harness(options = {}) {
  let context = ownContext(options.context);
  const values = structuredClone(options.values || {[key(GAME_A, RUN_A)]: record()});
  const views = [], projections = [], reads = [], writes = [], listeners = new Set();
  const captures = [], reviews = [];
  const storage = {
    local: {
      async get(request) {
        reads.push(request);
        if (options.get) return options.get(request, reads.length);
        if (request === null || request === undefined) return structuredClone(values);
        const names = Array.isArray(request) ? request : [request];
        return Object.fromEntries(names.filter(name => Object.hasOwn(values, name)).map(name => [name, structuredClone(values[name])]));
      },
      async set(patch) {
        writes.push(structuredClone(patch));
        if (options.set) await options.set(patch, writes.length);
        const changes = {};
        for (const [name, value] of Object.entries(patch)) {
          changes[name] = {oldValue: values[name], newValue: structuredClone(value)};
          values[name] = structuredClone(value);
        }
        for (const listener of listeners) listener(changes, 'local');
      }
    },
    onChanged: {addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); }}
  };
  const controller = panelController.create({
    storage, debounceMs: 0,
    getContext: () => ({...context}),
    project(stored, current) {
      projections.push({stored: structuredClone(stored), context: structuredClone(current)});
      const session = stored[key(current.gameId, current.runId)];
      return {gameId: current.gameId, runId: current.runId, playerName: current.playerName, sessionId: session?.id || null,
        marker: session?.snapshots?.at(-1)?.id || null, canReview: Boolean(session)};
    },
    createUI(callbacks) {
      const view = {callbacks, models: [], preferences: [], destroyed: false, focused: 0,
        update(model) { this.models.push(structuredClone(model)); },
        setPreferences(prefs) { this.preferences.push(structuredClone(prefs)); },
        getPreferences() { return this.preferences.at(-1) || {expanded: false, left: null, top: null}; },
        focusLauncher() { this.focused += 1; },
        destroy() { this.destroyed = true; }};
      views.push(view);
      return view;
    },
    async onCapture(current) { captures.push(structuredClone(current)); return options.capture ? options.capture(current) : {ok: true, refreshed: true}; },
    async onReview(current) { reviews.push(structuredClone(current)); return options.review ? options.review(current) : {ok: true}; }
  });
  return {controller, values, views, projections, reads, writes, captures, reviews, listeners,
    setContext(next) { context = {...context, ...next}; controller.sync(); },
    changeContextWithoutSync(next) { context = {...context, ...next}; },
    change(changes, area = 'local') { for (const listener of listeners) listener(changes, area); },
    current: () => views.filter(view => !view.destroyed).at(-1),
    async ready() { controller.sync(); await settle(); },
    stop() { controller.destroy(); }};
}

test('live panel does not mount or read sessions outside valid game/run contexts', async () => {
  const h = harness({context: {gameId: null}});
  await h.ready();
  assert.equal(h.views.length, 0);
  assert.equal(h.reads.length, 0);
  h.setContext({gameId: '-'.repeat(36)});
  await settle();
  assert.equal(h.views.length, 0);
  h.setContext({gameId: GAME_A, runId: 'not-a-run'});
  await settle();
  assert.equal(h.views.length, 0);
  h.stop();
});

test('projection only receives current-game sessions and panel preferences', async () => {
  const h = harness({values: {
    [key(GAME_A, RUN_A)]: record(), [key(GAME_B, RUN_B)]: record(GAME_B, RUN_B, 'foreign-hand'),
    [PREFS_KEY]: {expanded: true, left: 20, top: 30},
    'msa.settings': {playerName: 'Demo Other'}, 'msa.status.9': {gameId: GAME_B, playerName: 'Demo Other'}
  }});
  await h.ready();
  assert.ok(h.projections.length);
  for (const projection of h.projections) {
    assert.equal(projection.stored[key(GAME_B, RUN_B)], undefined);
    assert.equal(projection.stored['msa.settings'], undefined);
    assert.equal(projection.stored['msa.status.9'], undefined);
  }
  assert.equal(h.current().models.at(-1).marker, 'saved-a');
  h.stop();
});

test('late old-game storage read cannot replace the new game view', async () => {
  const oldRead = deferred(), newRead = deferred();
  const h = harness({get: (_, index) => index === 1 ? oldRead.promise : newRead.promise});
  h.controller.sync(); await settle();
  const oldView = h.current();
  h.setContext({gameId: GAME_B, runId: RUN_B});
  assert.equal(oldView?.destroyed, true);
  await settle();
  newRead.resolve({[key(GAME_B, RUN_B)]: record(GAME_B, RUN_B, 'saved-b')});
  await settle();
  oldRead.resolve({[key(GAME_A, RUN_A)]: record()});
  await settle();
  assert.equal(h.current().models.at(-1).marker, 'saved-b');
  assert.equal(h.current().models.at(-1).gameId, GAME_B);
  h.stop();
});

test('same-game run change immediately clears the previous run hand', async () => {
  const h = harness(); await h.ready();
  const previous = h.current();
  h.setContext({runId: RUN_B});
  assert.equal(previous.destroyed, true);
  await settle();
  assert.equal(h.current().models.at(-1).runId, RUN_B);
  assert.equal(h.current().models.at(-1).marker, null);
  h.stop();
});

test('storage changes during an initial read take precedence over that stale read', async () => {
  const initial = deferred();
  const h = harness({get: () => initial.promise});
  h.controller.sync(); await settle();
  h.change({[key(GAME_A, RUN_A)]: {newValue: record(GAME_A, RUN_A, 'newer-write')}});
  initial.resolve({[key(GAME_A, RUN_A)]: record(GAME_A, RUN_A, 'stale-read')});
  await settle();
  assert.equal(h.current().models.at(-1).marker, 'newer-write');
  h.stop();
});

test('storage deletion during a read is retained instead of resurrecting a record', async () => {
  const initial = deferred();
  const h = harness({get: () => initial.promise});
  h.controller.sync(); await settle();
  h.change({[key(GAME_A, RUN_A)]: {oldValue: record()}});
  initial.resolve({[key(GAME_A, RUN_A)]: record()});
  await settle();
  assert.equal(h.current().models.at(-1).marker, null);
  h.stop();
});

test('refresh requests deduplicate within a context and old results cannot update a new one', async () => {
  const first = deferred(), second = deferred();
  const h = harness({capture: ctx => ctx.gameId === GAME_A ? first.promise : second.promise});
  await h.ready();
  const oldView = h.current();
  const pending = oldView.callbacks.onRefresh();
  const duplicate = oldView.callbacks.onRefresh();
  await settle();
  assert.equal(h.captures.length, 1);
  h.setContext({gameId: GAME_B, runId: RUN_B}); await settle();
  const next = h.current().callbacks.onRefresh(); await settle();
  assert.equal(h.captures.length, 2, 'a pending old-game refresh must not block the new game');
  second.resolve({ok: true, refreshed: true, reason: 'new-game-result'});
  await next;
  first.resolve({ok: true, refreshed: true, reason: 'old-game-result'});
  await Promise.allSettled([pending, duplicate]); await settle();
  assert.ok(h.current().models.every(model => !String(model.refreshMessage || '').includes('old-game-result')));
  assert.equal(h.current().models.at(-1).gameId, GAME_B);
  h.stop();
});

test('callbacks from a destroyed view cannot capture or open another game', async () => {
  const h = harness(); await h.ready();
  const oldView = h.current();
  h.setContext({gameId: GAME_B, runId: RUN_B}); await settle();
  await oldView.callbacks.onRefresh();
  await oldView.callbacks.onReview();
  assert.equal(h.captures.length, 0);
  assert.equal(h.reviews.length, 0);
  h.stop();
});

test('panel preferences use an independent storage key and never change capture identity', async () => {
  const h = harness(); await h.ready();
  const previous = h.current();
  await previous.callbacks.onPreferencesChange({expanded: true, left: 25, top: 35});
  await settle();
  assert.ok(h.writes.length);
  assert.ok(h.writes.every(patch => Object.keys(patch).every(name => name === PREFS_KEY)));
  assert.equal(h.current(), previous);
  assert.equal(h.current().models.at(-1).runId, RUN_A);
  h.stop();
});

test('destroy invalidates pending reads and unregisters storage observation', async () => {
  const initial = deferred();
  const h = harness({get: () => initial.promise});
  h.controller.sync(); await settle();
  const renderedBeforeDestroy = h.projections.length;
  h.stop();
  initial.resolve({[key(GAME_A, RUN_A)]: record()}); await settle();
  assert.equal(h.current(), undefined);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.projections.length, renderedBeforeDestroy);
});

test('navigation revokes actions even before the next scheduled sync', async () => {
  const h = harness(); await h.ready();
  const oldView = h.current();
  h.changeContextWithoutSync({gameId: GAME_B, runId: RUN_B});
  await oldView.callbacks.onRefresh();
  await oldView.callbacks.onReview();
  assert.equal(h.captures.length, 0);
  assert.equal(h.reviews.length, 0);
  h.stop();
});

test('review opens only an existing current-run record, not an older same-game segment', async () => {
  const h = harness(); await h.ready();
  await h.current().callbacks.onReview();
  assert.equal(h.reviews.length, 1);
  assert.equal(h.reviews[0].sessionId, `${GAME_A}.${RUN_A}`);
  h.setContext({runId: RUN_B}); await settle();
  const result = await h.current().callbacks.onReview();
  assert.equal(result.ok, false);
  assert.equal(h.reviews.length, 1);
  h.stop();
});

test('preference writes are serialized and latest UI intent wins', async () => {
  const first = deferred();
  const h = harness({set: (_, index) => index === 1 ? first.promise : Promise.resolve()});
  await h.ready();
  const view = h.current();
  view.callbacks.onPreferencesChange({expanded: true, left: 10, top: 20});
  await settle();
  view.callbacks.onPreferencesChange({expanded: false, left: 30, top: 40});
  await settle();
  assert.equal(h.writes.length, 1, 'second write waits for earlier acknowledgement');
  first.resolve(); await settle();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.values[PREFS_KEY], {expanded: false, left: 30, top: 40});
  assert.deepEqual(view.preferences.at(-1), {expanded: false, left: 30, top: 40});
  h.stop();
});

test('show preserves capture context and never writes recorder settings', async () => {
  const h = harness(); await h.ready();
  const view = h.current();
  const result = h.controller.show(); await settle();
  assert.equal(result.ok, true);
  assert.equal(result.gameId, GAME_A);
  assert.equal(h.current(), view);
  assert.equal(view.models.at(-1).runId, RUN_A);
  assert.equal(view.focused, 1);
  assert.equal(h.values[PREFS_KEY].expanded, true);
  assert.ok(h.writes.every(patch => !Object.hasOwn(patch, 'msa.settings')));
  h.stop();
});

test('storage read failure is visible and a later sync can recover', async () => {
  const h = harness({get: (_, index) => index === 1 ? Promise.reject(new Error('synthetic storage failure')) : {[key(GAME_A, RUN_A)]: record()}});
  await h.ready();
  assert.equal(h.current().models.at(-1).statusTone, 'error');
  assert.equal(h.current().models.at(-1).canReview, false);
  h.controller.sync(); await settle();
  assert.equal(h.current().models.at(-1).marker, 'saved-a');
  assert.equal(h.current().models.at(-1).canReview, true);
  h.stop();
});

test('player identity changing during refresh rejects the stale result', async () => {
  const pending = deferred();
  const h = harness({capture: () => pending.promise}); await h.ready();
  const operation = h.current().callbacks.onRefresh(); await settle();
  h.changeContextWithoutSync({playerName: 'Demo South'});
  pending.resolve({ok: true, refreshed: true, reason: 'result-for-old-player'});
  const result = await operation;
  assert.equal(result.ok, false);
  assert.equal(result.refreshed, false);
  assert.ok(h.current().models.every(model => !String(model.refreshMessage || '').includes('result-for-old-player')));
  h.stop();
});

test('a rejected preference write is visible without clearing saved match data', async () => {
  const h = harness({set: () => Promise.reject(new Error('synthetic preference write failure'))});
  await h.ready();
  h.current().callbacks.onPreferencesChange({expanded: true, left: 25, top: 35});
  await settle();
  assert.match(h.current().models.at(-1).preferenceError, /synthetic preference write failure/);
  assert.equal(h.current().models.at(-1).marker, 'saved-a');
  h.stop();
});
