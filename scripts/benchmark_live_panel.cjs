'use strict';
// Synthetic saved records only; excludes browser DOM, disk and real gameplay.
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const live=require('../extension/live-panel-core.js'),core=require('../extension/recorder-core.js'),battle=require('../extension/battle-log-core.js');
const gameId='00000000-0000-4000-8000-000000000901',runId='10000000-0000-4000-8000-000000000901',playerName='Synthetic North';
let session=core.createSession({id:gameId+'.'+runId,gameId,playerName,startedAt:'2000-01-01T00:00:00.000Z'});
for(let i=0;i<500;i++)session=core.appendSnapshot(session,{timestamp:new Date(Date.UTC(2000,0,1,0,0,i)).toISOString(),hand:[{cardCode:'GD01-001',count:i%4+1}],quality:'complete',unknownCount:0,expectedCount:i%4+1,turn:Math.floor(i/10)+1,turnSource:'log'});
session=battle.ingest(session,{observedAt:'2000-01-01T00:09:00.000Z',order:'oldest-first',completeFromStart:true,players:[playerName,'Synthetic South'],rows:[{text:'Game started!',sourceIndex:0},...Array.from({length:350},(_,i)=>({text:'Synthetic public event '+i,sourceIndex:i+1}))]});
const values={['msa.session.'+session.id]:session},context={gameId,runId,playerName,enabled:true,quality:'complete'};
function measure(expanded){const project=live.createProjector(),ctx={...context,panelExpanded:expanded};for(let i=0;i<8;i++)project(values,ctx);const samples=[];for(let i=0;i<30;i++){const start=performance.now();const model=project(values,ctx);samples.push(performance.now()-start);assert.equal(model.snapshotCount,500);}samples.sort((a,b)=>a-b);return {medianMs:+samples[15].toFixed(3),p95Ms:+samples[28].toFixed(3)};}
process.stdout.write(JSON.stringify({scope:'Synthetic repeated live-panel projection; excludes DOM, disk and actual gameplay',snapshots:500,publicEvents:351,warmups:8,runs:30,expanded:measure(true),collapsed:measure(false)},null,2)+'\n');
