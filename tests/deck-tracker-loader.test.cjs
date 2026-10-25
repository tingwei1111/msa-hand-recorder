'use strict';

// Browser-like classic-script execution with the packaged Rust/Wasm binary.
// Fetch and storage are synthetic; no page, network, or private match is read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const recorder = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');

const extension = path.join(__dirname,'../extension');
const source = file => fs.readFileSync(path.join(extension,file),'utf8');
const binary = fs.readFileSync(path.join(extension,'wasm/deck_tracker_bg.wasm'));
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const plain = value => JSON.parse(JSON.stringify(value));
const GAME = '00000000-0000-4000-8000-000000001201';
const RUN = '10000000-0000-4000-8000-000000001201';
const SESSION = `${GAME}.${RUN}`;
const WHEN = '2000-01-01T00:00:00.000Z';
const PLAYER = 'Synthetic North';
const OPPONENT = 'Synthetic South';
const VERSION = 'synthetic-loader-deck.v1';
const context = () => ({gameId:GAME,runId:RUN,playerName:PLAYER,enabled:true,
  pendingCount:0,writeError:'',quality:'complete'});

function deferred() {
  let resolve,reject;
  const promise = new Promise((yes,no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function fixture() {
  const version = {schemaVersion:1,id:VERSION,deckId:'synthetic-loader-deck',name:'Synthetic loader 50',createdAt:WHEN,
    main:Array.from({length:13},(_,index) => ({cardCode:`GD01-${String(index+1).padStart(3,'0')}`,count:index===12?2:4})),
    resources:[{cardCode:'R-001',count:10}],tokens:[]};
  let record = recorder.createSession({id:SESSION,gameId:GAME,playerName:PLAYER,startedAt:WHEN});
  record = recorder.appendSnapshot(record,{timestamp:WHEN,turn:1,turnSource:'log',observedTurn:1,activePlayer:PLAYER,phase:'MAIN',
    hand:[{cardCode:'GD01-001',count:2}],expectedCount:2,unknownCount:0,quality:'complete',resources:{level:3,active:2,exActive:1}});
  record = battle.ingest(record,{observedAt:WHEN,order:'oldest-first',completeFromStart:true,players:[PLAYER,OPPONENT],rows:[
    {text:'Game started!',sourceIndex:0},
    {text:'Turn 1 started!',sourceIndex:1},
    {text:'Played command: Synthetic command',actor:PLAYER,cards:[{cardCode:'GD01-118',name:'Synthetic command'}],sourceIndex:2}
  ]});
  const match = {schemaVersion:1,id:'synthetic-loader-match',gameId:GAME,playerName:PLAYER,identityConfirmed:true,
    source:'manual',sourceSessionId:SESSION,deckVersionId:VERSION,frozenDeckVersion:structuredClone(version),updatedAt:WHEN,
    result:'unknown',resultConfirmed:false,firstPlayer:'unknown'};
  return {record,values:{[`msa.session.${SESSION}`]:record,[`msa.deck.${VERSION}`]:version,'msa.match.synthetic-loader-match':match}};
}

function browser(options = {}) {
  const gate = deferred(),requests = [];
  const realm = vm.createContext({
    WebAssembly,TextEncoder,TextDecoder,URL,console,setTimeout,clearTimeout,
    ...(options.locator==='none'?{}:{document:{currentScript:{src:'chrome-extension://synthetic-recorder/deck-tracker-core.js'}},
      location:{href:'https://example.invalid/game/synthetic'}}),
    ...(options.locator==='document'||options.locator==='none'?{}:{chrome:{runtime:{
      getURL:file => `chrome-extension://synthetic-recorder/${file}`
    }}}),
    fetch(url,settings) {requests.push({url,settings:plain(settings)});return gate.promise;}
  });
  if (!options.omitWire) vm.runInContext(source('deck-tracker-wire.js'),realm,{filename:'deck-tracker-wire.js'});
  if (!options.omitBindings) vm.runInContext(source('wasm/deck_tracker.js'),realm,{filename:'deck_tracker.js'});
  vm.runInContext(source('deck-tracker-core.js'),realm,{filename:'deck-tracker-core.js'});
  const api = realm.MSADeckTrackerCore;
  return {realm,api,gate,requests,
    succeed(bytes = binary) {gate.resolve({ok:true,arrayBuffer:async()=>arrayBuffer(bytes)});},
    installLive() {
      realm.MSARecorderCore=recorder;realm.MSABattleLogCore=battle;
      vm.runInContext(source('live-panel-core.js'),realm,{filename:'live-panel-core.js'});
      return realm.MSALivePanelCore;
    }};
}

function assertSavedEvidence(model,record) {
  assert.equal(model.latestSnapshot.id,record.snapshots[0].id);
  assert.equal(model.snapshotCount,1);
  assert.deepEqual(plain(model.handCards),[{cardCode:'GD01-001',count:2}]);
  assert.equal(model.publicEventCount,3);
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.recentPlays[0].cardCode,'GD01-118');
  assert.equal(model.recentPlays[0].actorSide,'own');
  assert.equal(model.statusTone,'success');
}
test('identical wire projections reuse Wasm output without sharing mutable results',async()=>{
  const h=browser();h.succeed();await h.api.ready();
  const original=h.realm.MSADeckTrackerWasm.project_wire_json;let calls=0;
  h.realm.MSADeckTrackerWasm.project_wire_json=value=>{calls++;return original(value);};
  const data=fixture(),input={values:data.values,context:context(),handModel:{},events:[]};
  const first=h.api.project(input),before=plain(first);
  first.availableDecks.length=0;
  assert.deepEqual(plain(h.api.project(input)),before);assert.equal(calls,1);
  input.context.playerName='Different synthetic player';h.api.project(input);assert.equal(calls,2);
});

test('browser startup has one shared initialization, one bundled fetch and actual synchronous Rust projection after ready',async()=>{
  const h = browser(),seen = [],disposed = [];
  assert.equal(typeof h.realm.MSADeckTrackerWasm.initSync,'function','classic glue must expose its binding on globalThis');
  assert.deepEqual(plain(h.api.engineStatus()),{engine:'rust-wasm',state:'loading'});
  const pending=h.api.ready();
  assert.equal(h.api.ready(),pending);
  assert.equal(h.api.ready(),pending);
  assert.throws(()=>h.api.project({}),/載入中/);
  assert.equal(h.requests.length,1);
  assert.deepEqual(h.requests[0],{url:'chrome-extension://synthetic-recorder/wasm/deck_tracker_bg.wasm',settings:{credentials:'omit',cache:'no-store'}});
  assert.throws(()=>h.api.subscribe(null),/Engine listener must be a function/);
  h.api.subscribe(()=>{throw new Error('Synthetic view callback failure');});
  const stop=h.api.subscribe(status=>seen.push(plain(status)));
  const dispose=h.api.subscribe(status=>disposed.push(status));
  dispose();dispose();
  h.succeed();await pending;
  assert.deepEqual(seen,[{engine:'rust-wasm',state:'ready'}]);
  assert.deepEqual(disposed,[]);
  assert.deepEqual(plain(h.api.engineStatus()),{engine:'rust-wasm',state:'ready'});
  assert.ok(h.realm.MSADeckTrackerWasm.__wbindgen_wasm_module instanceof WebAssembly.Module);
  const {record,values}=fixture(),live=h.installLive();
  const model=live.project(values,context());
  assertSavedEvidence(model,record);
  assert.equal(model.deckTracker.state,'bound');
  assert.equal(model.deckTracker.rows.length,14,'the public card outside the bound deck remains visible');
  assert.equal(model.deckTracker.rows.find(row=>row.cardCode==='GD01-001').handCount,2);
  for(let index=0;index<4;index++)assert.equal(h.api.project({}).state,'identity-unknown');
  assert.equal(h.requests.length,1,'projection and ready() must not fetch repeatedly');
  assert.equal(h.api.ready(),pending);
  stop();
});

test('a classic-script preview resolves its adjacent packaged Wasm without Chrome APIs',async()=>{
  const h=browser({locator:'document'});
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].url,'chrome-extension://synthetic-recorder/wasm/deck_tracker_bg.wasm');
  h.succeed();await h.api.ready();
  assert.equal(h.api.engineStatus().state,'ready');
  assert.equal(h.api.project({}).state,'identity-unknown');
});

