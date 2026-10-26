'use strict';

// Pure saved-data fixtures: these tests do not establish live-match coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const live = require('../extension/live-panel-core.js');

const GAME = '00000000-0000-4000-8000-000000000301';
const OTHER_GAME = '00000000-0000-4000-8000-000000000302';
const WHEN = '2000-01-01T00:00:00.000Z';
const context = overrides => ({gameId:GAME, runId:'current', playerName:'Demo North', enabled:true,
  pendingCount:0, writeError:'', captureNote:'', statusMessage:'', quality:'complete', ...overrides});
const session = (overrides = {}) => core.createSession({id:`${GAME}.current`, gameId:GAME,
  playerName:'Demo North', startedAt:WHEN, ...overrides});
const store = (...records) => Object.fromEntries(records.map(record => [`msa.session.${record.id}`,record]));
const hand = (record, overrides = {}) => core.appendSnapshot(record, {timestamp:WHEN, turn:1,
  turnSource:'log', observedTurn:1, activePlayer:'Demo North', phase:'MAIN',
  hand:[{cardCode:'GD01-001',count:2}], expectedCount:2, unknownCount:0, quality:'complete',
  resources:{level:3,active:2,exActive:1}, ...overrides});
const card = (cardCode,name='') => ({cardCode,name});
const row = (text,actor='',cards=[]) => ({text,actor,cards});
const command = (actor='Demo North', label='Synthetic command') => row(`Played command: ${label}`,actor,[card('GD01-118',label)]);
const batch = (rows,overrides={}) => ({observedAt:WHEN, order:'oldest-first', completeFromStart:true,
  players:['Demo North','Demo South'], rows:rows.map((item,sourceIndex) => ({...item,sourceIndex})), ...overrides});
const log = (record, rows = [row('Game started!'),row('Turn 1 started!'),command()], overrides={}) => battle.ingest(record,batch(rows,overrides));
const project = (records, overrides={}) => live.project(store(...records),context(overrides));

function freeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return value;
}

test('UMD and CommonJS projection require no Chrome or page state', () => {
  assert.equal(globalThis.MSALivePanelCore,live);
  const realm = vm.createContext({});
  for (const file of ['recorder-core.js','battle-log-core.js','live-panel-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'),realm);
  }
  assert.equal(typeof realm.MSALivePanelCore.project,'function');
  const model = realm.MSALivePanelCore.project({},context());
  assert.equal(model.latestSnapshot,null);
  assert.equal(model.statusTone,'neutral');
});

test('enabled alone is never evidence of a saved hand or a safe review target', () => {
  const model = project([]);
  assert.equal(model.gameId,GAME);
  assert.equal(model.identityConfirmed,true);
  assert.equal(model.sessionId,null);
  assert.equal(model.latestSnapshot,null);
  assert.deepEqual(model.handCards,[]);
  assert.equal(model.quality,'unavailable');
  assert.equal(model.snapshotCount,0);
  assert.equal(model.publicEventCount,0);
  assert.equal(model.coverageTone,'neutral');
  assert.equal(model.statusTone,'neutral');
  assert.match(model.statusDetail,/不代表已記錄成功/);
  assert.doesNotThrow(() => live.project(null,null));
});

test('only the matching current run supplies saved hand, turn and EX resources', () => {
  const record = hand(session());
  const input = freeze(store(record));
  const model = live.project(input,context());
  assert.equal(model.sessionId,record.id);
  assert.equal(model.snapshotCount,1);
  assert.equal(model.latestSnapshot.id,record.snapshots[0].id);
  assert.deepEqual(model.handCards,[{cardCode:'GD01-001',count:2}]);
  assert.equal(model.currentTurnLabel,'T1（Log 確認）');
  assert.equal(model.resourcesText,'等級 3 · 一般可用 2 · EX 可用 1 · 合計 3');
  assert.equal(model.statusTone,'success');
  model.latestSnapshot.hand[0].count=99;
  model.handCards[0].count=98;
  assert.equal(record.snapshots[0].hand[0].count,2);
  assert.equal(model.publicEventCount,0);
  assert.equal(model.coverageTone,'neutral');
});

