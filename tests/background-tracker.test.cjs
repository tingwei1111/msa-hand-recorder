'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const library = require('../extension/library-core.js');
const libraryStore = require('../extension/library-store.js');
const GAME = '00000000-0000-4000-8000-000000000801';
const OTHER_GAME = '00000000-0000-4000-8000-000000000802';
const RUN = '10000000-0000-4000-8000-000000000801';
const ID = GAME + '.' + RUN, SOURCE_KEY = 'msa.session.' + ID;
const WHEN = '2000-01-01T00:00:00.000Z', EXT = 'synthetic-extension';
const sender = {frameId:0,tab:{id:7},documentId:'synthetic-tracker-document',url:'https://mobilesuitarena.com/game/' + GAME};
const copy = value => structuredClone(value);
const deckText = Array.from({length:13},(_,index) => `${index === 12 ? 2 : 4}xGD99-${String(index + 1).padStart(3,'0')}`).join('\n');
const deck = (name = 'Synthetic tracker deck') => library.createDeckVersion({deckId:'synthetic-tracker-deck',name,mainText:deckText,resourcesText:'10xR-001',tokensText:'2xT-001'},{createdAt:WHEN});
function source() {
  const record = core.appendSnapshot(core.createSession({id:ID,gameId:GAME,playerName:'Demo North',startedAt:WHEN}),{
    timestamp:WHEN,turn:1,turnSource:'log',observedTurn:1,activePlayer:'Demo North',phase:'MAIN',
    hand:[{cardCode:'GD99-001',count:2}],expectedCount:2,unknownCount:0,quality:'complete'
  });
  record.captureSource = {tabId:sender.tab.id,documentId:sender.documentId};
  return record;
}
function message(record, override = {}) {
  return {type:'MSA_BIND_LIVE_DECK',gameId:GAME,runId:RUN,playerName:'Demo North',deckVersionId:record.id,confirmed:true,...override};
}
function harness(options = {}) {
  const db = copy(options.initial || {}), writes = [], reads = [];
  let listener, realmJSON;
  const storage = {async get(keys) {
    reads.push(copy(keys)); await options.beforeGet?.(keys,db);
    const names = keys === null ? Object.keys(db) : Array.isArray(keys) ? keys : [keys];
    const result = Object.fromEntries(names.filter(key => Object.hasOwn(db,key)).map(key => [key,copy(db[key])]));
    return realmJSON.parse(JSON.stringify(result));
  }, async set(patch) {
    await options.beforeSet?.(patch,db); writes.push(copy(patch)); Object.assign(db,copy(patch));
  }};
  const chrome = {runtime:{id:EXT,getURL:file => `chrome-extension://${EXT}/${file}`,onMessage:{addListener(fn){listener = fn;}}},storage:{local:storage}};
  const realm = vm.createContext({chrome,MSARecorderCore:core,MSABattleLogCore:battle,crypto:require('node:crypto').webcrypto,
    TextEncoder,URL,Map,Promise,Date,setTimeout,clearTimeout,importScripts(){}});
  realmJSON = vm.runInContext('JSON',realm);
  // Load the actual browser modules in the worker realm: Chrome serializes
  // messages/storage, so prototype guards must see objects from that realm.
  for (const file of ['library-core.js','library-store.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'),realm);
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),realm);
  const send = (payload,from = sender) => new Promise((resolve,reject) => {
    let responded = false;
    try {
      const pending = listener(realmJSON.parse(JSON.stringify(payload)),from,value => {responded = true;resolve(copy(value));});
      if (!pending && !responded) resolve({ignored:true});
    } catch(error) { reject(error); }
  });
  return {db,writes,reads,send};
}
async function setup(options = {}) {
  const version = await deck(), current = source();
  const h = harness({...options,initial:{[SOURCE_KEY]:current,['msa.deck.' + version.id]:version,...options.initial}});
  return {...h,version,current};
}
async function prior(version,overrides = {}) {
  return {...await library.createMatchRecord({sourceSessionId:ID,gameId:GAME,playerName:'Demo North',identityConfirmed:true,
    deckVersionId:version.id,firstPlayer:'second',result:'unknown',resultConfirmed:false},version,{updatedAt:WHEN}),...overrides};
}