for(const [label,options,settle,reason] of [
  ['HTTP failure',{},h=>h.gate.resolve({ok:false}),/無法載入/],
  ['fetch rejection',{},h=>h.gate.reject(new Error('Synthetic fetch failure')),/Synthetic fetch failure/],
  ['invalid binary',{},h=>h.succeed(Uint8Array.of(1,2,3,4)),/WebAssembly|magic|expected/i],
  ['oversized binary',{},h=>h.succeed(new Uint8Array(4*1024*1024+1)),/超過預期大小/],
  ['missing glue',{omitBindings:true},h=>h.succeed(),/載入模組不完整/],
  ['missing wire',{omitWire:true},h=>h.succeed(),/載入模組不完整/]
]) {
  test(`browser ${label} reports an error, rejects ready and never supplies a JavaScript fallback`,async()=>{
    const h=browser(options),seen=[],removed=[];
    h.api.subscribe(status=>seen.push(plain(status)));
    h.api.subscribe(()=>{throw new Error('Synthetic failing subscriber');});
    const remove=h.api.subscribe(status=>removed.push(status));remove();
    const pending=h.api.ready();
    settle(h);
    await assert.rejects(pending,reason);
    assert.equal(h.api.ready(),pending,'an error must not silently restart initialization');
    assert.equal(seen.length,1);
    assert.equal(seen[0].engine,'rust-wasm');
    assert.equal(seen[0].state,'error');
    assert.match(seen[0].reason,reason);
    assert.equal(h.api.engineStatus().state,'error');
    assert.throws(()=>h.api.project({}),reason);
    assert.deepEqual(removed,[]);
    assert.equal(h.requests.length,1);
  });
}

