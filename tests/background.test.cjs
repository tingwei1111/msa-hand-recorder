'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../extension/recorder-core.js');
const logCore=require('../extension/battle-log-core.js');
const synthetic=require('./fixtures/synthetic-match.js');
const gameId='00000000-0000-4000-8000-000000000101';
const runId='11111111-1111-4111-8111-111111111111';
function harness(fail=false,options={}){
 const db={};let listener;
 const context=vm.createContext({MSARecorderCore:core,MSABattleLogCore:logCore,URL,Map,Promise,Date,JSON,setTimeout,clearTimeout,importScripts(){},chrome:{
  runtime:{id:'test-extension',getURL:file=>'chrome-extension://test-extension/'+file,onMessage:{addListener(fn){listener=fn;}}},
  tabs:{query:options.query || (async()=>[{id:7,active:true}]),create:options.create || (async()=>({id:99})),sendMessage:options.capture || (async()=>{throw new Error('Receiving end does not exist');})},storage:{local:{
   async get(keys){await Promise.resolve();const list=keys===null?Object.keys(db):Array.isArray(keys)?keys:[keys];return structuredClone(Object.fromEntries(list.filter(k=>k in db).map(k=>[k,db[k]])));},
   async set(values){if(fail)throw new Error('QUOTA_BYTES');await options.beforeSet?.(values);await Promise.resolve();Object.assign(db,structuredClone(values));}
  }}
 }});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
 const sender={frameId:0,documentId:'doc-A',url:`https://mobilesuitarena.com/game/${gameId}`,tab:{id:7}};
 function send(message,source=sender){return new Promise(resolve=>{const pending=listener(message,source,resolve);if(!pending)resolve({ignored:true});});}
 return {db,send};
}
function record(phase='MAIN'){return {type:'MSA_RECORD',gameId,runId,playerName:'測試玩家',snapshot:{
 timestamp:'2026-10-24T03:00:00Z',turn:null,turnSource:'phase-observed',observedTurn:1,activePlayer:'測試玩家',phase,
 hand:[{cardCode:'GD05-002',count:2}],expectedCount:2,unknownCount:0,quality:'complete',reason:'visible-hand-dom-slots'
}};}
test('oversized rejected Log cannot block the following valid hand observation',async()=>{
 const {createWriteQueue}=require('../extension/capture-coordinator.js');
 const h=harness(),queue=createWriteQueue({write:payload=>h.send(payload)});
 queue.enqueue({type:'MSA_LOG',gameId,runId,playerName:'',batch:{rows:Array.from({length:12001},()=>({text:'Synthetic row'}))}});
 queue.enqueue(record());assert.equal((await queue.flush()).ok,true);
 assert.equal(queue.state().quarantinedCount,1);
 assert.equal(h.db[`msa.session.${gameId}.${runId}`].snapshots.length,1);
});
function log(rows){return {type:'MSA_LOG',gameId,runId,playerName:'',batch:{
 observedAt:'2026-10-24T03:00:00Z',order:'oldest-first',completeFromStart:true,ended:false,
 players:['測試玩家','測試對手'],structure:'msa-drawer-v1',rows:rows||[
  {sourceIndex:0,text:'Game started!',actor:'',cards:[]},
  {sourceIndex:1,text:'Turn 1 started!',actor:'',cards:[]},
  {sourceIndex:2,text:'Silver Bullet deployed',actor:'測試玩家',cards:[{cardCode:'GD04-068',name:'Silver Bullet'}]}
 ]
}};}
test('background serializes concurrent observations without losing history',async()=>{
 const {db,send}=harness();const replies=await Promise.all([send(record('MAIN')),send(record('ATTACK')),send(record('END'))]);
 assert.ok(replies.every(r=>r.ok));assert.equal(db[`msa.session.${gameId}.${runId}`].snapshots.length,3);
});
test('background rejects other origins and child frames',async()=>{
 const {db,send}=harness();assert.equal((await send(record(),{tab:{id:7},frameId:0,url:'https://other.test/'})).ignored,true);
 assert.equal((await send(record(),{tab:{id:7},frameId:1,url:'https://mobilesuitarena.com/'})).ignored,true);assert.equal(Object.keys(db).length,0);
});
test('pause prevents new writes and quota failure is surfaced',async()=>{
 const h=harness();h.db['msa.settings']={enabled:false};assert.equal((await h.send(record())).paused,true);
 assert.equal(Object.keys(h.db).length,1);const failed=await harness(true).send(record());assert.equal(failed.ok,false);assert.match(failed.error,/QUOTA/);
});
test('separate runs cannot overwrite each other and bad ids are rejected',async()=>{
 const {db,send}=harness();await send(record());await send({...record(),runId:'22222222-2222-4222-8222-222222222222'});
 assert.equal(Object.keys(db).filter(k=>k.startsWith('msa.session.')).length,2);
 assert.equal((await send({...record(),gameId:'not-a-game'})).ok,false);
});
test('public-log-only capture has events and no invented hand snapshots',async()=>{
 const {db,send}=harness();const reply=await send(log());
 assert.equal(reply.ok,true);assert.equal(reply.snapshotCount,0);assert.equal(reply.eventCount,3);
 const saved=db[`msa.session.${gameId}.${runId}`];
 assert.equal(saved.snapshots.length,0);assert.equal(saved.battleLog.events.length,3);assert.equal(saved.playerName,'');
});
test('concurrent hand and log writes use the same queue and preserve both histories',async()=>{
 const {db,send}=harness();const first=log();const extended=log([...first.batch.rows,
  {sourceIndex:3,text:'Silver Bullet deployed',actor:'測試玩家',cards:[{cardCode:'GD04-068',name:'Silver Bullet'}]}]);
 const replies=await Promise.all([send(first),send(record('MAIN')),send(extended),send(record('END'))]);
 assert.ok(replies.every(reply=>reply.ok));
 const saved=db[`msa.session.${gameId}.${runId}`];
 assert.equal(saved.snapshots.length,2);assert.equal(saved.battleLog.events.length,4);assert.equal(saved.playerName,'測試玩家');
 assert.equal(saved.snapshots[0].phase,'MAIN');assert.equal(saved.snapshots[1].phase,'END');
});
test('reopening the same public log does not duplicate stored events',async()=>{
 const {db,send}=harness();await send(log());const replay=log();replay.batch.observedAt='2026-10-24T03:05:00Z';
 assert.equal((await send(replay)).eventCount,3);
 assert.equal(db[`msa.session.${gameId}.${runId}`].battleLog.events.length,3);
});
test('pause prevents public-log writes and log quota failure is surfaced',async()=>{
 const h=harness();h.db['msa.settings']={enabled:false};assert.equal((await h.send(log())).paused,true);
 assert.equal(Object.keys(h.db).length,1);
 const failed=await harness(true).send(log());assert.equal(failed.ok,false);assert.match(failed.error,/QUOTA/);
});
test('both capture types reject a game id that differs from the sender page',async()=>{
 const {db,send}=harness();const other='22222222-2222-4222-8222-222222222222';
 assert.equal((await send({...record(),gameId:other})).ok,false);
 assert.equal((await send({...log(),gameId:other})).ok,false);
 assert.equal(Object.keys(db).length,0);
});
test('oversized public-log row counts and byte payloads are rejected before storage',async()=>{
 const {db,send}=harness();const tooMany=log(Array.from({length:12001},(_,sourceIndex)=>({sourceIndex,text:'Passed',actor:'測試玩家',cards:[]})));
 assert.equal((await send(tooMany)).ok,false);
 const tooLarge=log([{sourceIndex:0,text:'x'.repeat(1500001),actor:'',cards:[]}]);
 assert.equal((await send(tooLarge)).ok,false);assert.equal(Object.keys(db).length,0);
});
test('the synthetic 537-row public log can be saved without creating a hand history',async()=>{
 const {db,send}=harness();const batch=synthetic.createBatch(537);
 const reply=await send({...log(),batch});assert.equal(reply.ok,true);assert.equal(reply.eventCount,537);
 const saved=db[`msa.session.${gameId}.${runId}`];assert.equal(saved.snapshots.length,0);assert.equal(saved.battleLog.events.length,537);
});
const extension={id:'test-extension',url:'chrome-extension://test-extension/review.html'};
const prepare={type:'MSA_PREPARE_EXPORT',gameId,playerName:'測試玩家'};
test('prepare matches status and tab IDs without reading tab URLs',async()=>{
 const queries=[],captures=[];const h=harness(false,{query:async query=>{queries.push(query);return [{id:7,active:true},{id:8,active:false}];},capture:async(id,message)=>{
  captures.push({id,message});return {ok:true,refreshed:true,partial:false,gameId,code:'captured',sessionIds:['saved']};}});
 h.db['msa.status.7']={gameId,playerName:'測試玩家'};h.db['msa.status.8']={gameId:'other'};
 const result=await h.send(prepare,extension);assert.equal(result.refreshed,true);assert.equal(captures.length,1);assert.equal(captures[0].id,7);
 assert.deepEqual(JSON.parse(JSON.stringify(queries)),[{}]);assert.equal(captures[0].message.gameId,gameId);
});
test('no matching tab, paused recorder and stale content are explicit partial responses',async()=>{
 const h=harness();assert.equal((await h.send(prepare,extension)).code,'no-matching-tab');
 h.db['msa.status.7']={gameId};assert.equal((await h.send(prepare,extension)).refreshed,false);
 h.db['msa.settings']={enabled:false};assert.equal((await h.send(prepare,extension)).code,'paused');
 assert.equal((await h.send(prepare)).ok,false);
});
test('prepare waits for the same-game storage queue even if content responds early',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);let captureStarted;const called=new Promise(resolve=>captureStarted=resolve);let pendingWrite;
 const h=harness(false,{beforeSet:async values=>{if(Object.keys(values).some(k=>k.startsWith('msa.session.')))await held;},capture:async()=>{
  pendingWrite=h.send(record());captureStarted();return {ok:true,refreshed:true,partial:true,gameId};}});
 h.db['msa.status.7']={gameId};let resolved=false;const result=h.send(prepare,extension).then(r=>{resolved=true;return r;});
 await called;await new Promise(setImmediate);assert.equal(resolved,false);release();await pendingWrite;assert.equal((await result).refreshed,true);
 assert.equal(h.db[`msa.session.${gameId}.${runId}`].snapshots.length,1);
});
test('content returning another game never counts as a refresh',async()=>{
 const h=harness(false,{capture:async()=>({refreshed:true,gameId:'another-game'})});h.db['msa.status.7']={gameId};
 assert.equal((await h.send(prepare,extension)).refreshed,false);
});
test('different player identity cannot enter the same run',async()=>{
 const h=harness();await h.send(record());const result=await h.send({...record('END'),playerName:'另一人'});
 assert.equal(result.ok,false);assert.equal(h.db[`msa.session.${gameId}.${runId}`].snapshots.length,1);
});
test('navigation gap persists on the original session and does not permit cross-game records',async()=>{
 const h=harness();await h.send(record());const newGame='22222222-2222-4222-8222-222222222222';
 const source={tab:{id:7},frameId:0,documentId:'doc-A',url:`https://mobilesuitarena.com/game/${newGame}`};
 assert.equal((await h.send(record(),source)).ok,false);
 assert.equal((await h.send({type:'MSA_CAPTURE_GAP',gameId,runId,issue:{pendingCount:3}},source)).ok,true);
 assert.equal(h.db[`msa.session.${gameId}.${runId}`].captureIssues[0].pendingCount,3);
 assert.equal((await h.send({type:'MSA_CAPTURE_GAP',gameId,runId,issue:{pendingCount:3}},{...source,tab:{id:9}})).ok,false);
 assert.equal((await h.send({type:'MSA_CAPTURE_GAP',gameId,runId,issue:{pendingCount:3}},{...source,documentId:'doc-B'})).ok,false);
});
test('a delayed old-game write cannot replace the new tab status',async()=>{
 let release;const held=new Promise(resolve=>release=resolve);let started;const began=new Promise(resolve=>started=resolve);
 const h=harness(false,{beforeSet:async values=>{if(Object.keys(values).some(k=>k.startsWith('msa.session.'))){started();await held;}}});
 const pending=h.send(record());await began;const newGame='22222222-2222-4222-8222-222222222222';
 await h.send({type:'MSA_STATUS',status:{gameId:newGame,message:'new'}},{tab:{id:7},frameId:0,url:`https://mobilesuitarena.com/game/${newGame}`});
 release();await pending;assert.equal(h.db['msa.status.7'].gameId,newGame);
});
test('persisted source ownership allows gap reports after service worker restart',async()=>{
 const old=harness();await old.send(record());const fresh=harness();Object.assign(fresh.db,structuredClone(old.db));
 const source={tab:{id:7},frameId:0,documentId:'doc-A',url:`https://mobilesuitarena.com/game/22222222-2222-4222-8222-222222222222`};
 assert.equal((await fresh.send({type:'MSA_CAPTURE_GAP',gameId,runId,issue:{code:'buffer-full',pendingCount:2}},source)).ok,true);
 assert.equal(fresh.db[`msa.session.${gameId}.${runId}`].captureIssues[0].code,'buffer-full');
});
test('prepare surfaces persisted capture issues even when the public log refresh succeeds',async()=>{
 const h=harness(false,{capture:async()=>({refreshed:true,partial:false,gameId,reason:'captured'})});await h.send(record());
 await h.send({type:'MSA_CAPTURE_GAP',gameId,runId,issue:{pendingCount:2}});
 const result=await h.send(prepare,extension);assert.equal(result.refreshed,true);assert.equal(result.partial,true);assert.equal(result.captureIssues.length,1);
});

