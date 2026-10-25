'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const queueApi=require('../extension/capture-coordinator.js');
const health=require('../extension/diagnostics-core.js');
const capacity=require('../extension/storage-health.js');
const library=require('../extension/library-store.js');
const recorder=require('../extension/recorder-core.js');
const live=require('../extension/live-panel-core.js');
const battle=require('../extension/battle-log-core.js');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

test('permanent rejected observations are rescued without blocking valid hand writes',async()=>{
  const saved=[],quarantined=[];
  const queue=queueApi.createWriteQueue({write:async payload=>payload.type==='bad-log'?
    {ok:false,retryable:false,code:'invalid-record-format',error:'invalid'}:(saved.push(payload),{ok:true}),
    onQuarantine:(payload,item)=>quarantined.push(item)});
  queue.enqueue({type:'bad-log',rows:['original evidence']});queue.enqueue({type:'hand',count:3});
  assert.equal((await queue.flush()).ok,true);assert.equal(saved.length,1);
  assert.equal(queue.state().pendingCount,0);assert.equal(queue.state().quarantinedCount,1);
  assert.deepEqual(queue.rescue().quarantined[0].payload.rows,['original evidence']);
  assert.equal(quarantined[0].code,'invalid-record-format');
  const rescue=queue.rescue();rescue.quarantined[0].payload.rows[0]='modified';
  assert.equal(queue.rescue().quarantined[0].payload.rows[0],'original evidence');
});
test('rescue retains transient failed payloads and isolated records share the memory bound',async()=>{
  const queue=queueApi.createWriteQueue({maxPending:2,write:async()=>({ok:false,retryable:false,error:'invalid'})});
  queue.enqueue({id:1});await queue.flush();queue.enqueue({id:2});await queue.flush();
  assert.equal(queue.enqueue({id:3}).accepted,false);assert.equal(queue.rescue().quarantined.length,2);
  const transient=queueApi.createWriteQueue({write:async()=>{throw new Error('quota');}});
  transient.enqueue({id:'keep'});await transient.flush();
  assert.equal(transient.rescue().pending[0].id,'keep');assert.equal(transient.state().quarantinedCount,0);
});
test('lobby is standby while version mismatch and engine failure remain errors',()=>{
  const page={pageType:'lobby',connected:false,version:'0.9.0',engine:{state:'ready'}};
  const ready=health.report({extensionVersion:'0.9.0',page});
  assert.equal(ready.hasErrors,false);assert.equal(ready.checks.find(c=>c.id==='page').level,'info');
  assert.equal(health.report({extensionVersion:'0.9.1',page}).hasErrors,true);
  assert.equal(health.report({extensionVersion:'0.9.0',page:{...page,engine:{state:'error',reason:'missing binary'}}}).hasErrors,true);
  assert.equal(health.report({extensionVersion:'0.9.0'}).hasErrors,true);
});
test('storage health reports thresholds and treats failed measurement as unknown',async()=>{
  assert.deepEqual(await capacity.measure({}),{available:false});
  assert.deepEqual(await capacity.measure({getBytesInUse:async()=>{throw new Error('denied');}}),{available:false});
  assert.equal((await capacity.measure({QUOTA_BYTES:1000,getBytesInUse:async()=>810})).level,'warning');
  const full=await capacity.measure({QUOTA_BYTES:1000,getBytesInUse:async()=>1100});
  assert.equal(full.level,'error');assert.equal(full.remaining,0);
});
test('capacity is rechecked at apply time and insufficient imports write nothing',async()=>{
  let used=0;const db={},writes=[];
  const storage={QUOTA_BYTES:10485760,getBytesInUse:async()=>used,
    get:async()=>structuredClone(db),set:async patch=>{writes.push(patch);Object.assign(db,patch);}};
  const store=library.create({storage});
  const record=recorder.createSession({id:'synthetic-capacity',gameId:'00000000-0000-4000-8000-000000000901',playerName:'Synthetic',startedAt:'2000-01-01T00:00:00Z'});
  const text=JSON.stringify(record),preview=await store.previewImport({text});
  assert.ok(preview.capacity.projected>0);
  used=10485759;
  const result=await store.applyImport({text,confirmed:true,previewToken:preview.previewToken});
  assert.equal(result.code,'insufficient-capacity');assert.equal(writes.length,0);
  const next=await store.previewImport({text});assert.ok(next.warnings.some(value=>value.includes('容量不足')));
});
test('live public cache skips unchanged timeline work, invalidates on evidence changes and isolates games',()=>{
  let timelineCalls=0;
  const realm=vm.createContext({MSARecorderCore:recorder,MSABattleLogCore:{...battle,buildTimeline(value){timelineCalls++;return battle.buildTimeline(value);}},
    MSADeckTrackerCore:{project:()=>({state:'synthetic'})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/live-panel-core.js'),'utf8'),realm);
  const api=realm.MSALivePanelCore,project=api.createProjector();
  const game='00000000-0000-4000-8000-000000000902',run='current';
  let record=recorder.createSession({id:game+'.'+run,gameId:game,playerName:'Synthetic',startedAt:'2000-01-01T00:00:00Z'});
  record=battle.ingest(record,{rows:[{text:'Game started!',sourceIndex:0},{text:'Turn 1 started!',sourceIndex:1}],completeFromStart:true,order:'oldest-first'});
  const values={['msa.session.'+record.id]:record},context={gameId:game,runId:run,playerName:'Synthetic'};
  project(values,context);assert.equal(timelineCalls,1);
  const changed=project(values,{...context,pendingCount:2});assert.equal(timelineCalls,1);assert.equal(changed.statusTone,'warning');
  record.captureIssues=[{code:'synthetic',reason:'Synthetic gap'}];
  assert.equal(project(values,context).captureIssues.length,1);assert.equal(timelineCalls,2);
  const other=project(values,{...context,gameId:'00000000-0000-4000-8000-000000000903'});
  assert.equal(other.publicEventCount,0);assert.equal(other.latestSnapshot,null);
});