test('old-run hands are never borrowed, even if their timestamps are newer', () => {
  const old = log(hand(session({id:`${GAME}.old`,startedAt:'2099-01-01T00:00:00.000Z'})));
  const model = project([old]);
  assert.equal(model.latestSnapshot,null);
  assert.equal(model.snapshotCount,0);
  assert.equal(model.resourcesText,'資源未辨識');
  assert.deepEqual(model.handCards,[]);
  assert.equal(model.sessionId,null);
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.currentTurnLabel,'公開 Log 至 T1');
});

test('same-game compatible logs merge while other games, identities and anonymous hands are excluded', () => {
  const current = hand(session());
  const old = log(hand(session({id:`${GAME}.old`})),[row('Game started!'),row('Turn 1 started!'),command()]);
  const anonymous = log(session({id:`${GAME}.public`,playerName:''}),
    [row('Game started!'),row('Turn 1 started!'),command(),command('Demo South','Second synthetic action')]);
  const wrongPlayer = log(hand(session({id:`${GAME}.foreign`,playerName:'Demo South'})),[command('Demo South','Private foreign record')],{completeFromStart:false});
  const anonymousHand = log(hand(session({id:`${GAME}.anonymous`,playerName:''})),[command('Demo South','Unconfirmed hand record')],{completeFromStart:false});
  const otherGame = log(hand(session({id:`${OTHER_GAME}.current`,gameId:OTHER_GAME})),[command('Demo South','Different match')],{completeFromStart:false});
  const model = project([current,old,anonymous,wrongPlayer,anonymousHand,otherGame]);
  assert.equal(model.snapshotCount,1);
  assert.equal(model.publicEventCount,4);
  assert.equal(model.publicPlayCount,2);
  assert.deepEqual(model.recentPlays.map(play=>play.actorSide),['opponent','own']);
  assert.ok(model.recentPlays.every(play=>!/(Private foreign|Unconfirmed hand|Different match)/.test(play.rawText)));
});

test('current-run player mismatch hides hand and provides no unsafe review ID', () => {
  const record = log(hand(session({playerName:'Demo South'})));
  const model = project([record]);
  assert.equal(model.latestSnapshot,null);
  assert.equal(model.snapshotCount,0);
  assert.equal(model.publicEventCount,0);
  assert.equal(model.sessionId,null);
  assert.match(model.statusLabel,/不符/);
});

test('unknown identity uses current-run public events only and never exposes saved hands or sides', () => {
  const current = log(hand(session()));
  const old = log(session({id:`${GAME}.old`}),[row('Game started!'),row('Turn 1 started!'),command(),command()]);
  const model = project([old,current],{playerName:'  '});
  assert.equal(model.identityConfirmed,false);
  assert.equal(model.playerName,'');
  assert.equal(model.latestSnapshot,null);
  assert.equal(model.snapshotCount,0);
  assert.equal(model.resourcesText,'資源未辨識');
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.recentPlays[0].actorSide,'unknown');
  assert.equal(model.sessionId,null);
  assert.match(model.statusLabel,/身分待確認/);
});

test('anonymous public-only current run can open its own review without claiming hand identity', () => {
  const record = log(session({playerName:''}));
  const model = project([record],{playerName:''});
  assert.equal(model.sessionId,record.id);
  assert.equal(model.publicEventCount,3);
  assert.equal(model.latestSnapshot,null);
  assert.equal(model.recentPlays[0].actorSide,'unknown');
});

