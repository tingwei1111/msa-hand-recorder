'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tracker = require('../extension/deck-tracker-core.js');
const battle = require('../extension/battle-log-core.js');
const GAME='00000000-0000-4000-8000-000000000901',RUN='10000000-0000-4000-8000-000000000901';
const ID=GAME+'.'+RUN,DECK='deck-synthetic.v-one',PLAYER='Demo North',OPPONENT='Demo South';
const WHEN='2000-01-01T00:00:00.000Z',LATER='2000-01-02T00:00:00.000Z';
const copy=value=>JSON.parse(JSON.stringify(value));
function deck(id=DECK,overrides={}) {
  return {schemaVersion:1,id,deckId:'deck-synthetic',name:'Synthetic 50',createdAt:WHEN,
    main:Array.from({length:13},(_,i)=>({cardCode:'GD99-'+String(i+1).padStart(3,'0'),count:i===12?2:4})),resources:[{cardCode:'R-001',count:10}],tokens:[{cardCode:'T-001',count:2}],...overrides};
}
function snapshot(overrides={}) {
  return {id:ID+':1',timestamp:WHEN,turn:1,turnSource:'log',observedTurn:1,phase:'MAIN',quality:'complete',expectedCount:2,unknownCount:0,
    hand:[{cardCode:'GD99-001',count:2}],...overrides};
}
function source(overrides={}) {return {schemaVersion:1,id:ID,gameId:GAME,playerName:PLAYER,snapshots:[snapshot()],...overrides};}
function match(id='match-synthetic',overrides={}) {
  return {schemaVersion:1,id,gameId:GAME,playerName:PLAYER,source:'manual',identityConfirmed:true,sourceSessionId:ID,
    deckVersionId:DECK,frozenDeckVersion:deck(),updatedAt:WHEN,result:'unknown',resultConfirmed:false,...overrides};
}
function input(overrides={}) {
  const saved=source();
  return {values:{['msa.session.'+ID]:saved,['msa.deck.'+DECK]:deck(),'msa.match.match-synthetic':match()},
    context:{gameId:GAME,runId:RUN,playerName:PLAYER},handModel:{sessionId:ID,quality:'complete',latestSnapshot:copy(saved.snapshots[0]),handCards:copy(saved.snapshots[0].hand)},
    events:[],players:[PLAYER,OPPONENT],coverage:{completeFromStart:true},...overrides};
}
const row=(model,code)=>model.rows.find(item=>item.cardCode===code);
const play=(cardCode='GD99-001',actor=PLAYER,overrides={})=>({action:'deploy-unit',isPlay:true,actor,primaryCard:{cardCode,name:'Synthetic unit'},sourceZone:'unknown',...overrides});
function freeze(value) {Object.freeze(value);for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);return value;}