test('popup opens the live panel only in the current active tab without broadening access',async()=>{
 const queries=[],messages=[];
 const h=harness(false,{query:async value=>{queries.push(value);return [{id:7}];},capture:async(id,message,options)=>{
  messages.push({id,message,options});return {ok:true,opened:true,gameId};
 }});
 const result=await h.send({type:'MSA_SHOW_LIVE_PANEL'},extension);
 assert.equal(result.opened,true);
 assert.deepEqual(JSON.parse(JSON.stringify(queries)),[{active:true,currentWindow:true}]);
 assert.equal(messages[0].id,7);assert.equal(messages[0].message.type,'MSA_LIVE_PANEL_SHOW');
 assert.equal(messages[0].options.frameId,0);
 const untrusted=await h.send({type:'MSA_SHOW_LIVE_PANEL'});
 assert.equal(untrusted.ok,false);assert.equal(messages.length,1);
});

test('live panel entry reports a missing receiver or non-game response',async()=>{
 const missing=harness();assert.equal((await missing.send({type:'MSA_SHOW_LIVE_PANEL'},extension)).ok,false);
 const wrong=harness(false,{capture:async()=>({ok:true,opened:true,gameId:'not-a-game'})});
 assert.equal((await wrong.send({type:'MSA_SHOW_LIVE_PANEL'},extension)).ok,false);
});

