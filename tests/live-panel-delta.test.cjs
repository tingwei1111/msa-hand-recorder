'use strict';
// Synthetic saved observations only; no game events are inferred from deltas.
const test=require('node:test'),assert=require('node:assert/strict');
const live=require('../extension/live-panel-core.js');
const GAME='00000000-0000-4000-8000-000000000501';
const RUN='10000000-0000-4000-8000-000000000501';
const SESSION=GAME+'.'+RUN;
const context={gameId:GAME,runId:RUN,playerName:'Demo North',enabled:true,pendingCount:0,quality:'complete'};
const card=(cardCode,count)=>({cardCode,count});
function snapshot(number,overrides={}){
  return {id:SESSION+':'+number,timestamp:`2000-01-01T00:00:0${number}.000Z`,turn:1,turnSource:'log',observedTurn:1,
    activePlayer:'Demo North',phase:'MAIN',hand:[card('GD01-001',2)],expectedCount:2,unknownCount:0,quality:'complete',resources:null,...overrides};
}
function record(snapshots,overrides={}){
  return {schemaVersion:1,id:SESSION,gameId:GAME,playerName:'Demo North',startedAt:'2000-01-01T00:00:00.000Z',updatedAt:'2000-01-01T00:01:00.000Z',snapshots,...overrides};
}
function project(snapshots,options={}){
  const own=record(snapshots,options.record),values={['msa.session.'+own.id]:own,...options.values};
  return live.project(values,{...context,...options.context});
}
function notComparable(model){
  assert.equal(model.handDelta.comparable,false);
  assert.deepEqual(model.handDelta.added,[]);assert.deepEqual(model.handDelta.removed,[]);
  assert.ok(model.handDelta.reason);
}

test('same-run chronological complete observations compute exact increases and decreases without mutating stored data',()=>{
  const before=snapshot(1,{hand:[card('GD01-001',2),card('GD01-002',1)],expectedCount:3});
  const after=snapshot(2,{hand:[card('GD01-001',1),card('GD01-003',2)],expectedCount:3});
  const snapshots=[before,after],original=structuredClone(snapshots),model=project(snapshots);
  assert.equal(model.handDelta.comparable,true);
  assert.deepEqual(model.handDelta.added,[card('GD01-003',2)]);
  assert.deepEqual(model.handDelta.removed,[card('GD01-001',1),card('GD01-002',1)]);
  assert.match(model.handDelta.reason,/不推定/);assert.deepEqual(snapshots,original);
  model.handDelta.added[0].count=99;assert.equal(after.hand[1].count,2);
});

test('known empty hands can be compared, and distinct observations with unchanged cards produce an empty delta',()=>{
  const empty=snapshot(2,{hand:[],expectedCount:0});
  assert.deepEqual(project([snapshot(1),empty]).handDelta.removed,[card('GD01-001',2)]);
  const fromEmpty=project([snapshot(1,{hand:[],expectedCount:0}),snapshot(2)]);
  assert.equal(fromEmpty.handDelta.comparable,true);assert.deepEqual(fromEmpty.handDelta.added,[card('GD01-001',2)]);
  const unchanged=project([snapshot(1),snapshot(2,{phase:'END'})]);
  assert.equal(unchanged.handDelta.comparable,true);assert.deepEqual(unchanged.handDelta.added,[]);assert.deepEqual(unchanged.handDelta.removed,[]);
});

test('same-millisecond distinct saved observations retain sequence while equivalent card rows aggregate safely',()=>{
  const before=snapshot(1,{hand:[card('GD01-001',1),card('GD01-001',1)],expectedCount:2});
  const after=snapshot(2,{timestamp:before.timestamp,hand:[card('GD01-001',3)],expectedCount:3});
  const model=project([before,after]);assert.equal(model.handDelta.comparable,true);assert.deepEqual(model.handDelta.added,[card('GD01-001',1)]);
});

test('partial or unavailable observations on either side prevent comparison and no earlier complete row is substituted',()=>{
  for(const quality of ['partial','unavailable','not-a-quality']){
    notComparable(project([snapshot(1,{quality}),snapshot(2)]));
    notComparable(project([snapshot(1),snapshot(2,{quality})]));
  }
  notComparable(project([snapshot(1),snapshot(2,{quality:'partial'}),snapshot(3)]));
});

test('unknown-card counts, inconsistent totals and unrecognized cards never become a complete delta',()=>{
  for(const overrides of [
    {unknownCount:1},{unknownCount:null},{unknownCount:undefined},{expectedCount:3},
    {hand:[card('not-a-card',2)]},{hand:null},{hand:[card('GD01-001',0)]},
    {hand:[card('GD01-001',-1)]},{hand:[card('GD01-001',1.5)]},{hand:[card('GD01-001','2')]}
  ]){
    notComparable(project([snapshot(1,overrides),snapshot(2)]));
    notComparable(project([snapshot(1),snapshot(2,overrides)]));
  }
});

test('cross-source observations cannot compare, including two rows that both name a foreign source',()=>{
  const foreign=GAME+'.other-run';
  notComparable(project([snapshot(1,{sourceSessionId:foreign}),snapshot(2)]));
  notComparable(project([snapshot(1),snapshot(2,{sourceSessionId:foreign})]));
  notComparable(project([snapshot(1,{sourceSessionId:foreign}),snapshot(2,{sourceSessionId:foreign})]));
  assert.equal(project([snapshot(1,{sourceSessionId:SESSION}),snapshot(2,{sourceSessionId:SESSION})]).handDelta.comparable,true);
});

test('previous-run observations are never substituted for the missing current-run predecessor',()=>{
  const old=record([snapshot(1),snapshot(2)],{id:GAME+'.old-run'});
  notComparable(project([snapshot(3)],{values:{['msa.session.'+old.id]:old}}));
  notComparable(live.project({['msa.session.'+old.id]:old},context));
});

test('unconfirmed or mismatched player identity prevents any delta',()=>{
  notComparable(project([snapshot(1),snapshot(2)],{context:{playerName:''}}));
  notComparable(project([snapshot(1),snapshot(2)],{record:{playerName:'Demo South'}}));
});

test('repeated snapshot identity or a missing, blank or non-string identity prevents comparison',()=>{
  notComparable(project([snapshot(1),snapshot(2,{id:snapshot(1).id})]));
  for(const id of [undefined,null,'','   ',123]){
    notComparable(project([snapshot(1,{id}),snapshot(2)]));
    notComparable(project([snapshot(1),snapshot(2,{id})]));
  }
});

test('invalid, absent and backward timestamps cannot be used for a chronological delta',()=>{
  for(const timestamp of [undefined,null,'','not-a-date']){
    notComparable(project([snapshot(1,{timestamp}),snapshot(2)]));
    notComparable(project([snapshot(1),snapshot(2,{timestamp})]));
  }
  notComparable(project([snapshot(1,{timestamp:'2000-01-01T00:00:05.000Z'}),snapshot(2)]));
});

test('chronology compares actual instants across time-zone representations',()=>{
  const early=snapshot(1,{timestamp:'2026-10-25T10:00:00+08:00'});
  const late=snapshot(2,{timestamp:'2026-10-25T03:00:00Z'});
  assert.equal(project([early,late]).handDelta.comparable,true);
  notComparable(project([late,early]));
});