test('CommonJS uses packaged Wasm without Chrome or network, and the browser facade waits for initialization',()=>{
  assert.equal(globalThis.MSADeckTrackerCore,tracker);
  const realm=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../extension/deck-tracker-core.js'),'utf8'),realm);
  assert.equal(typeof realm.MSADeckTrackerCore.project,'function');
  assert.equal(realm.MSADeckTrackerCore.engineStatus().state,'loading');
  assert.throws(()=>realm.MSADeckTrackerCore.project(),/載入中/);
  assert.deepEqual(tracker.engineStatus(),{engine:'rust-wasm',state:'ready'});
  const args=freeze(input()),before=JSON.stringify(args),model=tracker.project(args);
  model.rows[0].deckCount=99;model.availableDecks[0].name='Changed';assert.equal(JSON.stringify(args),before);
});
test('the bound frozen full deck has exact current-run hand counts and no remaining-deck calculation',()=>{
  const model=tracker.project(input());assert.equal(model.state,'bound');assert.equal(model.rows.length,13);
  assert.deepEqual(model.deck,{id:DECK,name:'Synthetic 50',mainCount:50});assert.equal(model.canBind,true);assert.equal(model.sessionId,ID);assert.equal(model.contextKey,ID);
  assert.deepEqual(row(model,'GD99-001'),{cardCode:'GD99-001',name:'',deckCount:4,handCount:2,handCountKind:'exact',publicUseCount:0,outsideDeck:false});
  assert.equal(row(model,'GD99-002').handCount,0);assert.equal(row(model,'GD99-002').handCountKind,'exact');
  assert.equal('remaining' in model,false);assert.equal(model.rows.some(value=>'remaining' in value),false);
});
test('later edits or deletion of the saved version do not replace a valid frozen deck',()=>{
  const args=input();args.values['msa.deck.'+DECK]=deck(DECK,{name:'A different saved name'});
  assert.equal(tracker.project(args).deck.name,'Synthetic 50');delete args.values['msa.deck.'+DECK];
  assert.equal(tracker.project(args).state,'bound');assert.equal(tracker.project(args).availableDecks.length,0);
});
test('a malformed frozen version never falls back to a valid global version',()=>{
  for(const frozen of [deck('wrong-version'),deck(DECK,{main:[]}),{schemaVersion:2,id:DECK},{}]){
    const args=input();args.values['msa.match.match-synthetic'].frozenDeckVersion=frozen;
    const model=tracker.project(args);assert.equal(model.state,'invalid');assert.equal(model.deck,null);assert.equal(model.rows.length,0);
  }
});
test('legacy records without frozen data can use the same stored version with an explicit caveat',()=>{
  const args=input();delete args.values['msa.match.match-synthetic'].frozenDeckVersion;
  assert.equal(tracker.project(args).state,'bound');assert.match(tracker.project(args).warnings.join(' '),/缺少凍結/);
  delete args.values['msa.deck.'+DECK];assert.equal(tracker.project(args).state,'invalid');
});
test('latest game/player binding wins, including an explicit unbind, instead of reviving an older deck',()=>{
  const args=input();args.values['msa.match.latest']=match('latest',{deckVersionId:null,frozenDeckVersion:null,updatedAt:LATER});
  const model=tracker.project(args);assert.equal(model.state,'unbound');assert.equal(model.rows.length,0);assert.equal(model.availableDecks.length,1);
  args.values['msa.match.latest'].frozenDeckVersion=deck();assert.equal(tracker.project(args).state,'unbound');
});
test('wrong-key, wrong-schema, other-game, other-player and automatic matches cannot bind this game',()=>{
  const args=input();delete args.values['msa.match.match-synthetic'];
  Object.assign(args.values,{'msa.match.wrong-key':match(),'msa.match.wrong-schema':match('wrong-schema',{schemaVersion:2}),
    'msa.match.other-game':match('other-game',{gameId:GAME+'-other'}),'msa.match.other-player':match('other-player',{playerName:OPPONENT}),
    'msa.match.auto':match('auto',{source:'automatic'}),'msa.match.unconfirmed':match('unconfirmed',{identityConfirmed:false}),
    'msa.match.undefined':{schemaVersion:1,source:'manual',identityConfirmed:true}});
  assert.equal(tracker.project(args).state,'unbound');
});
test('unknown identity does not reveal another player deck binding or hand counts',()=>{
  const args=input({context:{gameId:GAME,runId:RUN,playerName:''},events:[play('GD99-001',PLAYER),play('GD99-002',OPPONENT)]});
  const model=tracker.project(args);assert.equal(model.state,'identity-unknown');assert.equal(model.canBind,false);assert.equal(model.sessionId,null);
  assert.equal(model.deck,null);assert.deepEqual(model.rows,[]);assert.equal(model.publicCards.own.length,0);assert.equal(model.publicCards.opponent.length,0);assert.equal(model.publicCards.unknown.length,2);
});
test('public uses count every supported occurrence, even when repeated use exceeds the deck quantity',()=>{
  const args=input({events:Array.from({length:6},()=>play())}),model=tracker.project(args);
  assert.equal(row(model,'GD99-001').publicUseCount,6);assert.equal(row(model,'GD99-001').deckCount,4);assert.equal(row(model,'GD99-001').handCount,2);
  assert.equal(model.publicCards.own[0].count,6);assert.match(model.publicNote,/再次使用會重複/);
});
test('all seven supported play classifications aggregate the primary card',()=>{
  const actions=['deploy-unit','play-command','play-action','play-base','replace-base','pair-pilot','link-pilot'];
  const model=tracker.project(input({events:actions.map(action=>play('GD99-001',PLAYER,{action}))}));
  assert.equal(row(model,'GD99-001').publicUseCount,7);assert.equal(model.unsupportedPublicCount,0);
});
test('actual pilot pairing and base replacement count their primary played card, not the target',()=>{
  const events=battle.parseRows([{text:'Paired pilot: Synthetic Pilot to Synthetic Unit',actor:PLAYER,cards:[{cardCode:'GD99-002',name:'Synthetic Pilot'},{cardCode:'GD99-001',name:'Synthetic Unit'}]},
    {text:'Replaced Synthetic Old base: Synthetic New',actor:PLAYER,cards:[{cardCode:'GD99-003',name:'Synthetic Old'},{cardCode:'GD99-004',name:'Synthetic New'}]}]);
  const model=tracker.project(input({events}));assert.equal(row(model,'GD99-002').publicUseCount,1);assert.equal(row(model,'GD99-001').publicUseCount,0);
  assert.equal(row(model,'GD99-004').publicUseCount,1);assert.equal(row(model,'GD99-003').publicUseCount,0);
});
test('tokens and generated cards remain separate from uses, including bad isPlay flags',()=>{
  const events=[play('T-001',PLAYER,{action:'deploy-token',isPlay:false,sourceZone:'generated'}),play('T-001',OPPONENT),
    play('GD99-002',PLAYER,{sourceZone:'generated'}),play('T-001',PLAYER,{action:'return-hand',isPlay:false})];
  const model=tracker.project(input({events}));assert.equal(model.publicCards.tokens.reduce((sum,value)=>sum+value.count,0),3);
  assert.deepEqual(model.publicCards.tokens.map(value=>value.side).sort(),['opponent','own','own']);
  assert.equal(model.publicCards.own.length,0);assert.equal(model.publicCards.opponent.length,0);assert.equal(row(model,'GD99-002').publicUseCount,0);
  assert.equal(model.rows.some(value=>value.cardCode==='T-001'),false);
});
test('returns, draws, shields and targets never add uses or borrow their card links',()=>{
  const actions=['draw','return-hand','return-deck','discard','shield-to-hand','shield-reveal','attack','select-target'];
  const model=tracker.project(input({events:actions.map(action=>play('GD99-003',PLAYER,{action,isPlay:false}))}));
  assert.equal(model.publicCards.own.length,0);assert.equal(row(model,'GD99-003').publicUseCount,0);
});
test('opponents require known player identity and unknown actors remain a separate area',()=>{
  const model=tracker.project(input({events:[play('GD99-001',OPPONENT),play('GD99-001','Unverified name'),play('GD99-001','')]}));
  assert.equal(model.publicCards.opponent.length,1);assert.equal(model.publicCards.opponent[0].actor,OPPONENT);
  assert.equal(model.publicCards.unknown.length,2);assert.equal(row(model,'GD99-001').publicUseCount,0);
  const withoutPlayers=tracker.project(input({events:[play('GD99-001',OPPONENT)],players:[]}));assert.equal(withoutPlayers.publicCards.opponent.length,0);assert.equal(withoutPlayers.publicCards.unknown.length,1);
});
test('unknown primary card identities stay unknown even when another target is linked',()=>{
  const model=tracker.project(input({events:[play('GD99-001',PLAYER,{primaryCard:{cardCode:null,name:'Unidentified card'},cards:[{cardCode:'GD99-003',name:'Target'}]}),play('GD99-001',PLAYER,{primaryCard:null})]}));
  assert.equal(model.publicCards.own.length,0);assert.equal(model.publicCards.unknown.length,2);assert.equal(model.publicCards.unknown.every(value=>value.cardCode===null),true);
  assert.equal(row(model,'GD99-003').publicUseCount,0);
});
test('unsupported actions with an isPlay flag are counted only as unsupported observations',()=>{
  const model=tracker.project(input({events:[play('GD99-002',PLAYER,{action:'future-action'}),play('GD99-003',PLAYER,{action:'draw'})]}));
  assert.equal(model.unsupportedPublicCount,2);assert.equal(model.publicCards.own.length,0);assert.match(model.warnings.join(' '),/2 筆未支援/);
});
test('partial hands expose positive lower bounds while absent cards stay unknown',()=>{
  const args=input();args.handModel.quality='partial';args.handModel.latestSnapshot.quality='partial';args.handModel.latestSnapshot.unknownCount=1;args.handModel.latestSnapshot.expectedCount=3;
  const model=tracker.project(args);assert.equal(row(model,'GD99-001').handCount,2);assert.equal(row(model,'GD99-001').handCountKind,'at-least');
  assert.equal(row(model,'GD99-002').handCount,null);assert.equal(row(model,'GD99-002').handCountKind,'unknown');
});
test('unavailable or malformed hand evidence never becomes a zero-card claim',()=>{
  const args=input();args.handModel.quality='unavailable';let model=tracker.project(args);
  assert.equal(model.rows.every(value=>value.handCount===null&&value.handCountKind==='unknown'),true);
  args.handModel.quality='complete';args.handModel.latestSnapshot.expectedCount=null;model=tracker.project(args);
  assert.equal(row(model,'GD99-001').handCountKind,'at-least');assert.equal(row(model,'GD99-002').handCount,null);
  args.handModel.handCards.push({cardCode:'GD99-002',count:0});model=tracker.project(args);assert.equal(model.rows.every(value=>value.handCount===null),true);
});
test('confirmed empty hands differ from missing or foreign-run evidence',()=>{
  const args=input();args.handModel.handCards=[];args.handModel.latestSnapshot.hand=[];args.handModel.latestSnapshot.expectedCount=0;
  let model=tracker.project(args);assert.equal(model.rows.every(value=>value.handCount===0&&value.handCountKind==='exact'),true);
  args.handModel.latestSnapshot.sourceSessionId='other-run';model=tracker.project(args);assert.equal(model.rows.every(value=>value.handCount===null),true);
  delete args.handModel.latestSnapshot.sourceSessionId;args.handModel.sessionId='other-run';model=tracker.project(args);assert.equal(model.rows.every(value=>value.handCount===null),true);
});
test('a stored source owned by a different player or a missing snapshot revokes bind and hand evidence',()=>{
  const args=input();args.values['msa.session.'+ID].playerName=OPPONENT;let model=tracker.project(args);
  assert.equal(model.canBind,false);assert.equal(model.sessionId,null);assert.equal(model.rows.every(value=>value.handCount===null),true);
  args.values['msa.session.'+ID].playerName=PLAYER;args.values['msa.session.'+ID].snapshots=[];model=tracker.project(args);
  assert.equal(model.canBind,false);assert.equal(model.rows.every(value=>value.handCount===null),true);
});
test('outside-deck own observations warn without altering the saved main deck or adding opponent cards',()=>{
  const args=input({events:[play('GD99-099'),play('GD99-098',OPPONENT)]});
  args.handModel.handCards=[{cardCode:'GD99-097',count:2}];const model=tracker.project(args);
  assert.equal(row(model,'GD99-097').outsideDeck,true);assert.equal(row(model,'GD99-099').deckCount,0);assert.equal(row(model,'GD99-098'),undefined);
  assert.equal(model.deck.mainCount,50);assert.match(model.warnings.join(' '),/2 種牌表外/);assert.equal(args.values['msa.deck.'+DECK].main.length,13);
});
test('a hand larger than a bound card allocation is preserved as an anomaly rather than clamped',()=>{
  const args=input();args.handModel.handCards[0].count=5;args.handModel.latestSnapshot.expectedCount=5;
  const model=tracker.project(args);assert.equal(row(model,'GD99-001').handCount,5);assert.equal(row(model,'GD99-001').deckCount,4);assert.match(model.warnings.join(' '),/超過/);
});
test('available versions require matching keys, supported schemas, 50-card format and separate resource/token zones',()=>{
  const args=input();delete args.values['msa.deck.'+DECK];
  const wrong=deck('invalid-total',{main:[{cardCode:'GD99-001',count:4}]});
  const over=deck('over-count');over.main[0].count=5;over.main[1].count=3;
  const resource=deck('resource-main');resource.main[0].cardCode='R-001';
  const noZone=deck('no-zone');delete noZone.tokens;
  const noDeckId=deck('no-deck-id');delete noDeckId.deckId;
  const bad={...deck('wrong-schema'),schemaVersion:2};
  for(const record of [wrong,over,resource,noZone,noDeckId,bad])args.values['msa.deck.'+record.id]=record;
  args.values['msa.deck.wrong-key']=deck('different-id');args.values['msa.deck.valid']=deck('valid');
  const model=tracker.project(args);assert.deepEqual(model.availableDecks,[{id:'valid',name:'Synthetic 50'}]);
});
test('duplicate declared deck rows merge without exceeding the four-copy limit',()=>{
  const args=input();const d=deck();d.main[0].count=2;d.main.push({cardCode:'GD99-001',count:2});
  args.values['msa.deck.'+DECK]=d;args.values['msa.match.match-synthetic'].frozenDeckVersion=copy(d);
  const model=tracker.project(args);assert.equal(model.state,'bound');assert.equal(row(model,'GD99-001').deckCount,4);assert.equal(model.rows.length,13);
});
test('selected-version statistics deduplicate the latest game/player record before filtering',()=>{
  const args=input();
  const add=(id,gameId,result,extra={})=>{args.values['msa.match.'+id]=match(id,{gameId,result,resultConfirmed:result!=='unknown',...extra});};
  add('win',GAME+'-win','win');add('loss',GAME+'-loss','loss');add('draw',GAME+'-draw','draw');add('concede',GAME+'-concede','concede');
  add('older',GAME+'-duplicate','win');add('newer',GAME+'-duplicate','loss',{updatedAt:LATER});
  add('deck-old',GAME+'-rebound','win');add('deck-new',GAME+'-rebound','win',{updatedAt:LATER,deckVersionId:'deck-other'});
  add('result-old',GAME+'-uncertain','win');add('result-new',GAME+'-uncertain','unknown',{updatedAt:LATER});
  add('foreign',GAME+'-foreign','win',{playerName:OPPONENT});add('automatic',GAME+'-automatic','win',{source:'automatic'});
  const model=tracker.project(args);assert.deepEqual(model.stats,{confirmed:5,wins:1,losses:2,draws:1,concedes:1,winRate:.2});
  assert.equal('matches' in model.stats,false);
});
test('statistics reject mismatched record keys and do not treat unconfirmed results as losses',()=>{
  const args=input();args.values['msa.match.wrong-key']=match('other-id',{gameId:GAME+'-other',result:'win',resultConfirmed:true});
  args.values['msa.match.unconfirmed']=match('unconfirmed',{gameId:GAME+'-pending',result:'loss',resultConfirmed:false});
  args.values['msa.match.unknown-result']=match('unknown-result',{gameId:GAME+'-future',result:'future',resultConfirmed:true});
  assert.deepEqual(tracker.project(args).stats,{confirmed:0,wins:0,losses:0,draws:0,concedes:0,winRate:null});
});
test('latest timestamps use actual parsed instants, with deterministic ID ties',()=>{
  const args=input();args.values['msa.match.match-synthetic'].updatedAt='2000-01-01T01:00:00+01:00';
  args.values['msa.match.z-new']=match('z-new',{updatedAt:'2000-01-01T00:00:00Z',deckVersionId:null,frozenDeckVersion:null});
  assert.equal(tracker.project(args).state,'unbound');
  args.values['msa.match.z-new'].updatedAt='1999-12-31T23:00:00Z';assert.equal(tracker.project(args).state,'bound');
});
test('coverage warnings stay visible without changing source event counts or inventing card locations',()=>{
  const args=input({events:[play()],coverage:{hasGaps:true,unmergedCaptureCount:1}}),model=tracker.project(args);
  assert.equal(row(model,'GD99-001').publicUseCount,1);assert.match(model.publicNote,/缺口/);assert.match(model.publicNote,/不推算剩餘/);
  const clean=tracker.project(input({coverage:{publicLogComplete:true}}));assert.match(clean.publicNote,/已見起尾/);
});