test('current unavailable observation supersedes earlier complete hand and is not zero cards', () => {
  let record = hand(session());
  record = hand(record,{hand:[],expectedCount:null,unknownCount:0,quality:'unavailable',resources:null,
    timestamp:'2000-01-01T00:01:00.000Z'});
  const model = project([record]);
  assert.equal(model.snapshotCount,2);
  assert.equal(model.latestSnapshot.id,record.snapshots[1].id);
  assert.equal(model.quality,'unavailable');
  assert.deepEqual(model.handCards,[]);
  assert.match(model.handSummary,/未知.*不能視為 0/);
  assert.equal(model.resourcesText,'資源未辨識');
  assert.equal(model.statusTone,'warning');
});

test('confirmed empty, partial, and malformed empty observations have distinct meanings', () => {
  const empty = project([hand(session(),{hand:[],expectedCount:0})]);
  assert.equal(empty.quality,'complete');
  assert.match(empty.handSummary,/已觀察到空手/);
  const partial = project([hand(session(),{hand:[],expectedCount:3,unknownCount:3,quality:'partial'})]);
  assert.equal(partial.quality,'partial');
  assert.match(partial.handSummary,/預期 3 張 · 未辨識 3 張/);
  const missing = hand(session(),{hand:[],expectedCount:0});
  delete missing.snapshots[0].hand;
  delete missing.snapshots[0].unknownCount;
  const malformed = project([missing]);
  assert.equal(malformed.quality,'partial');
  assert.doesNotMatch(malformed.handSummary,/已觀察到空手/);
});

test('unconfirmed observation turns stay distinct from calibrated and estimated absolute turns', () => {
  const unknown = project([hand(session(),{turn:null,turnSource:'unknown',observedTurn:7})]);
  assert.equal(unknown.currentTurnLabel,'觀察回合 7');
  const estimated = project([hand(session(),{turn:8,turnSource:'phase-observed',observedTurn:7})]);
  assert.equal(estimated.currentTurnLabel,'推計 T8');
});

test('pending, paused and write-error states preserve saved evidence and do not claim fresh success', () => {
  const record = hand(session());
  const pending = project([record],{pendingCount:3});
  assert.match(pending.statusLabel,/等待儲存 3/);
  assert.equal(pending.snapshotCount,1);
  assert.equal(pending.statusTone,'warning');
  const paused = project([record],{enabled:false});
  assert.match(paused.statusLabel,/暫停/);
  assert.equal(paused.statusTone,'neutral');
  assert.equal(paused.snapshotCount,1);
  const failed = project([record],{writeError:'Quota exceeded',pendingCount:2,enabled:false});
  assert.equal(failed.statusTone,'error');
  assert.match(failed.statusDetail,/Quota exceeded/);
  assert.match(failed.statusDetail,/2 筆觀察待存/);
  assert.match(failed.statusDetail,/暫停/);
});

test('live partial quality warns without rewriting the latest saved complete snapshot', () => {
  const record = hand(session());
  const model = project([record],{quality:'partial',captureNote:'Synthetic animation note'});
  assert.equal(model.quality,'complete');
  assert.equal(model.statusTone,'warning');
  assert.match(model.statusLabel,/目前畫面待辨識/);
  assert.match(model.statusDetail,/Synthetic animation note/);
  assert.equal(model.latestSnapshot.quality,'complete');
});

test('merged repeated captures preserve legal duplicate plays and original stored IDs', () => {
  const rows = [row('Game started!'),row('Turn 1 started!'),command(),command(),row('Game ended!')];
  const first = log(session({id:`${GAME}.old`}),rows);
  const current = log(session({startedAt:'2000-01-01T00:02:00.000Z'}),rows);
  const model = project([current,first]);
  assert.equal(model.publicEventCount,5);
  assert.equal(model.publicPlayCount,2);
  assert.equal(model.recentPlays.length,2);
  assert.equal(new Set(model.recentPlays.map(play=>play.id)).size,2);
  assert.deepEqual(model.recentPlays.map(play=>play.id),first.battleLog.events.filter(e=>e.isPlay).reverse().map(e=>e.id));
  assert.ok(model.recentPlays.every(play=>play.sourceSessionId===first.id));
  assert.equal(model.coverageTone,'success');
});

