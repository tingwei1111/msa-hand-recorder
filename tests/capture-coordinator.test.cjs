'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWriteQueue}=require('../extension/capture-coordinator.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('every observed state stays ordered and immutable while a write is pending',async()=>{
 const hold=deferred(),saved=[];const queue=createWriteQueue({write:async payload=>{if(!saved.length)await hold.promise;saved.push(payload);return {ok:true};}});
 const original={hand:['A']};queue.enqueue(original);original.hand.push('mutation');queue.enqueue({hand:['B']});queue.enqueue({hand:['C']});
 assert.equal(queue.state().pendingCount,3);hold.resolve();assert.equal((await queue.flush()).ok,true);
 assert.deepEqual(saved.map(x=>x.hand),[['A'],['B'],['C']]);
});
test('write failure is retained and normal polling respects retry backoff',async()=>{
 let calls=0;const queue=createWriteQueue({write:async()=>{calls++;if(calls===1)throw new Error('quota');return {ok:true};}});
 queue.enqueue({id:1});await new Promise(setImmediate);await queue.retry();assert.equal(calls,1);assert.equal(queue.state().pendingCount,1);
 assert.equal((await queue.flush()).ok,true);assert.equal(calls,2);
});
test('flush timeout does not retry or acknowledge an unresolved write',async()=>{
 const hold=deferred();let calls=0;const queue=createWriteQueue({write:async()=>{calls++;await hold.promise;return {ok:true};}});
 queue.enqueue({id:1});assert.equal((await queue.flush(5)).ok,false);assert.equal(calls,1);assert.equal((await queue.flush(5)).ok,false);assert.equal(calls,1);
 hold.resolve();assert.equal((await queue.flush()).ok,true);
});
test('buffer overflow is explicit and suspended contexts never send queued old states',async()=>{
 const hold=deferred(),seen=[];const queue=createWriteQueue({maxPending:2,write:async p=>{seen.push(p.id);await hold.promise;return {ok:true};}});
 queue.enqueue({id:1});queue.enqueue({id:2});assert.equal(queue.enqueue({id:3}).accepted,false);assert.equal(queue.state().rejectedCount,1);
 queue.suspend('navigation');hold.resolve();await new Promise(setImmediate);assert.deepEqual(seen,[1]);assert.equal((await queue.flush()).ok,false);assert.equal(queue.state().pendingCount,1);
 const fresh=createWriteQueue({write:async p=>{seen.push(p.id);return {ok:true};}});fresh.enqueue({id:4});await fresh.flush();assert.deepEqual(seen,[1,4]);
});
