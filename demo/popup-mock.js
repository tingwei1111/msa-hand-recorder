'use strict';
// UI-only synthetic match. This file is never packaged in the extension.
const previewGame='00000000-0000-4000-8000-000000000001';
let previewSession=MSARecorderCore.createSession({id:'demo-only',gameId:previewGame,playerName:'測試玩家',startedAt:'2026-10-24T03:00:00Z'});
function previewHand(turn,minute,cards){return {timestamp:`2026-10-24T03:0${minute}:00Z`,turn,turnSource:'log',observedTurn:turn,activePlayer:turn===1?'測試玩家':'測試對手',phase:'MAIN',hand:cards,expectedCount:cards.reduce((sum,c)=>sum+c.count,0),unknownCount:0,quality:'complete',reason:'visible-hand-dom-slots',resources:{level:6,active:4}};}
previewSession=MSARecorderCore.appendSnapshot(previewSession,previewHand(1,1,[{cardCode:'GD05-002',count:2},{cardCode:'ST04-010',count:1},{cardCode:'GD04-068',count:1}]));
previewSession=MSARecorderCore.appendSnapshot(previewSession,previewHand(1,2,[{cardCode:'GD05-002',count:2},{cardCode:'ST04-010',count:1}]));
previewSession=MSARecorderCore.appendSnapshot(previewSession,previewHand(2,3,[{cardCode:'GD05-002',count:2},{cardCode:'ST04-010',count:1}]));
const previewRows=[
 {text:'Game started!',actor:'',cards:[]},
 {text:'Choose to play first',actor:'測試玩家',cards:[]},
 {text:'Turn 1 started!',actor:'',cards:[]},
 {text:'Silver Bullet deployed',actor:'測試玩家',cards:[{cardCode:'GD04-068',name:'Silver Bullet'}]},
 {text:'Turn ended!',actor:'測試玩家',cards:[]},
 {text:'Turn 2 started!',actor:'',cards:[]},
 {text:'Rick Dias deployed',actor:'測試對手',cards:[{cardCode:'GD02-079',name:'Rick Dias'}]},
 {text:'Played command: A Show of Resolve',actor:'測試對手',cards:[{cardCode:'GD01-100',name:'A Show of Resolve'}]},
 {text:'Turn ended!',actor:'測試對手',cards:[]},
 {text:'Game ended!',actor:'',cards:[]}
].map((row,sourceIndex)=>({...row,sourceIndex}));
previewSession=MSABattleLogCore.ingest(previewSession,{observedAt:'2026-10-24T03:04:00Z',rows:previewRows,players:['測試玩家','測試對手'],order:'oldest-first',completeFromStart:true,ended:true});
const previewStorage={'msa.session.demo-only':previewSession,'msa.status.demo':{updatedAt:new Date().toISOString(),gameId:previewGame,message:'介面預覽：已儲存合成手牌觀察，並非實際對局',playerName:'測試玩家',quality:'complete'}};
const previewScenario=new URLSearchParams(location.search).get('scenario');
if(previewScenario==='segments'){
 const first=structuredClone(previewSession);first.id='demo-part-1';first.snapshots=first.snapshots.slice(0,2);delete first.battleLog;
 const second=structuredClone(previewSession);second.id='demo-part-2';second.snapshots=second.snapshots.slice(2);delete second.battleLog;second.startedAt='2026-10-24T03:03:00Z';
 const logs=structuredClone(previewSession);logs.id='demo-part-logs';logs.playerName='';logs.snapshots=[];logs.startedAt='2026-10-24T03:04:00Z';logs.updatedAt='2026-10-24T03:05:00Z';
 delete previewStorage['msa.session.demo-only'];
 previewStorage['msa.session.demo-part-1']=first;previewStorage['msa.session.demo-part-2']=second;previewStorage['msa.session.demo-part-logs']=logs;
}else if(previewScenario==='log-only'){
 previewSession.snapshots=[];previewSession.playerName='';
}else if(previewScenario==='unknown'){
 delete previewSession.battleLog;previewSession.snapshots=previewSession.snapshots.slice(0,2).map(s=>({...s,turn:null,turnSource:'phase-observed',observedTurn:1}));
}else if(previewScenario==='empty'){
 delete previewStorage['msa.session.demo-only'];delete previewStorage['msa.status.demo'];
}else if(previewScenario==='no-log'){
 delete previewSession.battleLog;
}else if(previewScenario==='partial'){
 const last=previewSession.snapshots.at(-1);last.quality='partial';last.expectedCount=4;last.unknownCount=1;last.reason='card-back-or-unreadable';
 previewStorage['msa.status.demo'].quality='partial';previewStorage['msa.status.demo'].message='部分卡牌尚未辨識，已保留已知觀察。';
}else if(previewScenario==='paused'){
 previewStorage['msa.settings']={enabled:false,handSide:'auto',autoCollectLog:true};
}else if(previewScenario==='save-error'){
 previewStorage['msa.status.demo'].quality='unavailable';previewStorage['msa.status.demo'].message='資料未儲存：invalid record format';
}else if(previewScenario==='long'){
 previewSession.playerName='合成示範玩家名稱很長時仍應完整保留並且可以閱讀';
}
const previewListeners=[];
window.chrome=window.chrome||{};
chrome.runtime={getURL(file){return '/demo/'+file.replace('review.html','review-preview.html');},async sendMessage(message){
 if(message.type==='MSA_SHOW_LIVE_PANEL')return {ok:false,reason:'此頁為合成小視窗預覽；請使用 demo/index.html 測試對戰側邊小窗。'};
 if(message.type==='MSA_PREPARE_EXPORT') {
  await new Promise(resolve=>setTimeout(resolve,500));
  if(previewScenario==='export-success')return {ok:true,refreshed:true,eventCount:previewSession.battleLog?.events?.length||0};
  return {ok:true,refreshed:false,reason:'此頁為合成資料預覽，沒有連線到 MSA'};
 }
 return {ok:false,reason:'非測試訊息'};
}};
chrome.storage={local:{async get(keys){
 if(previewScenario==='storage-error')throw new Error('合成測試：無法讀取本機儲存空間');
 if(keys==null)return {...previewStorage};
 return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in previewStorage).map(key=>[key,previewStorage[key]]));
},async set(values){
 if(previewScenario==='settings-error')throw new Error('合成測試：設定儲存失敗');
 const changes={};for(const[k,v]of Object.entries(values)){changes[k]={oldValue:previewStorage[k],newValue:v};previewStorage[k]=v;}previewListeners.forEach(fn=>fn(changes,'local'));
},async remove(key){const oldValue=previewStorage[key];delete previewStorage[key];previewListeners.forEach(fn=>fn({[key]:{oldValue}},'local'));}},onChanged:{addListener(fn){previewListeners.push(fn);}}};