test('live deck binding freezes the selected valid version with an unconfirmed result', async () => {
  const h = await setup(), reply = await h.send(message(h.version));
  assert.equal(reply.ok,true); assert.equal(reply.record.source,'manual'); assert.equal(reply.record.identityConfirmed,true);
  assert.equal(reply.record.sourceSessionId,ID); assert.equal(reply.record.playerName,'Demo North');
  assert.equal(reply.record.deckVersionId,h.version.id); assert.deepEqual(reply.record.frozenDeckVersion,h.version);
  assert.equal(reply.record.result,'unknown'); assert.equal(reply.record.resultConfirmed,false); assert.equal(reply.record.firstPlayer,'unknown');
  assert.deepEqual(h.db[SOURCE_KEY],h.current); assert.deepEqual(h.db['msa.deck.' + h.version.id],h.version);
  assert.equal(h.writes.length,1); assert.ok(Object.keys(h.writes[0])[0].startsWith('msa.match.'));
});

test('only the actual MSA game mainframe may use the live binding route', async () => {
  const h = await setup();
  for (const from of [
    {id:EXT,url:`chrome-extension://${EXT}/library.html`},
    {...sender,frameId:1}, {...sender,url:'https://other.test/game/' + GAME},
    {...sender,url:'https://mobilesuitarena.com/profile/' + GAME},
    {...sender,url:'https://mobilesuitarena.com/game/' + OTHER_GAME},
    {...sender,url:'https://mobilesuitarena.com/game/' + GAME + '/extra'}
  ]) assert.equal((await h.send(message(h.version),from)).ok,false);
  assert.equal(h.writes.length,0);
});

test('binding requires explicit confirmation and bounded exact identifiers', async () => {
  const h = await setup();
  for (const override of [{confirmed:false},{confirmed:'true'},{runId:'not-a-run'},{gameId:'not-a-game'},
    {playerName:''},{playerName:'   '},{playerName:'Demo North '},{playerName:'x'.repeat(201)},
    {deckVersionId:''},{deckVersionId:'x'.repeat(257)},{deckVersionId:{id:h.version.id}}]) {
    assert.equal((await h.send(message(h.version,override))).ok,false);
  }
  assert.equal(h.writes.length,0);
});

test('stored source must match the run, player, document and tab and contain a saved hand', async () => {
  const version = await deck();
  for (const mutate of [record => {record.id = 'another-source';},record => {record.gameId = OTHER_GAME;},
    record => {record.schemaVersion = 2;},record => {record.playerName = 'Demo South';},record => {record.snapshots = [];},
    record => {record.captureSource.tabId = 8;},record => {record.captureSource.documentId = 'another-document';},
    record => {delete record.captureSource;}]) {
    const current = source(); mutate(current);
    const h = harness({initial:{[SOURCE_KEY]:current,['msa.deck.' + version.id]:version}});
    assert.equal((await h.send(message(version))).ok,false); assert.equal(h.writes.length,0);
  }
  const h = await setup();
  for (const from of [{...sender,documentId:undefined},{...sender,documentId:''},{...sender,tab:{}}]) {
    assert.equal((await h.send(message(h.version),from)).ok,false);
  }
  assert.equal(h.writes.length,0);
});

test('missing, key-mismatched, malformed and non-50-card deck records are rejected', async () => {
  const version = await deck();
  for (const mutate of [record => {record.id = 'different-version';},record => {record.schemaVersion = 2;},
    record => {record.main[0].count = 5;},record => {record.main[0].cardCode = 'not-a-card';},
    record => {record.main = [];}]) {
    const broken = copy(version); mutate(broken);
    const h = harness({initial:{[SOURCE_KEY]:source(),['msa.deck.' + version.id]:broken}});
    assert.equal((await h.send(message(version))).ok,false); assert.equal(h.writes.length,0);
  }
  const h = harness({initial:{[SOURCE_KEY]:source()}});
  assert.equal((await h.send(message(version))).ok,false); assert.equal(h.writes.length,0);
});

test('binding the same version is idempotent and preserves original frozen history and metadata', async () => {
  const version = await deck(), match = await prior(version,{customAudit:{value:'original'}});
  const h = await setup({initial:{['msa.match.' + match.id]:match}});
  const reply = await h.send(message(version));
  assert.equal(reply.ok,true); assert.equal(reply.existing,true); assert.deepEqual(reply.record,match);
  assert.equal(h.writes.length,0); assert.deepEqual(h.db['msa.match.' + match.id],match);
});

test('an unconfirmed match may select a new version while keeping its first-player confirmation', async () => {
  const original = await deck(), next = await deck('Synthetic changed deck'), match = await prior(original,{customAudit:'keep'});
  const h = await setup({initial:{['msa.deck.' + next.id]:next,['msa.match.' + match.id]:match}});
  const reply = await h.send(message(next));
  assert.equal(reply.ok,true); assert.equal(reply.record.firstPlayer,'second'); assert.equal(reply.record.result,'unknown');
  assert.equal(reply.record.resultConfirmed,false); assert.deepEqual(reply.record.frozenDeckVersion,next);
  assert.equal(reply.record.customAudit,'keep'); assert.deepEqual(h.db['msa.deck.' + original.id],original);
});

