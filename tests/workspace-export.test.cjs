'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const library = require('../extension/library-core.js');
const reviewWorkspace = require('../extension/review-workspace.js');

// All identities, observations, notes, results and decks below are synthetic.
const GAME = '00000000-0000-4000-8000-000000000901';
const OTHER_GAME = '00000000-0000-4000-8000-000000000902';
const TIME = '2000-01-01T00:00:00.000Z';

function session(extra = {}) {
  let value = core.createSession({id:'segment-a',gameId:GAME,playerName:'Demo North',startedAt:TIME});
  value = core.appendSnapshot(value,{timestamp:TIME,turn:null,turnSource:'unknown',observedTurn:2,
    phase:'MAIN',hand:[{cardCode:'GD01-001',count:1}],quality:'complete',expectedCount:1,unknownCount:0});
  value.snapshots[0].id = 'snapshot-a';
  value.futureSessionField = {keep:'original session'};
  return {...value,...extra};
}
function note(id, extra = {}) {
  return {schemaVersion:1,id,gameId:GAME,playerName:'Demo North',sourceSessionId:'segment-a',snapshotId:'snapshot-a',
    turn:null,turnSource:'unknown',observedTurn:2,observedAt:TIME,createdAt:TIME,updatedAt:TIME,
    tag:'待檢討',note:'Synthetic note ' + id,...extra};
}
function match(id, extra = {}) {
  return {schemaVersion:1,id,gameId:GAME,playerName:'Demo North',source:'manual',identityConfirmed:true,
    sourceSessionId:'segment-a',result:'win',resultConfirmed:true,firstPlayer:'first',updatedAt:TIME,
    deckVersionId:null,frozenDeckVersion:null,...extra};
}
function deck(id, extra = {}) {
  return {schemaVersion:1,id,deckId:'synthetic-family',name:'Synthetic version',createdAt:TIME,contentHash:'synthetic-content',
    main:Array.from({length:13},(_,index)=>({cardCode:'GD01-' + String(index+1).padStart(3,'0'),count:index===12?2:4})),
    resources:[{cardCode:'R-001',count:10}],tokens:[],...extra};
}
function info(records) { return {exportedAt:TIME,workspaceRecords:records,otherAudit:{preserve:true}}; }
function jsonBlock(html,id) {
  const found = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .find(([,attributes])=>new RegExp(`\\bid="${id}"`).test(attributes));
  assert.ok(found,'Missing JSON block ' + id);
  assert.match(found[1],/\btype="application\/json"/);
  return JSON.parse(found[2]);
}
function visibleHTML(value) {
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');
}
function exportsFor(value,records) {
  const options = {exportInfo:info(records)};
  return {html:battle.toHTML(value,options),markdown:battle.toMarkdown(value,options)};
}

test('visible workspace export shows active notes and preserves deleted raw records without rewriting the session',()=>{
  const value = session(), records = {'msa.note.active':note('active',{note:'Visible active text',futureField:{preserve:1}}),
    'msa.note.deleted':note('deleted',{note:'Deleted text is raw only',deletedAt:TIME,futureField:{preserve:2}})};
  const options = {exportInfo:info(records)}, beforeSession = structuredClone(value), beforeOptions = structuredClone(options);
  const html = battle.toHTML(value,options), markdown = battle.toMarkdown(value,options);
  assert.match(visibleHTML(html),/Visible active text/);assert.match(markdown,/Visible active text/);
  assert.doesNotMatch(visibleHTML(html),/Deleted text is raw only/);assert.doesNotMatch(markdown,/Deleted text is raw only/);
  assert.deepEqual(jsonBlock(html,'msa-record-data'),beforeSession);
  assert.deepEqual(jsonBlock(html,'msa-export-info'),beforeOptions.exportInfo);
  assert.deepEqual(value,beforeSession);assert.deepEqual(options,beforeOptions);
});

test('both HTML metadata and readable exports exclude foreign notes and blank-player wildcard access',()=>{
  const records = {'msa.note.own':note('own'),
    'msa.note.game':note('game',{gameId:OTHER_GAME,note:'FOREIGN_GAME'}),
    'msa.note.player':note('player',{playerName:'Demo South',note:'FOREIGN_PLAYER'}),
    'msa.note.source':note('source',{sourceSessionId:'segment-b',note:'FOREIGN_SOURCE'}),
    'msa.note.bad-key':note('mismatched',{note:'MISMATCHED_KEY'}),
    'msa.note.schema':note('schema',{schemaVersion:2,note:'UNSUPPORTED_SCHEMA'})};
  const output = exportsFor(session(),records);
  assert.deepEqual(Object.keys(jsonBlock(output.html,'msa-export-info').workspaceRecords),['msa.note.own']);
  for(const value of Object.values(output)) assert.doesNotMatch(value,/FOREIGN_|MISMATCHED_KEY|UNSUPPORTED_SCHEMA/);
  for(const value of [session({playerName:''}),session({playerName:'  '}),session({id:null})]) {
    const blank = exportsFor(value,records);
    assert.deepEqual(jsonBlock(blank.html,'msa-export-info').workspaceRecords,{});
    assert.doesNotMatch(blank.markdown,/Synthetic note own/);
  }
});