test('live review opens only the exact saved current-run record owned by the sender document',async()=>{
 const opened=[];const h=harness(false,{create:async options=>{opened.push(options);return {id:99};}});
 await h.send(record());
 const message={type:'MSA_OPEN_LIVE_REVIEW',gameId,runId,playerName:'測試玩家'};
 const result=await h.send(message);
 assert.equal(result.ok,true);assert.equal(result.sessionId,gameId+'.'+runId);
 assert.equal(opened[0].url,'chrome-extension://test-extension/review.html?id='+gameId+'.'+runId);
 const spoof={tab:{id:8},frameId:0,documentId:'doc-other',url:`https://mobilesuitarena.com/game/${gameId}`};
 assert.equal((await h.send(message,spoof)).ok,false);
 assert.equal((await h.send({...message,playerName:'另一玩家'})).ok,false);
 assert.equal((await h.send({...message,runId:'22222222-2222-4222-8222-222222222222'})).ok,false);
 assert.equal(opened.length,1);
});

test('live review rejects other origins, child frames and a mismatching page game',async()=>{
 const opened=[];const h=harness(false,{create:async options=>opened.push(options)});await h.send(record());
 const message={type:'MSA_OPEN_LIVE_REVIEW',gameId,runId};
 assert.equal((await h.send(message,{tab:{id:7},frameId:0,url:'https://other.test/'})).ok,false);
 assert.equal((await h.send(message,{tab:{id:7},frameId:1,url:`https://mobilesuitarena.com/game/${gameId}`})).ok,false);
 assert.equal((await h.send({...message,gameId:'33333333-3333-4333-8333-333333333333'})).ok,false);
 assert.equal(opened.length,0);
});