test('confirmed results reject a version change and the same version remains an untouched success', async () => {
  const original = await deck(), next = await deck('Synthetic changed deck');
  const match = await prior(original,{result:'win',resultConfirmed:true,firstPlayer:'first'});
  const h = await setup({initial:{['msa.deck.' + next.id]:next,['msa.match.' + match.id]:match}});
  const rejected = await h.send(message(next));
  assert.equal(rejected.ok,false); assert.match(rejected.reason,/資料與牌組/);
  const same = await h.send(message(original)); assert.equal(same.ok,true); assert.deepEqual(same.record,match);
  assert.equal(h.writes.length,0); assert.deepEqual(h.db['msa.match.' + match.id],match);
});

test('the latest valid exact-key manual record is chosen by timestamp without borrowing another player or game', async () => {
  const original = await deck(), next = await deck('Synthetic changed deck');
  const old = await prior(original,{result:'win',resultConfirmed:true,updatedAt:'2000-01-01T08:00:00+08:00'});
  const latest = {...old,id:'synthetic-imported-confirmation',updatedAt:'2000-01-01T00:01:00Z',result:'unknown',resultConfirmed:false,firstPlayer:'second'};
  const foreign = {...old,id:'foreign-player-confirmation',playerName:'Demo South',updatedAt:'2099-01-01T00:00:00Z'};
  const otherGame = {...old,id:'foreign-game-confirmation',gameId:OTHER_GAME,updatedAt:'2099-01-01T00:00:00Z'};
  const malformed = {...old,id:'key-mismatch',updatedAt:'2099-01-01T00:00:00Z'};
  const h = await setup({initial:{['msa.deck.' + next.id]:next,['msa.match.' + old.id]:old,
    ['msa.match.' + latest.id]:latest,['msa.match.' + foreign.id]:foreign,['msa.match.' + otherGame.id]:otherGame,
    'msa.match.wrong-key':malformed}});
  const reply = await h.send(message(next));
  assert.equal(reply.ok,true); assert.equal(reply.record.result,'unknown'); assert.equal(reply.record.firstPlayer,'second');
  assert.deepEqual(h.db['msa.match.' + foreign.id],foreign); assert.deepEqual(h.db['msa.match.' + otherGame.id],otherGame);
});

test('binding serializes with existing workspace writes and reports a failed write without poisoning later actions', async () => {
  let fail = true;
  const h = await setup({beforeSet:async patch => {if (fail && Object.keys(patch).some(key => key.startsWith('msa.match.'))) throw new Error('Synthetic quota failure');}});
  const first = await h.send(message(h.version)); assert.equal(first.ok,false); assert.match(first.reason,/Synthetic quota/);
  assert.equal(Object.keys(h.db).filter(key => key.startsWith('msa.match.')).length,0);
  fail = false;
  const second = await h.send(message(h.version)); assert.equal(second.ok,true); assert.equal(h.writes.length,1);
  const after = await h.send(message(h.version)); assert.equal(after.ok,true); assert.equal(after.existing,true); assert.equal(h.writes.length,1);
});

test('a live binding cannot race a queued manual result update to change its frozen deck', async () => {
  const version = await deck(), next = await deck('Synthetic changed deck');
  let started, finish;
  const entered = new Promise(resolve => {started = resolve;});
  const gate = new Promise(resolve => {finish = resolve;});
  let blocked = false;
  const h = await setup({initial:{['msa.deck.' + next.id]:next},beforeSet:async patch => {
    if (!blocked && Object.keys(patch).some(key => key.startsWith('msa.match.'))) {blocked = true; started(); await gate;}
  }});
  const manual = h.send({type:'MSA_LIBRARY_ACTION',action:'saveMatch',draft:{sourceSessionId:ID,gameId:GAME,playerName:'Demo North',identityConfirmed:true,
    deckVersionId:version.id,result:'win',resultConfirmed:true,firstPlayer:'first'}},{id:EXT,url:`chrome-extension://${EXT}/library.html`});
  await entered;
  const live = h.send(message(next)); finish();
  assert.equal((await manual).ok,true); assert.equal((await live).ok,false);
  const matches = Object.values(h.db).filter(record => record?.source === 'manual');
  assert.equal(matches.length,1); assert.equal(matches[0].result,'win'); assert.equal(matches[0].deckVersionId,version.id);
});
