'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../extension/recorder-core.js'),battle=require('../extension/battle-log-core.js'),recovery=require('../extension/recovery-journal.js');
const queueAPI=require('../extension/capture-coordinator.js');
const {createIndexedDBFixture}=require('./fixtures/recovery-idb.cjs');
const GAME='00000000-0000-4000-8000-000000000921',RUN='10000000-0000-4000-8000-000000000921',KEY='msa.session.'+GAME+'.'+RUN;
const sender={frameId:0,tab:{id:7},documentId:'synthetic-document',url:'https://mobilesuitarena.com/game/'+GAME};
const extension={id:'test',url:'chrome-extension://test/popup.html'};
function record(sequence,phase='MAIN-'+sequence){return {type:'MSA_RECORD',gameId:GAME,runId:RUN,sequence,playerName:'Synthetic',snapshot:{
 timestamp:'2000-01-01T00:00:00Z',turn:1,turnSource:'log',observedTurn:1,activePlayer:'Synthetic',phase,
 hand:[{cardCode:sequence%2?'GD99-001':'GD99-002',count:1}],expectedCount:1,unknownCount:0,quality:'complete',reason:'synthetic'}};}
const batch=observations=>({type:'MSA_RECORD_BATCH',gameId:GAME,runId:RUN,observations});
function harness(options={}){
 const db=options.db||{},writes=[];let listener;
 const journal=options.journal||recovery.create({indexedDB:createIndexedDBFixture().indexedDB});
 const chrome={runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(fn){listener=fn;}}},
  tabs:{query:async()=>options.tabs||[],sendMessage:async()=>{throw new Error('synthetic original tab closed');}},
  storage:{local:{async get(keys){const list=keys===null?Object.keys(db):Array.isArray(keys)?keys:[keys];return structuredClone(Object.fromEntries(list.filter(k=>Object.hasOwn(db,k)).map(k=>[k,db[k]])));},
   async set(patch){await options.beforeSet?.(patch);writes.push(structuredClone(patch));Object.assign(db,structuredClone(patch));}}}};
 const context=vm.createContext({chrome,MSARecorderCore:core,MSABattleLogCore:battle,MSARecoveryJournal:{...recovery,create:()=>journal},URL,Map,Date,Promise,JSON,setTimeout,clearTimeout,importScripts(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
 const send=(message,from=sender)=>new Promise((resolve,reject)=>{let replied=false;try{const pending=listener(structuredClone(message),from,value=>{replied=true;resolve(structuredClone(value));});if(!pending&&!replied)resolve({ignored:true});}catch(error){reject(error);}});
 return {db,writes,journal,send};
}
test('staging survives a new background instance and can be downloaded with no active original page',async()=>{
 const fixture=createIndexedDBFixture(),journal=recovery.create({indexedDB:fixture.indexedDB}),h=harness({journal});
 const staged=await h.send({type:'MSA_STAGE_RECORD',payload:record(1)});assert.equal(staged.durable,true);assert.deepEqual(h.db,{});
 const restarted=harness({journal:recovery.create({indexedDB:fixture.indexedDB}),db:h.db});
 const rescue=await restarted.send({type:'MSA_GET_RESCUE'},extension);
 assert.equal(rescue.ok,true);assert.equal(rescue.backup.recovery.durableRecordCount,1);assert.equal(rescue.backup.page.available,false);
 assert.deepEqual(rescue.backup.records[0].journal[0].payload,record(1));assert.equal(restarted.writes.length,0);
});
test('staging and batch routes reject other origins, frames, game routes and mixed identities',async()=>{
 const h=harness(),payload=record(1);
 for(const from of [{...sender,url:'https://other.test/'},{...sender,frameId:1},{...sender,url:'https://mobilesuitarena.com/'}]){
  assert.equal((await h.send({type:'MSA_STAGE_RECORD',payload},from)).durable,false);
  assert.equal((await h.send(batch([payload]),from)).ok,false);
 }
 assert.equal((await h.send(batch([{...payload,runId:'10000000-0000-4000-8000-000000000922'}]))).ok,false);
 assert.equal((await h.send(batch([record(2),record(1)]))).ok,false);assert.equal(h.writes.length,0);
});
test('bounded batches retain every intermediate hand and commit the legacy session once',async()=>{
 const h=harness(),observations=Array.from({length:16},(_,i)=>record(i+1));
 for(const payload of observations)assert.equal((await h.send({type:'MSA_STAGE_RECORD',payload})).durable,true);
 const reply=await h.send(batch(observations));assert.ok(reply.results.every(item=>item.ok));
 assert.equal(h.db[KEY].snapshots.length,16);assert.deepEqual(h.db[KEY].snapshots.map(x=>x.phase),observations.map(x=>x.snapshot.phase));
 assert.equal(h.writes.filter(p=>p[KEY]).length,1);assert.equal((await h.journal.backup()).records.length,0);
});
test('a lost acknowledgement can retry an A-B-A batch without duplicate snapshots or session writes',async()=>{
 const h=harness(),observations=[record(1,'A'),record(2,'B'),record(3,'A')];
 await h.send(batch(observations)); // Pretend the content script never received this committed response.
 const retry=await h.send(batch(observations));assert.ok(retry.results.every(x=>x.ok));
 assert.deepEqual(h.db[KEY].snapshots.map(x=>x.phase),['A','B','A']);assert.equal(h.db[KEY].captureWriteSequence,3);
 assert.equal(h.writes.filter(p=>p[KEY]).length,1);
});
test('transient storage failure leaves every staged original and the whole batch can retry atomically',async()=>{
 let fail=true;const h=harness({beforeSet:patch=>{if(patch[KEY]&&fail)throw new Error('synthetic quota');}}),observations=[record(1),record(2)];
 for(const payload of observations)await h.send({type:'MSA_STAGE_RECORD',payload});
 const first=await h.send(batch(observations));assert.ok(first.results.every(x=>!x.ok));assert.equal(h.db[KEY],undefined);
 assert.equal((await h.journal.backup()).records.length,2);fail=false;
 assert.ok((await h.send(batch(observations))).results.every(x=>x.ok));assert.equal(h.db[KEY].snapshots.length,2);assert.equal((await h.journal.backup()).records.length,0);
});
test('an invalid Log in a batch is isolated while valid hands commit and its journal remains downloadable',async()=>{
 const h=harness(),bad={type:'MSA_LOG',gameId:GAME,runId:RUN,sequence:1,batch:{rows:Array.from({length:12001},()=>({text:'Synthetic'}))}};
 const queue=queueAPI.createWriteQueue({persist:p=>h.send({type:'MSA_STAGE_RECORD',payload:p}),batchDelayMs:100,maxBatch:16,writeBatch:p=>h.send(batch(p))});
 queue.enqueue(bad);queue.enqueue(record(2));const flushed=await queue.flush();
 assert.equal(flushed.ok,true);assert.equal(flushed.quarantinedCount,1);assert.equal(h.db[KEY].snapshots.length,1);
 assert.equal((await h.journal.backup()).records.length,1);assert.equal(queue.rescue().recovery.durableCount,1);
});
test('journal cleanup failure does not claim a failed main save or automatically replay its retained original',async()=>{
 const base=recovery.create({indexedDB:createIndexedDBFixture().indexedDB});
 const h=harness({journal:{...base,complete:async()=>{throw new Error('synthetic cleanup abort');}}});
 await h.send({type:'MSA_STAGE_RECORD',payload:record(1)});const reply=await h.send(batch([record(1)]));
 assert.equal(reply.results[0].ok,true);assert.equal(reply.results[0].recoveryCleanupPending,true);assert.equal(h.db[KEY].snapshots.length,1);
 const exportResult=await h.send({type:'MSA_GET_RESCUE'},extension);assert.equal(exportResult.backup.records[0].journal[0].state,'unconfirmed');
 assert.equal(h.db[KEY].snapshots.length,1);
});
test('batching reduces session writes and submitted bytes while preserving the same 64-observation history',async t=>{
 const single=harness(),grouped=harness(),observations=Array.from({length:64},(_,i)=>record(i+1));
 for(const payload of observations)assert.equal((await single.send(payload)).ok,true);
 for(let i=0;i<observations.length;i+=16)assert.ok((await grouped.send(batch(observations.slice(i,i+16)))).results.every(x=>x.ok));
 const sessionPatches=h=>h.writes.filter(p=>p[KEY]),bytes=h=>sessionPatches(h).reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p[KEY])),0);
 assert.deepEqual(grouped.db[KEY].snapshots,single.db[KEY].snapshots);assert.equal(sessionPatches(grouped).length,4);assert.equal(sessionPatches(single).length,64);
 assert.ok(bytes(grouped)<bytes(single)*0.15);t.diagnostic(JSON.stringify({singleSessionWrites:64,batchSessionWrites:4,singleLogicalBytes:bytes(single),batchLogicalBytes:bytes(grouped)}));
});