test('recent public actions follow accepted log order, never capture timestamps, and retain last 20', () => {
  const rows = [row('Game started!'),row('Turn 1 started!'),...Array.from({length:23},(_,i)=>command('Demo North',`Synthetic ${i}`))];
  const record = log(session(),rows);
  record.battleLog.events.forEach((event,index) => {event.capturedAt=`${2099-index}-01-01T00:00:00.000Z`;});
  const model = project([record]);
  assert.equal(model.publicPlayCount,23);
  assert.equal(model.recentPlays.length,20);
  assert.equal(model.recentPlays[0].rawText,'Played command: Synthetic 22');
  assert.equal(model.recentPlays.at(-1).rawText,'Played command: Synthetic 3');
});

test('pilot primary card is not its unit target and generated tokens stay separate from play count', () => {
  const record = log(session(),[row('Game started!'),row('Turn 1 started!'),
    row('Linked pilot: Synthetic Pilot on unit Synthetic Unit','Demo North',
      [card('ST04-010','Synthetic Pilot'),card('ST04-001','Synthetic Unit')]),
    row('Parts deployed','Demo South',[card('T-021','Parts')]),
    row('Synthetic Unit returned to hand','Demo South',[card('ST04-001','Synthetic Unit')])]);
  const model = project([record]);
  assert.equal(model.publicEventCount,5);
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.recentPlays.length,2);
  assert.equal(model.recentPlays[0].action,'deploy-token');
  assert.equal(model.recentPlays[0].actorSide,'opponent');
  assert.equal(model.recentPlays[1].cardCode,'ST04-010');
  assert.equal(model.recentPlays[1].cardName,'Synthetic Pilot');
  assert.ok(!Object.hasOwn(model,'deckRemaining'));
});

test('complete public log does not erase persistent hand capture issues', () => {
  const record = log(hand(session()),[row('Game started!'),row('Turn 1 started!'),command(),row('Game ended!')]);
  record.captureIssues=[{code:'buffer-full',reason:'Synthetic pending overflow',pendingCount:2,observedAt:WHEN}];
  const model = project([record]);
  assert.equal(model.coverageTone,'success');
  assert.equal(model.quality,'complete');
  assert.equal(model.captureIssues.length,1);
  assert.equal(model.captureIssues[0].sourceSessionId,record.id);
  assert.equal(model.statusTone,'warning');
  assert.match(model.statusDetail,/公開 Log 的完整性不能補回缺口/);
  model.captureIssues[0].pendingCount=99;
  assert.equal(record.captureIssues[0].pendingCount,2);
});

test('unmerged conflicting captures stay out of public action counts and retain gap warnings', () => {
  let record = log(hand(session()));
  record = log(record,[row('Game started!'),row('Turn 1 started!'),command('Demo South','Conflicting row')]);
  const model = project([record]);
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.recentPlays[0].rawText,'Played command: Synthetic command');
  assert.equal(model.coverageTone,'warning');
  assert.match(model.coverageLabel,/缺口/);
  assert.equal(model.quality,'complete');
});

test('unknown public card identity remains unknown instead of borrowing a target or hand card', () => {
  const record = log(hand(session()),[row('Game started!'),row('Turn 1 started!'),
    row('Played command: Unresolved synthetic card','Demo North')]);
  const model = project([record]);
  assert.equal(model.publicPlayCount,1);
  assert.equal(model.recentPlays[0].cardCode,null);
  assert.equal(model.recentPlays[0].action,'play-command');
});

test('incorrect storage keys, unsupported schemas and malformed log objects cannot supply another hand', () => {
  const record = hand(session());
  const values = {'msa.session.wrong-key':record, [`msa.session.${record.id}`]:{...record,schemaVersion:2}};
  assert.equal(live.project(values,context()).latestSnapshot,null);
  const malformed = {...record,battleLog:{events:[null],players:[]}};
  const model = project([malformed]);
  assert.equal(model.publicEventCount,0);
  assert.equal(model.coverageTone,'warning');
  assert.equal(model.snapshotCount,1);
  assert.equal(model.statusTone,'warning');
});

