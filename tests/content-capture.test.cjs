'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const coordinator=require('../extension/capture-coordinator.js'),core=require('../extension/recorder-core.js'),logCore=require('../extension/battle-log-core.js');
const game='00000000-0000-4000-8000-000000000101',other='22222222-2222-4222-8222-222222222222';
const settle=()=>new Promise(setImmediate);
function harness(options={}) {
 let now=Date.now(),run=0,listener,interval,storageListener,open=Boolean(options.open),opens=0,closes=0;
 const messages=[],sessions={},events={},timers=new Set();
 const state={phase:'MAIN',activeSide:'bottom',activePlayer:'Me',ended:false,card:'GD01-001',animating:false,logAvailable:true,...options.view};
 const location={pathname:'/game/'+game};
 const element=()=>({isConnected:true,append(){},remove(){this.isConnected=false;},attachShadow(){return {append(){}};}});
 const document={activeElement:null,documentElement:{append(){}},createElement:element,addEventListener(name,fn){events[name]=fn;}};
 const openButton={click(){open=true;opens++;}},closeButton={isConnected:true,click(){closes++;if(options.delayedClose){state.closingAt=now+options.delayedClose;}else open=false;}};
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const context=vm.createContext({console,Date:ClockDate,JSON,Map,Set,Promise,location,document,
  crypto:{randomUUID:()=>`11111111-1111-4111-8111-${String(++run).padStart(12,'0')}`},MSACaptureCoordinator:coordinator,
  setTimeout(fn,ms){const id=setTimeout(()=>{timers.delete(id);now+=ms;fn();},1);timers.add(id);return id;},
  setInterval(fn){interval=fn;},MutationObserver:class{observe(){}},
  MSARecorderDOM:{
   readDocument(){return {...state,logTurn:open?1:null};},
   selectHand(){return state.noHand?null:{quality:'complete',knownCount:1,expectedCount:1,unknownCount:0,hand:[{cardCode:state.card,count:1}],resources:{level:3,active:3},side:'bottom',playerName:'Me',animating:state.animating,reason:'visible'};},
   getBattleLogControls(){if(state.closingAt&&now>=state.closingAt)open=false;return {isOpen:open,openButton,closeButton,blockedReason:state.otherDialog?'another-dialog-open':''};},
   readBattleLog(){if(!open||!state.logAvailable)return null;const rows=[{text:'Game started!',sourceIndex:0},{text:'Turn 1 started!',sourceIndex:1}];if(state.ended&&state.hasEnd!==false)rows.push({text:'Game ended!',sourceIndex:2});return {observedAt:new ClockDate().toISOString(),rows,players:['Me','Them'],completeFromStart:true,ended:state.ended&&state.hasEnd!==false,order:'oldest-first'};}
  },chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn;}},async sendMessage(message){
   messages.push(structuredClone(message));if(message.type==='MSA_STATUS'||message.type==='MSA_CAPTURE_GAP')return {ok:true};
   if(message.type==='MSA_STAGE_RECORD')return options.stage?options.stage(message.payload):{ok:true,durable:true};
   async function save(item){
    const result=await options.beforeWrite?.(item);if(result)return result;
    const id=item.gameId+'.'+item.runId,session=sessions[id]||core.createSession({id,gameId:item.gameId,playerName:item.playerName});
    sessions[id]=item.type==='MSA_RECORD'?core.appendSnapshot(session,item.snapshot):logCore.ingest(session,item.batch);
    const saved=sessions[id];return {ok:true,id,snapshotCount:saved.snapshots.length,eventCount:saved.battleLog?.events?.length||0,coverage:saved.battleLog?.coverage||null};
   }
   if(message.type==='MSA_RECORD_BATCH'){
    const results=[];for(const item of message.observations){messages.push(structuredClone(item));results.push(await save(item));}
    return {ok:true,results};
   }
   return save(message);
  }},storage:{local:{async get(){return {'msa.settings':{enabled:true,autoCollectLog:false,...options.settings}};}},onChanged:{addListener(fn){storageListener=fn;}}}}
 });
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/content.js'),'utf8'),context);
 return {state,location,document,messages,sessions,async ready(){await settle();await new Promise(resolve=>setTimeout(resolve,5));await settle();},tick(){interval();},advance(ms){now+=ms;},
  interact(type){events[type]({type,isTrusted:true});},
  setSettings(value){storageListener({'msa.settings':{newValue:{enabled:true,autoCollectLog:false,...value}}},'local');},
  capture(message={}){return new Promise(resolve=>listener({type:'MSA_CAPTURE_NOW',gameId:game,reason:'export',...message},{id:'test'},resolve));},
  query(type){return new Promise(resolve=>listener({type},{id:'test'},resolve));},
  counts:()=>({opens,closes,open}),stop(){for(const id of timers)clearTimeout(id);}};
}
test('content queues each observed hand while earlier storage acknowledgement is pending',async()=>{
 let release;const held=new Promise(r=>release=r);let first=true;const h=harness({beforeWrite:async()=>{if(first){first=false;await held;}}});await h.ready();
 h.state.card='GD01-002';h.tick();h.state.card='GD01-003';h.tick();release();await h.ready();
 const result=await h.capture();assert.equal(result.refreshed,true);
 const cards=Object.values(h.sessions)[0].snapshots.filter(x=>x.turn===null).map(x=>x.hand[0].cardCode);
 assert.deepEqual(cards,['GD01-001','GD01-002','GD01-003']);h.stop();
});
test('animation observations are marked partial and a later complete state is retained',async()=>{
 const h=harness();await h.ready();h.state.animating=true;h.state.card='GD01-002';h.tick();h.state.animating=false;h.tick();await h.ready();
 assert.deepEqual(Object.values(h.sessions)[0].snapshots.map(x=>x.quality),['complete','partial','complete']);h.stop();
});
test('export opens and restores only its own drawer, including a closing animation',async()=>{
 const h=harness({delayedClose:400});await h.ready();const result=await h.capture();assert.equal(result.refreshed,true);assert.equal(result.restored,true);assert.deepEqual(h.counts(),{opens:1,closes:1,open:false});h.stop();
 const existing=harness({open:true});await existing.ready();assert.equal((await existing.capture()).restored,true);assert.equal(existing.counts().closes,0);existing.stop();
});
test('input focus and other dialogs prevent automatic UI interaction',async()=>{
 const h=harness();await h.ready();h.document.activeElement={tagName:'INPUT'};assert.equal((await h.capture()).code,'input-busy');assert.equal(h.counts().opens,0);
 h.document.activeElement=null;h.state.otherDialog=true;assert.equal((await h.capture()).code,'another-dialog-open');assert.equal(h.counts().opens,0);h.stop();
});
test('trusted wheel input revokes ownership and a different-game request cannot click',async()=>{
 const h=harness();await h.ready();const result=h.capture();h.interact('wheel');const response=await result;assert.equal(response.code,'user-interacted');assert.equal(h.counts().closes,0);
 const count=h.counts().opens;assert.equal((await h.capture({gameId:other})).code,'game-changed');assert.equal(h.counts().opens,count);h.stop();
});
test('navigation quarantines unsent old states without blocking the new game',async()=>{
 let release;const held=new Promise(r=>release=r);let first=true;const h=harness({beforeWrite:async()=>{if(first){first=false;await held;}}});await h.ready();
 h.state.card='GD01-002';h.tick();h.location.pathname='/game/'+other;h.state.card='GD01-003';h.tick();await h.ready();
 assert.ok(Object.values(h.sessions).some(s=>s.gameId===other));assert.ok(h.messages.some(m=>m.type==='MSA_CAPTURE_GAP'&&m.gameId===game));
 release();await h.ready();assert.equal(h.messages.filter(m=>m.type==='MSA_RECORD'&&m.gameId===game).length,1);h.stop();
});
test('automatic end capture retries a missing log and requires the end marker',async()=>{
 const h=harness({settings:{autoCollectLog:true},view:{ended:true,noHand:true,logAvailable:false}});await h.ready();
 for(let i=0;i<70;i++)await new Promise(r=>setTimeout(r,1));assert.equal(h.counts().opens,1);
 h.state.logAvailable=true;h.advance(7000);h.tick();for(let i=0;i<15;i++)await new Promise(r=>setTimeout(r,1));
 assert.equal(h.counts().opens,2);assert.ok(Object.values(h.sessions)[0].battleLog.coverage.gameEnded);assert.equal(h.counts().closes,2);h.stop();
});
test('an isolated hand remains partial after public Log refresh and its warning is not overwritten',async()=>{
 let rejectHand=false;
 const h=harness({open:true,beforeWrite:message=>rejectHand&&message.type==='MSA_RECORD'?
  {ok:false,retryable:false,code:'invalid-record-format',error:'synthetic invalid hand'}:undefined});
 try{
  await h.ready();h.state.ended=true;h.tick();await h.ready();
  assert.equal((await h.capture()).partial,false);
  rejectHand=true;h.state.card='GD01-002';h.tick();await h.ready();
  const result=await h.capture(),rescue=await h.query('MSA_RESCUE_QUERY');
  assert.equal(result.refreshed,true);assert.equal(result.partial,true);assert.equal(result.quarantinedCount,1);
  assert.equal(rescue.backup.records[0].quarantined.length,1);
  assert.ok(result.reasonParts.some(item=>item.code==='quarantined'&&item.params[0]===1));
  const status=h.messages.filter(message=>message.type==='MSA_STATUS').at(-1).status;
  assert.match(status.message,/格式異常已隔離/);assert.ok(status.messageParts.some(item=>item.code==='quarantined'));
  assert.equal((await h.query('MSA_DIAGNOSTICS_QUERY')).quarantinedCount,1);
 }finally{h.stop();}
});
test('structured status carries source templates and primitive parameters without interpolating them into keys',async()=>{
 const h=harness();try{
  await h.ready();await h.capture();
  const status=h.messages.filter(message=>message.type==='MSA_STATUS').at(-1).status;
  const saved=status.messageParts.find(item=>item.code==='saved-hand');
  assert.equal(saved.source,'已保存 {0} 筆手牌');assert.equal(typeof saved.params[0],'number');
  assert.ok(status.messageParts.every(item=>Array.isArray(item.params)));
 }finally{h.stop();}
});
test('failed durable staging never claims recovery protection and still permits ordinary recording',async()=>{
 const h=harness({stage:async()=>({ok:false,durable:false,error:'recovery-journal-full'}),beforeWrite:async()=>{throw new Error('synthetic local quota');}});
 try{
  await h.ready();const rescue=await h.query('MSA_RESCUE_QUERY');
  assert.equal(rescue.backup.records[0].recovery.durableCount,0);
  assert.ok(rescue.backup.records[0].recovery.unprotectedCount>0);
  const status=h.messages.filter(message=>message.type==='MSA_STATUS').at(-1).status;
  assert.ok(status.messageParts.some(item=>item.code==='recovery-unconfirmed'));
  assert.doesNotMatch(status.message,/救援原件已持久化/);
 }finally{h.stop();}
});
