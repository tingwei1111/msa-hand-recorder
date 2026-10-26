'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../extension/recovery-journal.js');
const {createIndexedDBFixture}=require('./fixtures/recovery-idb.cjs');
const GAME='00000000-0000-4000-8000-000000000911',RUN='10000000-0000-4000-8000-000000000911';
const source={tabId:7,documentId:'synthetic-document'};
const record=sequence=>({type:'MSA_RECORD',gameId:GAME,runId:RUN,sequence,playerName:'Synthetic',snapshot:{phase:'MAIN-'+sequence,hand:[]}});
const tick=()=>new Promise(setImmediate);
test('durable acknowledgement waits for IDB commit and a new instance reads the same originals',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});fixture.holdCommit();
 let acknowledged=false;const pending=journal.stage(record(1),source).then(value=>{acknowledged=true;return value;});
 await tick();await tick();assert.equal(acknowledged,false);fixture.releaseCommit();assert.equal((await pending).durable,true);
 const restarted=api.create({indexedDB:fixture.indexedDB}),backup=await restarted.backup();
 assert.equal(backup.records.length,1);assert.deepEqual(backup.records[0].payload,record(1));assert.equal(backup.records[0].state,'unconfirmed');
});
test('IDB open and commit failures never produce a durable success',async()=>{
 const unavailable=api.create({indexedDB:{open(){const req={error:new Error('synthetic denied')};queueMicrotask(()=>req.onerror());return req;}}});
 await assert.rejects(unavailable.stage(record(1),source),/synthetic denied/);
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});fixture.abortNextCommit();
 await assert.rejects(journal.stage(record(1),source),/synthetic commit abort/);assert.equal((await journal.backup()).records.length,0);
});
test('journal quotas never evict prior originals and concurrent stages respect one global bound',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB,limits:{entries:2}});
 const outcomes=await Promise.allSettled([1,2,3].map(n=>journal.stage(record(n),source)));
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,2);assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/journal-full/);
 const backup=await journal.backup();assert.deepEqual(backup.records.map(r=>r.sequence),[1,2]);
 await journal.complete([record(1)]);assert.equal((await journal.stage(record(3),source)).durable,true);
 const bytes=api.create({indexedDB:fixture.indexedDB,databaseName:'small-bytes',limits:{bytes:1}});
 await assert.rejects(bytes.stage(record(1),source),/journal-full/);
 await assert.rejects(journal.stage({...record(4),snapshot:{raw:'x'.repeat(api.LIMITS.entryBytes)}},source),/entry-too-large/);
});
test('same sequence retry is idempotent while changed payload/source cannot replace an original',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});await journal.stage(record(1),source);
 assert.equal((await journal.stage(record(1),source)).existing,true);
 await assert.rejects(journal.stage({...record(1),playerName:'Other'},source),/sequence-conflict/);
 await assert.rejects(journal.stage(record(1),{...source,documentId:'other'}),/sequence-conflict/);
 assert.equal((await journal.backup()).records[0].payload.playerName,'Synthetic');
});
test('cleanup commit failure leaves an explicitly unconfirmed original available after restart',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});await journal.stage(record(1),source);
 fixture.abortNextCommit();await assert.rejects(journal.complete([record(1)]),/synthetic commit abort/);
 const backup=await api.create({indexedDB:fixture.indexedDB}).backup();assert.equal(backup.records.length,1);assert.equal(backup.records[0].state,'unconfirmed');
});
test('cleanup queued during a slow stage executes after that commit and does not resurrect the original',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});fixture.holdCommit();
 const stage=journal.stage(record(1),source);await tick();await tick();
 const completion=journal.complete([record(1)]);fixture.releaseCommit();await stage;await completion;
 assert.equal((await journal.backup()).records.length,0);
});
test('journal identities and sources are explicit and originals are copied on entry/export',async()=>{
 const fixture=createIndexedDBFixture(),journal=api.create({indexedDB:fixture.indexedDB});
 await assert.rejects(journal.stage({...record(1),sequence:0},source),/invalid-identity/);
 await assert.rejects(journal.stage(record(1),{tabId:7}),/invalid-source/);
 const input=record(1);const operation=journal.stage(input,source);input.playerName='mutated';await operation;
 const a=await journal.backup();a.records[0].payload.playerName='changed export';
 assert.equal((await journal.backup()).records[0].payload.playerName,'Synthetic');
});