test('ambiguous identical partial rows do not steal provenance from a later anchored full history', () => {
  const repeated = command();
  const old = log(session({id:`${GAME}.old`}),[],{completeFromStart:false,rows:[repeated]});
  const current = log(session({startedAt:'2000-01-01T00:02:00.000Z'}),[],{completeFromStart:true,
    rows:[row('Game started!'),row('Turn 1 started!'),repeated,repeated,row('Game ended!')]});
  const model = project([old,current]);
  assert.equal(model.publicPlayCount,2);
  assert.deepEqual(model.recentPlays.map(play=>play.id),current.battleLog.events.filter(e=>e.isPlay).reverse().map(e=>e.id));
  assert.ok(model.recentPlays.every(play=>play.idSource==='stored' && play.sourceSessionId===current.id));
});

test('status detail omits repeated badge counts and includes one normalized capture result', () => {
  const model = project([hand(session())],{
    captureNote:'已更新可見公開 Log',
    statusMessage:'已保存3筆手牌·Log8筆·已更新可見公開Log'
  });
  assert.doesNotMatch(model.statusDetail,/已保存\s*3\s*筆|Log\s*8\s*筆/);
  assert.equal((model.statusDetail.replace(/\s/g,'').match(/已更新可見公開Log/g)||[]).length,1);
  assert.match(model.statusDetail,/未涵蓋所有瞬間/);
});

test('status detail retains errors and gap explanations once while suppressing routine counters', () => {
  const warning = '舊段暫存缺口未能寫入，請保留此頁';
  const model = project([hand(session())],{writeError:'Quota exceeded',pendingCount:2,captureNote:warning,
    statusMessage:`暫存保留，稍後重試 · Log 8 筆 · 待存 2 筆 · 儲存失敗：Quota exceeded · ${warning}`});
  assert.equal((model.statusDetail.match(/Quota exceeded/g)||[]).length,1);
  assert.equal((model.statusDetail.match(/舊段暫存缺口未能寫入/g)||[]).length,1);
  assert.match(model.statusDetail,/2 筆觀察待存/);
  assert.match(model.statusDetail,/暫存保留，稍後重試/);
  assert.doesNotMatch(model.statusDetail,/Log 8 筆|· 待存/);
  const unknown = project([],{playerName:'',captureNote:'玩家身分已改變，停止混入此段',
    statusMessage:'Log 0 筆 · 玩家身分已改變，停止混入此段'});
  assert.match(unknown.statusDetail,/不判定自己或對手/);
  assert.equal((unknown.statusDetail.match(/玩家身分已改變/g)||[]).length,1);
});