test('combined reports only admit notes from explicit original source segments, including string source IDs',()=>{
  const value = session({id:'combined-synthetic',isCombined:true,sourceSessions:[{id:'segment-a'},'segment-b']});
  value.snapshots[0].sourceSessionId = 'segment-a';
  value.snapshots.push({...value.snapshots[0],id:'snapshot-b',sourceSessionId:'segment-b'});
  const records = {'msa.note.a':note('a'),'msa.note.b':note('b',{sourceSessionId:'segment-b',snapshotId:'snapshot-b'}),
    'msa.note.aggregate':note('aggregate',{sourceSessionId:value.id,note:'AGGREGATE_NOT_SOURCE'}),
    'msa.note.other':note('other',{sourceSessionId:'segment-c',note:'UNSELECTED_SOURCE'})};
  const output = exportsFor(value,records);
  assert.deepEqual(Object.keys(jsonBlock(output.html,'msa-export-info').workspaceRecords),['msa.note.a','msa.note.b']);
  assert.doesNotMatch(output.html,/AGGREGATE_NOT_SOURCE|UNSELECTED_SOURCE|來源快照未在本次匯出中/);
  assert.deepEqual(jsonBlock(battle.toHTML({...value,sourceSessions:[]},{exportInfo:info(records)}),'msa-export-info').workspaceRecords,{});
});

test('manual confirmed result applies to the whole game even when recorded from a different source run',()=>{
  const ownMatch = match('whole-game',{sourceSessionId:'segment-other',result:'concede',firstPlayer:'second',custom:{preserve:true}});
  const records = {'msa.match.whole-game':ownMatch,
    'msa.match.opponent':match('opponent',{playerName:'Demo South',sourceSessionId:'OPPONENT_SOURCE'}),
    'msa.match.game':match('game',{gameId:OTHER_GAME,sourceSessionId:'OTHER_GAME_SOURCE'}),
    'msa.match.auto':match('auto',{source:'inferred',sourceSessionId:'AUTOMATIC_SOURCE'}),
    'msa.match.unknown':match('unknown',{identityConfirmed:false,sourceSessionId:'UNKNOWN_IDENTITY_SOURCE'})};
  const output = exportsFor(session(),records);
  assert.match(visibleHTML(output.html),/人工確認結果：本人投降（負） · 後手/);
  assert.match(output.markdown,/整局人工記錄，不是依 Log 自動推定/);
  assert.match(visibleHTML(output.html),/segment-other/);
  assert.deepEqual(jsonBlock(output.html,'msa-export-info').workspaceRecords,{'msa.match.whole-game':ownMatch});
  for(const value of Object.values(output)) assert.doesNotMatch(value,/OPPONENT_SOURCE|OTHER_GAME_SOURCE|AUTOMATIC_SOURCE|UNKNOWN_IDENTITY_SOURCE/);
});

test('latest result uses real timestamp order and newer unconfirmed results do not resurrect an older victory',()=>{
  const records = {'msa.match.utc':match('utc',{result:'win',updatedAt:'2000-01-01T01:00:00Z'}),
    'msa.match.offset':match('offset',{result:'loss',updatedAt:'2000-01-01T02:00:00+02:00'})};
  const first = exportsFor(session(),records);
  assert.match(visibleHTML(first.html),/人工確認結果：勝/);assert.doesNotMatch(visibleHTML(first.html),/人工確認結果：負/);
  records['msa.match.later'] = match('later',{result:'unknown',resultConfirmed:false,updatedAt:'2000-01-01T02:00:00Z'});
  const second = exportsFor(session(),records);
  assert.match(visibleHTML(second.html),/尚無本玩家可顯示的最新人工確認結果/);
  assert.doesNotMatch(second.markdown,/人工確認結果：勝/);
  assert.deepEqual(jsonBlock(second.html,'msa-export-info').workspaceRecords,records);
});

