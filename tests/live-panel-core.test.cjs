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
