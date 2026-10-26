'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const recorder = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const library = require('../extension/library-core.js');
const reportI18n = require('../extension/export-i18n.js');

const GAME = '00000000-0000-4000-8000-000000000911';
const TIME = '2000-01-01T00:00:00.000Z';
const KNOWN_WARNING = '新擷取與既有公開紀錄沒有可確認的重疊；原文保留在 captures，未推測其先後順序。';
const KNOWN_REASON = '頁面／設定切換時仍有觀察尚未確認存妥；已隔離舊暫存';

function fixture() {
  // Names deliberately equal authored dictionary keys: data must bypass lookup.
  let session = recorder.createSession({id:'report-language',gameId:GAME,playerName:'未知',startedAt:TIME});
  for (const [index, hand] of [[0,[{cardCode:'GD01-001',count:1}]],[1,[{cardCode:'GD01-001',count:2}]],[2,[]]]) {
    session = recorder.appendSnapshot(session,{timestamp:new Date(Date.parse(TIME)+index*1000).toISOString(),
      turn:1,turnSource:'log',observedTurn:1,activePlayer:'未知',phase:'MAIN',hand,
      quality:'complete',expectedCount:hand.reduce((sum,card)=>sum+card.count,0),unknownCount:0,
      resources:{level:3,active:1,exActive:0,totalActive:1},reason:'custom reason 原文 '+index});
  }
  session = recorder.appendSnapshot(session,{timestamp:'2000-01-01T00:00:04.000Z',turn:null,turnSource:'unknown',observedTurn:2,
    hand:[],quality:'unavailable',expectedCount:null,unknownCount:0,reason:'hand-container-missing'});
  session = battle.ingest(session,{observedAt:TIME,order:'oldest-first',completeFromStart:true,players:['未知','Other'],
    rows:[{text:'Game started!'},{text:'Turn 1 started!'},{text:KNOWN_WARNING,actor:'未知',cards:[{cardCode:'GD01-001',name:'未命名'}]},
      {text:'Turn 2 started!'},{text:'Game ended!'}].map((row,sourceIndex)=>({sourceIndex,...row}))});
  session.battleLog.warnings = [KNOWN_WARNING,'CUSTOM 警告 retained'];
  session.captureIssues = [{code:'navigation-pending',observedAt:TIME,pendingCount:2,reason:KNOWN_REASON},
    {code:'custom-gap',observedAt:TIME,reason:'CUSTOM 缺口 <not markup>'}];
  session.futureField = {preserve:'未知 字段'};
  const deck = {schemaVersion:1,id:'version-report',deckId:'family-report',name:'手牌擷取缺口',createdAt:TIME,contentHash:'synthetic',
    main:Array.from({length:13},(_,i)=>({cardCode:'GD01-'+String(i+1).padStart(3,'0'),count:i===12?2:4})),resources:[{cardCode:'R-001',count:10}],tokens:[]};
  const workspaceRecords = {
    'msa.note.report':{schemaVersion:1,id:'report',gameId:GAME,playerName:session.playerName,sourceSessionId:session.id,
      snapshotId:session.snapshots[0].id,turn:1,turnSource:'log',observedTurn:1,observedAt:TIME,createdAt:TIME,updatedAt:TIME,
      tag:'書籤與筆記',note:'資源未辨識',futureNote:{preserve:true}},
    'msa.match.report':{schemaVersion:1,id:'report',gameId:GAME,playerName:session.playerName,source:'manual',identityConfirmed:true,
      sourceSessionId:session.id,result:'win',resultConfirmed:true,firstPlayer:'first',updatedAt:TIME,deckVersionId:deck.id,frozenDeckVersion:deck},
    ['msa.deck.'+deck.id]:deck
  };
  const exportInfo = {exportedAt:TIME,refresh:{refreshed:false,partial:true,code:'saved-only',reason:'未要求刷新 MSA'},
    workspaceRecords,futureAudit:{preserve:'原文'}};
  return {session,exportInfo};
}
function jsonBlock(html,id) {
  const match = html.match(new RegExp('<script id="'+id+'" type="application/json">([\\s\\S]*?)</script>'));
  assert.ok(match,'Missing original JSON block '+id);
  return JSON.parse(match[1]);
}
function visible(value) { return value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,''); }
function plainMarkdown(value) { return value.replace(/\\([\\`*_{}\[\]()#+.!|~-])/g,'$1'); }
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }

test('report dictionaries cover explicit templates and preserve all interpolation positions',()=>{
  const placeholders = value => (value.match(/\{\d+\}/g)||[]).sort();
  for (const [source,translations] of Object.entries(reportI18n.messages)) {
    assert.deepEqual(Object.keys(translations).sort(),['en','zh-CN']);
    for(const [language,translated] of Object.entries(translations)) {
      assert.ok(translated.trim(),source);
      assert.deepEqual(placeholders(translated),placeholders(source),language+': '+source);
      if(language==='en')assert.doesNotMatch(translated,/[\u3400-\u9fff]/,source);
    }
  }
  const source = fs.readFileSync(path.join(__dirname,'../extension/battle-log-core.js'),'utf8');
  for(const match of source.matchAll(/\bt\('((?:\\.|[^'\\])*)'/g)) {
    const key = vm.runInNewContext("'"+match[1]+"'");
    assert.ok(Object.hasOwn(reportI18n.messages,key),'Missing report template: '+key);
  }
});

for(const [language,htmlLanguage,htmlTitle,markdownTitle,notes,gaps,resource] of [
  ['zh-TW','zh-Hant','MSA 完整觀察紀錄','MSA 對局分析資料','書籤與筆記','手牌擷取缺口','等級 3 · 一般可用 1 · EX 可用 0 · 合計 1'],
  ['zh-CN','zh-Hans','MSA 完整观察记录','MSA 对局分析资料','书签与笔记','手牌撷取缺口','等级 3 · 一般可用 1 · EX 可用 0 · 合计 1'],
  ['en','en','MSA complete observation record','MSA match analysis record','Bookmarks and notes','Hand capture gaps','Level 3 · Active 1 · Active EX 0 · Total 1']
])test(language+' reports localize authored sections while exact source JSON and user text survive import',()=>{
  const {session,exportInfo} = fixture();
  const before = JSON.stringify({session,exportInfo});freeze(session);freeze(exportInfo);
  const html = battle.toHTML(session,{language,exportInfo}), md = plainMarkdown(battle.toMarkdown(session,{language,exportInfo}));
  const rendered = visible(html), t = reportI18n.create(language).t;
  assert.ok(html.startsWith('<!doctype html><html lang="'+htmlLanguage+'">'));
  assert.ok(rendered.includes('<h1>'+htmlTitle+'</h1>'));
  assert.ok(md.startsWith('# '+markdownTitle+'\n'));
  assert.ok(rendered.includes('<h2>'+notes+'</h2>'));
  assert.ok(rendered.includes('<h2>'+gaps+'</h2>'));
  assert.ok(md.includes('## '+notes));assert.ok(md.includes('## '+gaps));
  assert.ok(rendered.includes(resource));assert.ok(md.includes(resource));
  assert.ok(rendered.includes('<h3>書籤與筆記</h3>'),'User tag must not use authored translation');
  assert.ok(rendered.includes('<pre>資源未辨識</pre>'),'User note must not use authored translation');
  assert.ok(rendered.includes('<pre>'+KNOWN_WARNING+'</pre>'),'Raw Log must not use warning translation');
  assert.ok(rendered.includes('GD01-001 未命名'),'Card name stays original');
  assert.ok(rendered.includes('CUSTOM 警告 retained'));
  assert.ok(rendered.includes('CUSTOM 缺口 &lt;not markup&gt;'));
  assert.ok(md.includes('### 書籤與筆記'));assert.ok(md.includes('資源未辨識'));
  assert.ok(md.includes(KNOWN_WARNING));assert.ok(md.includes('CUSTOM 警告 retained'));
  assert.ok(rendered.includes(t(KNOWN_WARNING)),'Known authored warning is localized separately from raw Log');
  assert.ok(md.includes(t(KNOWN_REASON)));assert.ok(md.includes(t('未要求刷新 MSA')));
  assert.ok(md.includes(t('與前一筆完整觀察相比：{0}。僅表示觀察數量差，進出原因未知。','GD01-001 +1')));
  assert.equal((rendered.match(/data-snapshot-id=/g)||[]).length,session.snapshots.length);
  assert.equal((rendered.match(/data-event-id=/g)||[]).length,session.battleLog.events.length);
  assert.deepEqual(jsonBlock(html,'msa-record-data'),session);
  assert.deepEqual(jsonBlock(html,'msa-export-info'),exportInfo);
  const imported = library.parseImport(html,{fileName:'synthetic-'+language+'.html'});
  assert.deepEqual(imported.records,{['msa.session.'+session.id]:session,...exportInfo.workspaceRecords});
  assert.equal(JSON.stringify({session,exportInfo}),before);
});

test('explicit report language and Traditional default are independent of UI globals and leave CSV unchanged',()=>{
  const {session,exportInfo} = fixture();
  const prior = globalThis.MSAI18n;
  const csvBefore = battle.toCSV(session), eventsBefore = battle.toEventsCSV(session), handBefore = recorder.toCSV(session);
  try {
    globalThis.MSAI18n = {language:'en',t:()=> 'UI GLOBAL MUST NOT ENTER REPORT'};
    const defaultHTML = battle.toHTML(session,{exportInfo}), defaultMD = battle.toMarkdown(session,{exportInfo});
    assert.equal(defaultHTML,battle.toHTML(session,{exportInfo,language:'zh-TW'}));
    assert.equal(defaultMD,battle.toMarkdown(session,{exportInfo,language:'zh-TW'}));
    assert.equal(defaultHTML,battle.toHTML(session,{exportInfo,language:'unsupported'}));
    for(const language of ['zh-TW','zh-CN','en']) {
      assert.doesNotMatch(battle.toHTML(session,{language,exportInfo}),/UI GLOBAL MUST NOT ENTER REPORT/);
      assert.doesNotMatch(battle.toMarkdown(session,{language,exportInfo}),/UI GLOBAL MUST NOT ENTER REPORT/);
      assert.equal(battle.toCSV(session),csvBefore);assert.equal(battle.toEventsCSV(session),eventsBefore);assert.equal(recorder.toCSV(session),handBefore);
    }
  } finally { if(prior===undefined)delete globalThis.MSAI18n;else globalThis.MSAI18n=prior; }
});

test('reason lookup only translates exact known recorder reasons and approved suffixes',()=>{
  const en = reportI18n.create('en'), cn = reportI18n.create('zh-CN');
  assert.equal(en.knownReason(KNOWN_WARNING),en.t(KNOWN_WARNING));
  assert.equal(cn.knownReason(en.t(KNOWN_REASON)),cn.t(KNOWN_REASON));
  assert.equal(en.knownReason('USER '+KNOWN_WARNING),'USER '+KNOWN_WARNING);
  assert.equal(en.knownReason('未知'),'未知');
  const suffix = '；既有紀錄含暫存缺口，請查看報告警告';
  assert.equal(en.knownReason('已更新公開 Log'+suffix),en.t('已更新公開 Log')+en.t(suffix));
  assert.equal(en.knownReason('USER 原文'+suffix),'USER 原文'+suffix);
  assert.equal(en.t('對局 {0} · 玩家 {1}','x','{0} 未知'), 'Game x · Player {0} 未知');
  for(const key of ['頁面或記錄設定切換時仍有觀察尚未確認存妥；舊暫存已隔離，未送往其他對局',
    '暫存已滿，部分已觀察狀態未能排入儲存佇列','部分觀察格式被拒絕，已隔離原件；有效觀察繼續保存，請在原分頁下載救援備份']) {
    assert.notEqual(en.knownReason(key),key);assert.equal(cn.knownReason(en.knownReason(key)),cn.t(key));
  }
});

test('all report languages keep hostile user values inert without translating them',()=>{
  const {session,exportInfo} = fixture();
  const payload = '</script><img src=x onerror="alert(1)">[x](javascript:alert(2)) 未知';
  session.battleLog.events[2].rawText = payload;
  session.snapshots[0].reason = payload;
  exportInfo.workspaceRecords['msa.note.report'].note = payload;
  for(const language of ['zh-TW','zh-CN','en']) {
    const html = battle.toHTML(session,{language,exportInfo}), rendered = visible(html), md = battle.toMarkdown(session,{language,exportInfo});
    assert.equal((html.match(/<script\b/gi)||[]).length,2);
    assert.doesNotMatch(rendered,/<img\b|<svg\b|<script\b/i);
    assert.ok(rendered.includes('&lt;/script&gt;&lt;img'));
    assert.ok(md.includes('\\[x\\]\\(javascript:alert\\(2\\)\\)'));
    assert.deepEqual(jsonBlock(html,'msa-record-data'),session);
    assert.deepEqual(jsonBlock(html,'msa-export-info'),exportInfo);
  }
});

test('browser report modules export the same three languages without a UI i18n runtime or network',()=>{
  const context = vm.createContext({});
  for(const file of ['recorder-core.js','export-i18n.js','battle-log-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',file),'utf8'),context,{filename:file});
  }
  const {session,exportInfo} = fixture();
  for(const language of ['zh-TW','zh-CN','en']) {
    const options = {language,exportInfo};
    assert.equal(context.MSABattleLogCore.toHTML(session,options),battle.toHTML(session,options));
    assert.equal(context.MSABattleLogCore.toMarkdown(session,options),battle.toMarkdown(session,options));
  }
});