test('result summary uses its frozen deck version and excludes unrelated decks while retaining raw provenance',()=>{
  const frozen = deck('version-a',{name:'Frozen chosen version',futureDeckField:{preserve:true}});
  const changed = deck('version-a',{name:'Later local display name'});
  const records = {'msa.match.own':match('own',{deckVersionId:'version-a',frozenDeckVersion:frozen}),
    'msa.deck.version-a':changed,'msa.deck.unrelated':deck('unrelated',{name:'UNRELATED_DECK'})};
  const output = exportsFor(session(),records), visible = visibleHTML(output.html);
  assert.match(visible,/Frozen chosen version/);assert.doesNotMatch(visible,/Later local display name|UNRELATED_DECK/);
  assert.match(visible,/主牌 50 張 · 資源 10 張 · Token 0 張/);
  assert.match(visible,/此摘要不驗證賽制合法性/);
  assert.deepEqual(jsonBlock(output.html,'msa-export-info').workspaceRecords,
    {'msa.match.own':records['msa.match.own'],'msa.deck.version-a':changed});
  const malformed = exportsFor(session(),{'msa.match.own':match('own',{deckVersionId:'version-b',frozenDeckVersion:
    deck('version-b',{main:null,resources:[{cardCode:'R-001',count:-1}],tokens:undefined})})});
  assert.match(visibleHTML(malformed.html),/主牌 未知 · 資源 未知 · Token 未知/);
});

test('bookmarks distinguish Log and estimated turns and never turn unknown anchors into absolute turns',()=>{
  const records = {'msa.note.log':note('log',{turn:4,turnSource:'log'}),
    'msa.note.estimated':note('estimated',{turn:5,turnSource:'phase-observed'}),
    'msa.note.unknown':note('unknown',{turn:999,turnSource:'unknown',observedTurn:3,snapshotId:'missing-snapshot'}),
    'msa.note.invalid':note('invalid',{turn:-10,turnSource:'log',observedTurn:null})};
  const output = exportsFor(session(),records);
  for(const value of Object.values(output)) {
    assert.match(value,/Log 校準 · T4/);assert.match(value,/推計回合 · T5/);
    assert.match(value,/觀察 3 · 回合未校準/);assert.doesNotMatch(visibleHTML(value),/T999|T-10/);
    assert.match(value,/來源快照未在本次匯出中，不改接其他回合/);
  }
});

test('workspace text and attributes are inert in HTML and Markdown, including JSON closing tags',()=>{
  const attack = '</script><img src=x onerror="alert(1)"><script>alert(2)</script> [link](javascript:alert(3))';
  const maliciousId = '\" onmouseover=\"alert(4)';
  const records = {['msa.note.' + maliciousId]:note(maliciousId,{note:attack,tag:attack}),
    'msa.match.own':match('own',{deckVersionId:'version-a',frozenDeckVersion:deck('version-a',{name:attack,contentHash:attack})})};
  const output = exportsFor(session(),records), visible = visibleHTML(output.html);
  assert.equal([...output.html.matchAll(/<script\b/gi)].length,2,'Only the two inert source JSON blocks may exist');
  assert.doesNotMatch(visible,/<img\b|<script\b| onmouseover="/i);
  assert.match(visible,/&lt;\/script&gt;&lt;img/);
  assert.match(output.markdown,/&lt;\/script&gt;&lt;img/);
  assert.ok(output.markdown.includes('\\[link\\]\\(javascript:alert\\(3\\)\\)'));
  assert.deepEqual(jsonBlock(output.html,'msa-export-info').workspaceRecords,records);
});

test('standalone HTML can restore source session plus scoped workspace records through the actual importer',()=>{
  const value = session(), version = deck('version-a');
  const values = {'msa.note.active':note('active'),
    'msa.note.deleted':note('deleted',{deletedAt:TIME,unknownAudit:{preserve:'deleted provenance'}}),
    'msa.note.foreign':note('foreign',{playerName:'Demo South'}),
    'msa.match.own':match('own',{sourceSessionId:'different-run',deckVersionId:'version-a',frozenDeckVersion:version}),
    'msa.deck.version-a':version};
  const scoped = reviewWorkspace.exportRecords(value,values);
  const html = battle.toHTML(value,{exportInfo:info(scoped)});
  const imported = library.parseImport(html,{fileName:'synthetic-report.html'});
  assert.equal(imported.kind,'html');
  assert.deepEqual(imported.records,{'msa.session.segment-a':value,...scoped});
  assert.equal(imported.records['msa.note.deleted'].deletedAt,TIME);
  assert.equal(imported.records['msa.match.own'].sourceSessionId,'different-run');
});

test('old exports without workspace metadata keep their existing structure',()=>{
  const value = session(), exportInfo = {exportedAt:TIME,customAudit:{keep:true}};
  const html = battle.toHTML(value,{exportInfo}), markdown = battle.toMarkdown(value,{exportInfo});
  assert.doesNotMatch(visibleHTML(html),/data-workspace-section|書籤與筆記|人工戰績與牌組/);
  assert.doesNotMatch(markdown,/書籤與筆記|人工戰績與牌組/);
  assert.deepEqual(jsonBlock(html,'msa-export-info'),exportInfo);
  assert.deepEqual(jsonBlock(html,'msa-record-data'),value);
});