test('collapsed projection skips public merge and Wasm, yet tracks latest saved count and errors',()=>{
  const realm=vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/recorder-core.js'),'utf8'),realm);
  realm.MSABattleLogCore={combineSessions(){throw Error('collapsed merge must not run');},buildTimeline(){throw Error('collapsed timeline must not run');}};
  realm.MSADeckTrackerCore={project(){throw Error('collapsed Wasm must not run');}};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/live-panel-core.js'),'utf8'),realm);
  const render=realm.MSALivePanelCore.createProjector(),record=hand(session()),values=store(record);
  const first=render(values,context({panelExpanded:false}));
  assert.equal(first.summaryOnly,true);assert.equal(first.snapshotCount,1);assert.equal(first.statusTone,'success');
  assert.equal(first.latestSnapshot,null);assert.equal(first.deckTracker,undefined);
  values['msa.session.'+record.id]=hand(record,{timestamp:'2000-01-01T00:00:01Z',hand:[{cardCode:'GD01-002',count:1}],expectedCount:1});
  assert.equal(render(values,context({panelExpanded:false})).snapshotCount,2);
  assert.equal(render(values,context({panelExpanded:false,quarantinedCount:1})).statusTone,'warning');
  assert.equal(render(values,context({panelExpanded:false,writeError:'quota'})).statusTone,'error');
});
test('collapsed projection preserves player isolation and rebuilding after expansion uses the newest saved hand',()=>{
  const render=live.createProjector(),own=hand(session()),foreign=hand(session({id:GAME+'.other',playerName:'Demo South'}));
  const values=store(own,foreign);
  assert.equal(render(values,context({panelExpanded:false,playerName:'Demo South'})).snapshotCount,0);
  assert.equal(render(values,context({panelExpanded:false,playerName:''})).sessionId,null);
  render(values,context({panelExpanded:false}));
  values['msa.session.'+own.id]=hand(own,{timestamp:'2000-01-01T00:00:01Z',hand:[{cardCode:'GD01-002',count:1}],expectedCount:1});
  const expanded=render(values,context({panelExpanded:true}));
  assert.equal(expanded.snapshotCount,2);assert.deepEqual(expanded.handCards,[{cardCode:'GD01-002',count:1}]);
});