test('a missing package locator fails explicitly without any fetch',async()=>{
  const h=browser({locator:'none'});
  await assert.rejects(h.api.ready(),/找不到已打包/);
  assert.equal(h.requests.length,0);
  assert.equal(h.api.engineStatus().state,'error');
  assert.throws(()=>h.api.project({}),/找不到已打包/);
});

test('the live projection preserves saved hand and public Battle Log through engine loading and failure',async()=>{
  const h=browser(),live=h.installLive(),{record,values}=fixture(),before=structuredClone(values);
  const loading=live.project(values,context());
  assertSavedEvidence(loading,record);
  assert.equal(loading.deckTracker.state,'loading');
  assert.equal(loading.deckTracker.canBind,false);
  assert.deepEqual(plain(loading.deckTracker.rows),[]);
  assert.match(loading.deckTracker.stateDetail,/載入中.*手牌.*Log/);
  h.gate.reject(new Error('Synthetic packaged binary failure'));
  await assert.rejects(h.api.ready(),/Synthetic packaged binary failure/);
  const failed=live.project(values,context());
  assertSavedEvidence(failed,record);
  assert.equal(failed.deckTracker.state,'error');
  assert.equal(failed.deckTracker.canBind,false);
  assert.deepEqual(plain(failed.deckTracker.rows),[]);
  assert.match(failed.deckTracker.stateDetail,/既有手牌與 Log 仍保留/);
  assert.deepEqual(values,before,'loader failure must never rewrite saved records');
});

test('the live controller redraws when the real Wasm engine becomes ready and disposes its engine subscription',async()=>{
  const h=browser(),live=h.installLive(),{record,values}=fixture();
  vm.runInContext(source('live-panel-controller.js'),h.realm,{filename:'live-panel-controller.js'});
  const models=[],listeners=new Set();
  let reads=0,writes=0,subscribed=0,unsubscribed=0,destroyed=0;
  const controller=h.realm.MSALivePanelController.create({
    tracker:{subscribe(listener){subscribed++;const remove=h.api.subscribe(listener);return()=>{unsubscribed++;remove();};}},
    storage:{local:{async get(){reads++;return structuredClone(values);},async set(){writes++;}},
      onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)}},
    getContext:context,project:live.project,debounceMs:0,
    createUI(){return{update:model=>models.push(plain(model)),setPreferences(){},destroy(){destroyed++;}};}
  });
  controller.sync();await new Promise(setImmediate);
  assert.equal(subscribed,1);
  assert.equal(reads,1);
  assert.equal(models.at(-1).deckTracker.state,'loading');
  assertSavedEvidence(models.at(-1),record);
  const beforeReady=models.length;
  h.succeed();await h.api.ready();
  assert.equal(models.length,beforeReady+1,'engine notification must redraw without a manual sync');
  assert.equal(models.at(-1).deckTracker.state,'bound');
  assertSavedEvidence(models.at(-1),record);
  assert.equal(reads,1,'engine notification must use existing saved-data cache');
  assert.equal(writes,0);
  controller.destroy();controller.destroy();
  assert.equal(unsubscribed,1);
  assert.equal(destroyed,1);
  assert.equal(listeners.size,0);
});

test('destroying the panel before Wasm settles suppresses late redraws and never writes storage',async()=>{
  const h=browser(),live=h.installLive(),{values}=fixture();
  vm.runInContext(source('live-panel-controller.js'),h.realm,{filename:'live-panel-controller.js'});
  const models=[];let removed=0,writes=0;
  const controller=h.realm.MSALivePanelController.create({
    tracker:{subscribe(listener){const remove=h.api.subscribe(listener);return()=>{removed++;remove();};}},
    storage:{local:{async get(){return structuredClone(values);},async set(){writes++;}},
      onChanged:{addListener(){},removeListener(){}}},
    getContext:context,project:live.project,
    createUI(){return{update:model=>models.push(plain(model)),setPreferences(){},destroy(){}};}
  });
  controller.sync();await new Promise(setImmediate);
  assert.equal(models.at(-1).deckTracker.state,'loading');
  controller.destroy();const beforeReady=models.length;
  h.succeed();await h.api.ready();
  assert.equal(h.api.engineStatus().state,'ready');
  assert.equal(removed,1);
  assert.equal(models.length,beforeReady);
  assert.equal(writes,0);
});
