'use strict';
const testGame='00000000-0000-4000-8000-000000000001';
history.replaceState({},'',`/game/${testGame}`);
const database={'msa.settings':{enabled:true,handSide:'auto',autoCollectLog:false}};const changeListeners=[];
const captureMessageListeners=[];
let fixtureCloseDelayMs=0;
let fixtureWriteFailure=false;
window.chrome=window.chrome||{};
chrome.storage={
 local:{
  async get(keys){if(keys===null)return {...database};return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in database).map(k=>[k,database[k]]));},
  async set(values){const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:database[key],newValue:value};database[key]=value;}changeListeners.forEach(fn=>fn(changes,'local'));},
  async remove(key){delete database[key];}
 },onChanged:{addListener(fn){changeListeners.push(fn);},removeListener(fn){const index=changeListeners.indexOf(fn);if(index>=0)changeListeners.splice(index,1);}}
};
chrome.runtime={id:'synthetic-extension',onMessage:{addListener(fn){captureMessageListeners.push(fn);}},async sendMessage(msg){
 if(msg.type==='MSA_STATUS'){database.status=msg.status;return {ok:true};}
 if(msg.type==='MSA_OPEN_LIVE_REVIEW'){
  const saved=database['msa.session.'+msg.gameId+'.'+msg.runId];
  if(!saved)return {ok:false,reason:'本段尚無合成記錄'};
  const url=URL.createObjectURL(new Blob([MSABattleLogCore.toHTML(saved)],{type:'text/html;charset=utf-8'}));
  window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);
  return {ok:true,opened:true};
 }
 if(!['MSA_RECORD','MSA_LOG'].includes(msg.type))return {ok:false,error:'Unexpected fixture message'};
 if(database['msa.settings']?.enabled===false)return {ok:true,paused:true};
 if(fixtureWriteFailure)return {ok:false,error:'合成測試：儲存失敗，尚未寫入本機'};
 const key='msa.session.'+msg.gameId+'.'+msg.runId;
 const base=database[key]||MSARecorderCore.createSession({id:msg.gameId+'.'+msg.runId,gameId:msg.gameId,playerName:msg.playerName});
 if(!base.playerName&&msg.playerName)base.playerName=msg.playerName;
 const saved=msg.type==='MSA_LOG'?MSABattleLogCore.ingest(base,msg.batch):MSARecorderCore.appendSnapshot(base,msg.snapshot);
 await chrome.storage.local.set({[key]:saved});
 return {ok:true,id:saved.id,snapshotCount:saved.snapshots.length,eventCount:saved.battleLog?.events?.length||0,coverage:saved.battleLog?.coverage||null};
}};
function makeCard(code,ref,back=false){
 const slot=document.createElement('div');slot.className='slot';slot.dataset.layoutId=ref;
 const flip=document.createElement('div');flip.dataset.flippableCard='true';flip.style.transform=back?'rotateY(180deg)':'none';
 for(const isBack of [true,false]){
  const face=document.createElement('div');face.className=isBack||back?'card-back':'card-front';
  const img=document.createElement('img');img.alt='card';img.src=`/demo/cards/${isBack||back?'back':code}.svg`;face.append(img);flip.append(face);
 }slot.append(flip);return slot;
}
function setHand(codes,options={}){
 const own=document.getElementById('own-hand');own.replaceChildren();
 if(options.counter){const button=document.createElement('button');button.className='info-counter-button';button.textContent=codes.length;own.append(button);}
 codes.forEach((code,i)=>own.append(makeCard(code,'own-'+i,code==='back')));
 if(options.duplicate&&codes.length)own.append(makeCard(codes[0],'own-0'));
}
function active(side){
 document.querySelector('.top ._battleAreaBox_fixture').style.zIndex=side==='top'?'10':'9';
 document.querySelector('._gridContainer_fixture:not(.top) ._battleAreaBox_fixture').style.zIndex=side==='bottom'?'10':'9';
}
function reset(){setHand(['GD05-002','GD05-002','ST04-010']);active('bottom');closeLog();document.getElementById('fixture-ended')?.remove();}
function closeLog(){document.querySelector('[role="dialog"]')?.remove();}
function appendLogText(paragraph,row){
 let offset=0;
 for(const card of row.cards||[]){
  const index=row.text.indexOf(card.name,offset);
  if(index<0)continue;
  paragraph.append(document.createTextNode(row.text.slice(offset,index)));
  const link=document.createElement('a');link.href='#'+card.cardCode;link.textContent=card.name;paragraph.append(link);
  offset=index+card.name.length;
 }
 paragraph.append(document.createTextNode(row.text.slice(offset)));
}
// Match the observed MSA structure: a Drawer body contains one flex list;
// actor rows have an optional direct P label and a nested bubble paragraph,
// while system rows have dividers and a nested paragraph, with no actor label.
function openLog(rows){
 closeLog();
 const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.className='fixture-log panel';
 const heading=document.createElement('h2');heading.textContent='Mobile Suit Arena - Battle logs';
 const body=document.createElement('div');body.className='mantine-Drawer-body';
 const list=document.createElement('div');list.style.display='flex';list.style.flexDirection='column';list.append(document.createElement('div'));
 const actors=[...new Set(rows.map(row=>row.actor).filter(Boolean))];
 let previousActor='';
 for(const row of rows){
  const block=document.createElement('div');block.style.display='flex';
  const content=document.createElement('div');const paragraph=document.createElement('p');appendLogText(paragraph,row);content.append(paragraph);
  if(row.actor){
   block.style.flexDirection='column';block.style.alignItems=actors.indexOf(row.actor)===0?'flex-end':'flex-start';
   if(row.actor!==previousActor){const label=document.createElement('p');label.textContent=row.actor;block.append(label);}
   const bubble=document.createElement('div');bubble.className='fixture-log-bubble';bubble.append(content);block.append(bubble);
  }else{
   block.style.alignItems='center';block.append(document.createElement('div'),content,document.createElement('div'));
  }
  list.append(block);previousActor=row.actor||'';
 }
 const closeButton=document.createElement('button');closeButton.className='mantine-Drawer-close';closeButton.textContent='關閉日誌';closeButton.onclick=()=>fixtureCloseDelayMs ? setTimeout(closeLog,fixtureCloseDelayMs) : closeLog();
 body.append(list);dialog.append(heading,closeButton,body);document.body.append(dialog);return dialog;
}
const sampleLogRows=[
 {text:'Game started!',actor:'',cards:[]},
 {text:'Turn 1 started!',actor:'',cards:[]},
 {text:'Rick Dias deployed',actor:'測試對手',cards:[{cardCode:'GD02-079',name:'Rick Dias'}]},
 {text:'Rick Dias deployed',actor:'測試對手',cards:[{cardCode:'GD02-079',name:'Rick Dias'}]},
 {text:'Turn ended!',actor:'',cards:[]},
 {text:'Turn 2 started!',actor:'',cards:[]},
 {text:'Silver Bullet deployed',actor:'測試玩家',cards:[{cardCode:'GD04-068',name:'Silver Bullet'}]},
 {text:'Passed',actor:'測試玩家',cards:[]}
];
document.getElementById('opponent-hand').append(makeCard('back','opponent-0',true),makeCard('back','opponent-1',true));
const gameIdFromLocation=()=>location.pathname.split('/')[2];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const read=()=>MSARecorderDOM.readDocument(document);
const own=()=>read().candidates.find(item=>item.side==='bottom');
const sessions=()=>Object.entries(database).filter(([key])=>key.startsWith('msa.session.')).map(([,value])=>value);
function show(){const snapshot=read();const hand=own();document.getElementById('reading').textContent=JSON.stringify({hand:hand?.hand,total:hand?.expectedCount,unknown:hand?.unknownCount,quality:hand?.quality,activePlayer:snapshot.activePlayer,logTurn:snapshot.logTurn,savedSnapshots:sessions().reduce((n,s)=>n+s.snapshots.length,0),savedPublicEvents:sessions().reduce((n,s)=>n+(s.battleLog?.events?.length||0),0),visibleLog:MSARecorderDOM.readBattleLog(document)?.rows.length||0},null,2);}
document.getElementById('draw').onclick=()=>setHand(['GD05-002','GD05-002','ST04-010','GD04-068']);
document.getElementById('switch').onclick=()=>active(read().activeSide==='bottom'?'top':'bottom');
document.getElementById('empty').onclick=()=>setHand([]);
document.getElementById('reset').onclick=reset;
document.getElementById('open-log').onclick=()=>openLog(sampleLogRows);
document.getElementById('close-log').onclick=closeLog;
if(document.getElementById('show-live')){
 document.getElementById('show-live').onclick=()=>captureMessageListeners[0]?.({type:'MSA_LIVE_PANEL_SHOW'},{id:chrome.runtime.id},()=>{});
 document.getElementById('unreadable').onclick=()=>setHand(['back']);
 document.getElementById('token-log').onclick=()=>openLog([...sampleLogRows,{text:'Parts deployed',actor:'測試玩家',cards:[{cardCode:'T-021',name:'Parts'}]}]);
 document.getElementById('write-error').onclick=()=>{
  fixtureWriteFailure=!fixtureWriteFailure;
  document.getElementById('write-error').textContent=fixtureWriteFailure?'恢復儲存':'模擬儲存失敗';
  if(fixtureWriteFailure)setHand(['ST04-010','GD04-068']);
 };
 document.getElementById('pause-recording').onclick=async()=>{
  const enabled=database['msa.settings'].enabled===false;
  await chrome.storage.local.set({'msa.settings':{enabled,handSide:'auto',autoCollectLog:false}});
  document.getElementById('pause-recording').textContent=enabled?'暫停記錄':'恢復記錄';
 };
 document.getElementById('new-game').onclick=()=>{
  closeLog();setHand([]);
  const next=gameIdFromLocation()===testGame?'00000000-0000-4000-8000-000000000002':testGame;
  history.replaceState({},'',`/game/${next}`);
 };
 document.getElementById('leave-game').onclick=()=>{
  const onGame=location.pathname.startsWith('/game/');
  history.replaceState({},'',onGame?'/':`/game/${testGame}`);
  document.getElementById('leave-game').textContent=onGame?'回到對局':'離開對局';
  if(!onGame)reset();
 };
 document.getElementById('other-dialog').onclick=()=>{
  closeLog();const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','合成遊戲確認視窗');
  dialog.style.cssText='position:fixed;inset:15% 15%;padding:30px;background:#f5f6f2;color:#17313b;border:2px solid #087f75;z-index:2000;border-radius:12px;';
  const title=document.createElement('h2');title.textContent='合成遊戲確認視窗';
  const note=document.createElement('p');note.textContent='對戰小窗應暫時隱藏，讓玩家處理此視窗。';
  const close=document.createElement('button');close.textContent='關閉測試視窗';close.onclick=()=>dialog.remove();dialog.append(title,note,close);document.body.append(dialog);
 };
}
document.getElementById('run-tests').onclick=async()=>{
 const button=document.getElementById('run-tests');button.disabled=true;
 const results=document.getElementById('results');results.replaceChildren();
 let passed=0,failed=0;
 async function check(label,fn){const item=document.createElement('li');try{await fn();item.textContent='PASS · '+label;item.className='pass';passed++;}catch(error){item.textContent='FAIL · '+label+'：'+error.message;item.className='fail';failed++;}results.append(item);show();}
 await check('玩家手牌沒有數量按鈕，仍辨識 3 張及同卡 2 張',()=>{reset();assert(own().quality==='complete','不是完整手牌');assert(own().expectedCount===3,'數量錯');assert(own().hand[0].count===2,'同卡未合併');});
 await check('正反面及重複動畫節點不重複計數',()=>{setHand(['GD05-002','GD05-002','ST04-010'],{duplicate:true});assert(own().expectedCount===3,'動畫重複計數');assert(own().knownCount===3,'卡片多算');});
 await check('卡背含有隱藏正面圖片時，不讀取該卡號',()=>{setHand(['GD05-002']);document.querySelector('#own-hand [data-flippable-card]').style.transform='rotateY(180deg)';assert(own().knownCount===0,'讀到背面的卡號');assert(own().unknownCount===1,'未知張數錯');});
 await check('缺少圖片卡號保留為未知，不當成空手',()=>{setHand(['back']);assert(own().quality==='unavailable','品質錯');assert(own().unknownCount===1,'未保留未知');});
 await check('空手與未知手牌區分',()=>{setHand([]);assert(own().quality==='complete'&&own().expectedCount===0,'空手錯');});
 await check('資源保留一般可用、EX 與合計，不把 EX 漏掉',()=>{
  const counter=document.querySelector('._gridContainer_fixture:not(.top) button');
  counter.textContent='Lv. 4• 3+1Use EX';
  assert(own().resources.active===3&&own().resources.exActive===1&&own().resources.totalActive===4,'EX未辨識');
  counter.textContent='Lv. 5 • 4';
 });
 await check('日誌按鈕只接受已驗證的開啟與關閉控制',()=>{
  closeLog();const controls=MSARecorderDOM.getBattleLogControls(document);
  assert(!controls.isOpen&&controls.openButton?.id==='open-log','未識別精確Log按鈕');
  openLog(sampleLogRows);assert(MSARecorderDOM.getBattleLogControls(document).closeButton?.classList.contains('mantine-Drawer-close'),'未識別關閉按鈕');
  closeLog();
 });
 await check('自動選擇下方玩家，不選對手卡背',()=>{reset();assert(MSARecorderDOM.selectHand(read(),{handSide:'auto',playerName:''},null)?.playerName==='測試玩家','玩家選錯');assert(MSARecorderDOM.selectHand(read(),{handSide:'auto',playerName:'別人'},null)===null,'未遵守暱稱');});
 await check('自己空手時，不會誤鎖對手暫時公開的回手卡',()=>{setHand([]);document.getElementById('opponent-hand').replaceChildren(makeCard('GD04-068','opponent-0'));assert(MSARecorderDOM.selectHand(read(),{handSide:'auto',playerName:''},null)===null,'誤選對手');document.getElementById('opponent-hand').replaceChildren(makeCard('back','opponent-0',true));});
 await check('旁觀者數量按鈕不會被當成玩家身分',()=>{setHand(['GD05-002'],{counter:true});assert(MSARecorderDOM.selectHand(read(),{handSide:'auto',playerName:''},null)===null,'誤錄旁觀者');});
 await check('完整顯示後自動儲存，不需按錄製或截圖',async()=>{reset();await pause(800);assert(sessions().length>0,'沒有建立紀錄');assert(sessions().at(-1).snapshots.at(-1).hand[0].count===2,'儲存數量錯');});
 await check('同一回合沒有變化不重複寫入',async()=>{const n=sessions().at(-1).snapshots.length;await pause(650);assert(sessions().at(-1).snapshots.length===n,'重複紀錄');});
 await check('動畫中保留部分觀察，穩定後才標完整，並保留回合來源',async()=>{const n=sessions().at(-1).snapshots.length;setHand(['GD05-002','GD05-002','ST04-010','GD04-068']);const slot=document.querySelector('#own-hand [data-layout-id]');slot.classList.add('is-animating');await pause(650);assert(sessions().at(-1).snapshots.length>n,'動畫觀察被吞掉');assert(sessions().at(-1).snapshots.at(-1).quality==='partial','動畫被當成完整');active('top');slot.classList.remove('is-animating');await pause(650);const s=sessions().at(-1).snapshots.at(-1);assert(s.activePlayer==='測試對手'&&s.expectedCount===4&&s.quality==='complete','動畫後狀態不符');});
 await check('快速連續三次可見手牌變化全部保留，不被穩定等待吞掉',async()=>{
  const n=sessions().at(-1).snapshots.length;
  setHand(['GD05-002']);await pause(25);
  setHand(['GD05-002','GD05-002']);await pause(25);
  setHand(['GD05-002','GD05-002','GD05-002']);await pause(450);
  const counts=sessions().at(-1).snapshots.slice(n).map(s=>s.expectedCount);
  assert([1,2,3].every(n=>counts.includes(n)),'連續變化缺漏：'+counts.join(','));
 });
 await check('手牌不變但換回合，會新增一筆',async()=>{const previous=sessions().at(-1).snapshots.at(-1);const n=sessions().at(-1).snapshots.length;active(read().activeSide==='top'?'bottom':'top');await pause(650);const s=sessions().at(-1);assert(s.snapshots.length>n,'漏記換回合');assert(s.snapshots.at(-1).observedTurn===previous.observedTurn+1,'回合編號錯');});
 await check('可見 Battle Log 將當前觀察校準為 T12',async()=>{const dialog=document.createElement('section');dialog.setAttribute('role','dialog');const h=document.createElement('h2');h.textContent='Mobile Suit Arena - Battle logs';const p=document.createElement('p');p.textContent='Turn 12 started!';dialog.append(h,p);document.body.append(dialog);await pause(650);assert(sessions().at(-1).snapshots.at(-1).turn===12,'校準錯');});
 await check('後續回合標示推計 T13，不冒充 log 確認',async()=>{document.querySelector('[role="dialog"]').remove();active(read().activeSide==='top'?'bottom':'top');await pause(650);const s=sessions().at(-1).snapshots.at(-1);assert(s.turn===13&&s.turnSource==='phase-observed','來源錯');});
 await check('手牌容器消失保留缺漏，恢復後不跨缺漏猜增減',async()=>{const container=document.getElementById('own-hand');container.classList.remove('_handContainer_fixture');await pause(450);assert(sessions().at(-1).snapshots.at(-1).reason==='hand-container-missing','未記缺漏');container.classList.add('_handContainer_fixture');await pause(650);const s=sessions().at(-1).snapshots.at(-1);assert(s.quality==='complete'&&s.delta===null,'跨缺漏推斷');});
 await check('暫停時不再保存手牌變更',async()=>{const n=sessions().reduce((x,s)=>x+s.snapshots.length,0);await chrome.storage.local.set({'msa.settings':{enabled:false,handSide:'auto',autoCollectLog:false}});setHand(['GD04-068']);await pause(650);assert(sessions().reduce((x,s)=>x+s.snapshots.length,0)===n,'暫停失效');});
 await chrome.storage.local.set({'msa.settings':{enabled:true,handSide:'auto',autoCollectLog:false}});reset();
 await check('真實 Drawer 結構：同玩家省略名字、system row 與卡號連結都保留',()=>{
  openLog(sampleLogRows);const batch=MSARecorderDOM.readBattleLog(document);
  assert(batch.structure==='msa-drawer-v1'&&batch.completeFromStart,'未讀到實際結構');
  assert(batch.rows.length===8,'事件列數錯');assert(batch.rows[0].actor==='','system row 誤有玩家');
  assert(batch.rows[2].actor==='測試對手'&&batch.rows[3].actor==='測試對手','省略名字的玩家錯');
  assert(batch.rows[6].actor==='測試玩家'&&batch.rows[7].actor==='測試玩家','另一玩家名字錯');
  assert(batch.rows[2].text==='Rick Dias deployed'&&batch.rows[2].cards[0].cardCode==='GD02-079','原文或卡號錯');
 });
 await check('兩次完全相同的公開出牌都保存，不以文字 Set 刪除',async()=>{
  await pause(1200);const saved=sessions().at(-1);
  assert(saved.battleLog?.events.length===8,'公開事件未保存');
  assert(saved.battleLog.events.filter(event=>event.rawText==='Rick Dias deployed').length===2,'重複出牌遭刪除');
 });
 await check('關閉 Log 時不讀隱藏內容；重新開啟同歷史不重複保存',async()=>{
  const dialog=document.querySelector('[role="dialog"]');dialog.style.display='none';
  assert(MSARecorderDOM.readBattleLog(document)===null,'仍讀隱藏 Log');
  closeLog();await pause(900);const n=sessions().at(-1).battleLog.events.length;
  openLog(sampleLogRows);await pause(1000);assert(sessions().at(-1).battleLog.events.length===n,'重新開啟造成重複');
 });
 await check('沒有卡號連結的公開文字保留原文，不猜卡號',()=>{
  openLog([{text:'Turn 3 started!',actor:'',cards:[]},{text:'Silver Bullet deployed',actor:'測試玩家',cards:[]}]);
  const batch=MSARecorderDOM.readBattleLog(document);assert(batch.rows[1].text==='Silver Bullet deployed','漏掉原文');
  assert(batch.rows[1].cards.length===0&&!batch.completeFromStart,'憑名稱猜卡號或誤稱完整');closeLog();
 });
 let fullLog;
 await check('完全合成的 537 列測試日誌可由相同 DOM 結構完整讀出',async()=>{
  fullLog=MSASyntheticFixtures.createBatch(537);openLog(fullLog.rows);
  const batch=MSARecorderDOM.readBattleLog(document);assert(batch.rows.length===537,'漏列');
  assert(batch.completeFromStart&&batch.ended,'首尾完整性錯');
  assert(JSON.stringify(batch.rows.map(row=>[row.text,row.actor,row.cards]))===JSON.stringify(fullLog.rows.map(row=>[row.text,row.actor,row.cards])),'原文、玩家或卡號不符');
  closeLog();
 });
 await check('賽後整批匯入按各自 Turn 分段，不能全歸到擷取時的 T24',()=>{
  assert(fullLog?.rows.length===537,'尚未載入樣本');
  const session=MSABattleLogCore.ingest(MSARecorderCore.createSession({id:'late-log',gameId:testGame}),fullLog);
  let expectedTurn=null;
  session.battleLog.events.forEach(event=>{const match=event.rawText.match(/^Turn (\d+) started!$/);if(match)expectedTurn=Number(match[1]);assert(event.turn===expectedTurn,'事件被歸錯回合：'+event.rawText);});
  assert(session.battleLog.events.find(event=>event.rawText==='Sample Unit Alpha deployed')?.turn===1,'早期出牌回合錯');
  assert(session.battleLog.events.at(-1).turn===24,'末回合錯');assert(session.snapshots.length===0,'捏造手牌');
 });
 await check('已結束對局仍自動收錄公開 Log，不捏造過去手牌',async()=>{
  assert(fullLog?.rows.length===537,'尚未載入樣本');
  const snapshotsBefore=sessions().reduce((sum,session)=>sum+session.snapshots.length,0);
  const ended=document.createElement('h2');ended.id='fixture-ended';ended.textContent='Winner: Demo South';document.body.append(ended);
  const endedGame='00000000-0000-4000-8000-000000000002';history.replaceState({},'',`/game/${endedGame}`);openLog(fullLog.rows);
  await pause(1400);const saved=sessions().find(session=>session.gameId===endedGame);
  assert(saved?.battleLog?.events.length===537,'結束後沒有收錄公開事件');assert(saved.snapshots.length===0,'結束後捏造手牌');
  assert(sessions().reduce((sum,session)=>sum+session.snapshots.length,0)===snapshotsBefore,'結束頁產生多餘手牌');
 });
 await check('暫停同時停止手牌與公開 Log，開啟日誌也不新增紀錄',async()=>{
  await chrome.storage.local.set({'msa.settings':{enabled:false,handSide:'auto',autoCollectLog:false}});
  const before=JSON.stringify(sessions());history.replaceState({},'',`/game/00000000-0000-4000-8000-000000000003`);
  reset();openLog(sampleLogRows);setHand(['GD04-068']);await pause(1100);
  assert(JSON.stringify(sessions())===before,'暫停後仍儲存');
 });
 await check('明確匯出會自動開 Log、寫完資料後回覆，再恢復關閉',async()=>{
  const exportGame='00000000-0000-4000-8000-000000000004';
  history.replaceState({},'',`/game/${exportGame}`);reset();
  await chrome.storage.local.set({'msa.settings':{enabled:true,handSide:'auto',autoCollectLog:false}});
  await pause(200);
  fixtureCloseDelayMs=220;
  const result=await new Promise(resolve=>captureMessageListeners[0]({type:'MSA_CAPTURE_NOW',gameId:exportGame,reason:'export'}, {},resolve));
  fixtureCloseDelayMs=0;
  const saved=sessions().find(s=>s.gameId===exportGame);
  assert(result.refreshed&&result.pendingCount===0&&result.restored,'匯出前未完成擷取/儲存/關閉動畫：'+JSON.stringify(result));
  assert(saved?.battleLog?.events.length===8,'公開Log未保存');
  assert(saved.snapshots.length>0,'手牌未保存');
  assert(!MSARecorderDOM.getBattleLogControls(document).isOpen,'擷取後未恢復原本關閉');
 });
 await check('輸入框聚焦時，匯出不自動開 Log 干擾輸入',async()=>{
  const input=document.createElement('input');document.body.append(input);input.focus();closeLog();
  const result=await new Promise(resolve=>captureMessageListeners[0]({type:'MSA_CAPTURE_NOW',gameId:gameIdFromLocation(),reason:'export'}, {},resolve));
  input.remove();
  assert(!result.refreshed&&result.code==='input-busy','操作中仍開啟Log');
  assert(!MSARecorderDOM.getBattleLogControls(document).isOpen,'輸入中顯示了Log');
 });
 await check('賽後自動收錄結束標記，無須手動開啟 Log',async()=>{
  document.getElementById('open-log').onclick=()=>openLog([...sampleLogRows,{text:'Game ended!',actor:'',cards:[]}]);
  const ended=document.createElement('h2');ended.id='fixture-ended';ended.textContent='Game Ended!';document.body.append(ended);
  await chrome.storage.local.set({'msa.settings':{enabled:true,handSide:'auto',autoCollectLog:true}});
  await pause(1900);
  const saved=sessions().find(s=>s.gameId===gameIdFromLocation());
  assert(saved?.battleLog?.coverage.publicLogComplete,'未自動收錄整場起尾');
  assert(!MSARecorderDOM.getBattleLogControls(document).isOpen,'結束收錄後未恢復關閉');
  document.getElementById('open-log').onclick=()=>openLog(sampleLogRows);
 });
 closeLog();document.getElementById('fixture-ended')?.remove();history.replaceState({},'',`/game/${testGame}`);
 await chrome.storage.local.set({'msa.settings':{enabled:true,handSide:'auto',autoCollectLog:false}});reset();
 const summary=document.createElement('li');summary.id='test-summary';summary.textContent=`${passed} passed / ${failed} failed`;summary.className=failed?'fail':'pass';results.append(summary);button.disabled=false;show();
};
reset();setInterval(show,300);