test('structured panel details translate sources once, retain literal parameters and deduplicate counters',()=>{
  let language='en';
  const catalog={
    en:{'觀察失敗：{0}':'Observation failed: {0}','儲存失敗：{0}。下方僅顯示已存資料。':'Save failed: {0}. Saved data only.'},
    cn:{'觀察失敗：{0}':'观察失败：{0}','儲存失敗：{0}。下方僅顯示已存資料。':'保存失败：{0}。仅显示已存数据。'}
  };
  const calls=[],t=(source,...params)=>(catalog[language][source] || source).replace(/\{(\d+)\}/g,(all,index)=>index<params.length?String(params[index]):all);
  const realm=vm.createContext({MSARecorderCore:core,MSAI18n:{t,
    status(value){calls.push(value.messageParts[0]);return value.messageParts.map(part=>t(part.source,...part.params)).join(' · ');},
    message(){throw Error('structured status must never retranslate a rendered parameter');}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/live-panel-core.js'),'utf8'),realm);
  const raw='未知 · 儲存失敗：{1}',note={code:'observation-error',source:'觀察失敗：{0}',params:[raw]};
  const values=store(hand(session())),ctx=context({writeError:'未知',captureNote:'stale legacy',captureNoteParts:[note],
    statusMessage:'stale legacy',statusMessageParts:[{code:'saved-hand',source:'已保存 {0} 筆手牌',params:[9]},
      {code:'saved-log',source:'Log {0} 筆',params:[8]},{code:'pending',source:'待存 {0} 筆',params:[7]},
      {code:'write-error',source:'儲存失敗：{0}',params:['未知']},note]});
  for (const method of ['project','projectSummary']) {
    language='en';const first=realm.MSALivePanelCore[method](values,ctx);
    assert.ok(first.statusDetail.includes('Observation failed: '+raw));
    assert.ok(first.statusDetail.includes('Save failed: 未知.'));
    assert.equal(first.statusDetail.split(raw).length-1,1);
    assert.equal(first.statusDetailLocalized,true);
    assert.doesNotMatch(first.statusDetail,/stale legacy|Log 8|已保存 9|待存 7/);
    language='cn';const second=realm.MSALivePanelCore[method](values,ctx);
    assert.ok(second.statusDetail.includes('观察失败：'+raw));
    assert.doesNotMatch(second.statusDetail,/Observation failed|Save failed/);
  }
  assert.ok(calls.every(part=>part.source==='觀察失敗：{0}' && part.params[0]===raw));
});

test('both panel projections keep uncertain recovery visible while durable rescue is not a saved hand',()=>{
  const values=store(hand(session()));
  for (const method of ['project','projectSummary']) {
    for (const recovery of [{pendingCount:1},{unprotectedCount:1},{error:'recovery-open-failed'}]) {
      const model=live[method](values,context({enabled:false,recovery}));
      assert.equal(model.statusTone,'warning');
      assert.match(model.statusDetail,/救援暫存/);
      assert.equal(model.snapshotCount,1);
    }
    const full=live[method](values,context({recovery:{unprotectedCount:1,error:'recovery-journal-full'}}));
    assert.match(full.statusDetail,/已滿，下載不會清除/);
    assert.match(full.statusDetail,/一般記錄仍會嘗試保存，請保留原分頁/);
    const saved=live[method]({},context({recovery:{durableCount:4}}));
    assert.equal(saved.snapshotCount,0);
    assert.notEqual(saved.statusTone,'success');
    assert.match(saved.statusDetail,/持久化 4 筆/);
    const latest=live[method](values,context({recovery:{},quarantinedCount:0,statusMessageParts:[
      {code:'recovery-pending',source:'救援暫存確認中 {0} 筆',params:[1]},
      {code:'quarantined',source:'stale quarantine',params:[]}
    ]}));
    assert.equal(latest.statusTone,'success');
    assert.doesNotMatch(latest.statusDetail,/確認中|stale quarantine/);
  }
});

test('collapsed status does not claim complete saved hands for malformed or currently unknown observations',()=>{
  const malformed={...session(),snapshots:[null]};
  assert.equal(live.projectSummary(store(malformed),context()).statusTone,'warning');
  assert.equal(live.projectSummary(store(hand(session())),context({quality:'unavailable'})).statusLabel,'目前畫面待辨識');
  assert.equal(live.projectSummary(store(hand(session())),context({writeError:'  '})).statusTone,'success');
  assert.equal(live.projectSummary({},null).identityConfirmed,false);
});

test('cached public failures use the current language without rebuilding unchanged evidence',async()=>{
  const realm=vm.createContext({MSARecorderCore:core,navigator:{languages:['en']}});
  for (const file of ['i18n-data.js','i18n.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'),realm);
  await realm.MSAI18n.ready();
  const fixtures=[
    {source:'公開紀錄合併模組未載入，僅顯示目前記錄段。',multiple:true,modules:{}},
    {source:'部分公開紀錄無法合併，僅顯示目前記錄段。',multiple:true,modules:{combineSessions(){throw Error('synthetic merge failure');}}},
    {source:'公開紀錄摘要無法確認，請開啟回顧頁檢查原文。',modules:{buildTimeline(){throw Error('synthetic timeline failure');}}}
  ];
  for (const fixture of fixtures) {
    let calls=0;
    realm.MSABattleLogCore=Object.fromEntries(Object.entries(fixture.modules).map(([name,fn])=>[name,(...args)=>{calls++;return fn(...args);} ]));
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/live-panel-core.js'),'utf8'),realm);
    const values=store(session(),...(fixture.multiple?[session({id:GAME+'.old'})]:[])),cache={};
    await realm.MSAI18n.setLanguage('en');
    const first=realm.MSALivePanelCore.project(values,context(),cache),publicKey=cache.publicKey;
    assert.equal(cache.evidence.mergeProblem,fixture.source);
    assert.ok(first.statusDetail.includes(realm.MSAI18n.t(fixture.source)));
    const expectedCalls=calls;
    await realm.MSAI18n.setLanguage('zh-CN');
    const second=realm.MSALivePanelCore.project(values,context(),cache);
    assert.equal(cache.publicKey,publicKey);
    assert.equal(calls,expectedCalls,'language changes must reuse cached public evidence');
    assert.ok(second.statusDetail.includes(realm.MSAI18n.t(fixture.source)));
    assert.notEqual(second.statusDetail,first.statusDetail);
    assert.doesNotMatch(second.statusDetail,/Public Log|Some public/);
    assert.equal(second.statusDetailLocalized,true);
  }
});
