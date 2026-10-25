'use strict';
// Synthetic repeat-update benchmark; this is not Chrome frame-time evidence.
const {performance}=require('node:perf_hooks');
const path=require('node:path'),assert=require('node:assert/strict');
const current=require('../extension/deck-tracker-core.js');
const baseline=process.argv[2]?require(path.resolve(process.argv[2])):null;
const game='00000000-0000-4000-8000-000000009001',run='synthetic',player='Synthetic North';
const deck={schemaVersion:1,id:'synthetic-deck.v1',deckId:'synthetic-deck',name:'Synthetic 50',createdAt:'2000-01-01T00:00:00Z',
  main:Array.from({length:13},(_,i)=>({cardCode:`GD01-${String(i+1).padStart(3,'0')}`,count:i===12?2:4})),resources:[],tokens:[]};
function fixture(amount){
  const sessionId=game+'.'+run,snapshot={id:sessionId+':1',quality:'complete',expectedCount:2,unknownCount:0};
  const values={['msa.deck.'+deck.id]:deck,['msa.session.'+sessionId]:{schemaVersion:1,id:sessionId,gameId:game,playerName:player,snapshots:[snapshot]}};
  for(let i=0;i<amount;i++){
    const id='synthetic-'+i;values['msa.match.'+id]={schemaVersion:1,id,gameId:i?game.slice(0,-3)+String(i).padStart(3,'0'):game,
      playerName:player,source:'manual',identityConfirmed:true,updatedAt:'2000-01-01T00:00:00Z',deckVersionId:deck.id,
      frozenDeckVersion:structuredClone(deck),result:'win',resultConfirmed:true};
  }
  return {values,context:{gameId:game,runId:run,playerName:player},handModel:{sessionId,quality:'complete',latestSnapshot:snapshot,handCards:[{cardCode:'GD01-001',count:2}]},
    events:Array.from({length:350},()=>({action:'deploy-unit',isPlay:true,actor:player,primaryCard:{cardCode:'GD01-001',name:'Synthetic unit'}})),players:[player,'Synthetic South'],coverage:{publicLogComplete:false}};
}
function median(api,input){for(let i=0;i<8;i++)api.project(input);const times=[];for(let i=0;i<30;i++){const start=performance.now();api.project(input);times.push(performance.now()-start);}return +times.sort((a,b)=>a-b)[15].toFixed(3);}
const results=[1,100,500].map(matches=>{const input=fixture(matches);if(baseline)assert.deepEqual(current.project(input),baseline.project(input));
  return {matches,events:350,currentRepeatMedianMs:median(current,input),...(baseline?{baselineRepeatMedianMs:median(baseline,input)}:{})};});
process.stdout.write(JSON.stringify({runtime:process.version,scope:'Repeated identical synthetic projection; excludes DOM, disk and actual gameplay',warmups:8,runs:30,results},null,2)+'\n');
