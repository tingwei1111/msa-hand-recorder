'use strict';

// Synthetic values only. The reference is the unchanged v0.7.0 JavaScript
// projection, retained solely to check the Rust/Wasm migration contract.
const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reference = require('./fixtures/deck-tracker-js-reference.cjs');
const tracker = require('../extension/deck-tracker-core.js');
const recorder = require('../extension/recorder-core.js');
const battle = require('../extension/battle-log-core.js');
const library = require('../extension/library-core.js');

const GAME = '00000000-0000-4000-8000-000000001101';
const RUN = '10000000-0000-4000-8000-000000001101';
const SESSION = GAME + '.' + RUN;
const VERSION = 'synthetic-deck.v-one';
const PLAYER = 'Synthetic North';
const OPPONENT = 'Synthetic South';
const WHEN = '2000-01-01T00:00:00.000Z';
const clone = value => structuredClone(value);

function deck(id = VERSION, extra = {}) {
  return {schemaVersion:1,id,deckId:'synthetic-deck',name:'Synthetic 50',createdAt:WHEN,
    main:Array.from({length:13},(_,index) => ({cardCode:'GD99-' + String(index+1).padStart(3,'0'),count:index===12?2:4})),
    resources:[{cardCode:'R-001',count:10}],tokens:[{cardCode:'T-001',count:2}],...extra};
}
function match(id = 'synthetic-match', extra = {}) {
  return {schemaVersion:1,id,gameId:GAME,playerName:PLAYER,identityConfirmed:true,source:'manual',
    sourceSessionId:SESSION,deckVersionId:VERSION,frozenDeckVersion:deck(),updatedAt:WHEN,
    result:'unknown',resultConfirmed:false,firstPlayer:'unknown',...extra};
}
function input(extra = {}) {
  const snapshot = {id:SESSION + ':1',timestamp:WHEN,quality:'complete',expectedCount:2,unknownCount:0,
    turn:1,turnSource:'log',observedTurn:1,phase:'MAIN',hand:[{cardCode:'GD99-001',count:2}]};
  const source = {schemaVersion:1,id:SESSION,gameId:GAME,playerName:PLAYER,startedAt:WHEN,updatedAt:WHEN,snapshots:[snapshot]};
  return {values:{['msa.session.' + SESSION]:source,['msa.deck.' + VERSION]:deck(),'msa.match.synthetic-match':match()},
    context:{gameId:GAME,runId:RUN,playerName:PLAYER},handModel:{sessionId:SESSION,latestSnapshot:clone(snapshot),quality:'complete',handCards:clone(snapshot.hand)},
    events:[],players:[PLAYER,OPPONENT],coverage:{completeFromStart:true},...extra};
}
function play(extra = {}) {
  return {action:'deploy-unit',isPlay:true,actor:PLAYER,primaryCard:{cardCode:'GD99-001',name:'Synthetic unit'},sourceZone:'unknown',...extra};
}
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
function parity(value, label) {
  const before = clone(value);
  const expected = reference.project(value);
  const actual = tracker.project(value);
  assert.deepEqual(actual,expected,label);
  assert.deepEqual(value,before,'projection mutated its source: ' + label);
  return actual;
}
function generator(seed) {
  let state = seed >>> 0;
  return count => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % count;
  };
}

test.before(async()=>{
  assert.equal(typeof tracker.ready,'function','the Wasm facade must expose its actual initialization');
  await tracker.ready();
  assert.equal(tracker.engineStatus().engine,'rust-wasm');
  assert.equal(tracker.engineStatus().state,'ready','parity must execute a ready Rust/Wasm engine');
});

test('the production facade reports a ready Rust/Wasm backend rather than a JavaScript fallback',()=>{
  assert.equal(tracker.engineStatus().engine,'rust-wasm');
  assert.equal(tracker.engineStatus().state,'ready');
});

test('the migration oracle remains the recorded v0.7 JavaScript implementation', () => {
  const source = fs.readFileSync(path.join(__dirname,'fixtures/deck-tracker-js-reference.cjs'),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),'19a0c1b465f6f7ded805fa95764648d9356d9f48e5c49174fb167783d4905ed5');
  assert.match(source,/const api = factory\(\)/);
  assert.match(source,/return Object\.freeze\(\{project\}\)/);
  assert.equal(reference.project(input()).state,'bound');
});

test('Rust/Wasm projects the complete deck without mutating frozen inputs', () => {
  const value = frozen(input({events:[play(),play(),play({actor:OPPONENT})]}));
  const actual = parity(value,'bound full deck');
  assert.equal(actual.rows[0].publicUseCount,2);
  actual.rows[0].deckCount=99;actual.availableDecks[0].name='Changed output';
  assert.equal(value.values['msa.deck.'+VERSION].main[0].count,4);
  assert.equal(value.values['msa.deck.'+VERSION].name,'Synthetic 50');
});

test('empty and malformed JSON-shaped optional containers keep the old projection behavior', () => {
  const values = [{},17,false,'not an input object',[],{values:null,context:null,handModel:null,events:null,players:null,coverage:null},
    {values:[],context:[],handModel:[],events:{},players:{},coverage:[]},
    {values:1,context:'not a context',handModel:false,events:1,players:'Synthetic South'},
    {context:{gameId:17,runId:[],playerName:false}}];
  for(const [index,value] of values.entries())parity(value,'optional containers ' + index);
  assert.deepEqual(tracker.project(),reference.project());
  assert.throws(()=>reference.project(null),TypeError);
  assert.throws(()=>tracker.project(null),TypeError);
});

test('frozen versions, explicit unbinding and malformed records preserve legacy selection semantics', () => {
  const variants = [];
  let value=input();value.values['msa.deck.'+VERSION].name='Later global edit';variants.push(value);
  value=input();delete value.values['msa.deck.'+VERSION];variants.push(value);
  value=input();delete value.values['msa.match.synthetic-match'].frozenDeckVersion;variants.push(value);
  value=input();value.values['msa.match.synthetic-match'].frozenDeckVersion={};variants.push(value);
  for(const frozenVersion of [false,0,'',[],1]){
    value=input();value.values['msa.match.synthetic-match'].frozenDeckVersion=frozenVersion;variants.push(value);
  }
  value=input();value.values['msa.match.newest']=match('newest',{updatedAt:'2000-01-02T00:00:00Z',deckVersionId:null,frozenDeckVersion:null});variants.push(value);
  value=input();delete value.values['msa.match.synthetic-match'];value.values['msa.match.bad-key']=match();variants.push(value);
  for(const [index,item] of variants.entries())parity(item,'frozen/selection ' + index);
});

test('JavaScript truthiness remains distinct from missing deck IDs and source-run strings',()=>{
  for(const id of [undefined,null,false,0,'',[],{},1]){
    const value=input();value.values['msa.match.synthetic-match'].deckVersionId=id;
    parity(value,'deck ID truthiness ' + JSON.stringify(id));
  }
  for(const runId of ['',null,false,0,[],{}])parity(input({context:{gameId:GAME,runId,playerName:PLAYER}}),'run string ' + JSON.stringify(runId));
});

test('exact, lower-bound, unknown and foreign-run hands preserve count meaning', () => {
  const variants=[];
  let value=input();value.handModel.quality='partial';value.handModel.latestSnapshot.quality='partial';value.handModel.latestSnapshot.unknownCount=1;variants.push(value);
  value=input();value.handModel.quality='unavailable';variants.push(value);
  value=input();value.handModel.latestSnapshot.expectedCount=null;variants.push(value);
  value=input();value.handModel.handCards=[];value.handModel.latestSnapshot.expectedCount=0;variants.push(value);
  value=input();value.handModel.latestSnapshot.sourceSessionId='foreign-run';variants.push(value);
  value=input();value.handModel.sessionId='foreign-run';variants.push(value);
  value=input();value.values['msa.session.'+SESSION].snapshots=[];variants.push(value);
  value=input();value.values['msa.session.'+SESSION].playerName=OPPONENT;variants.push(value);
  value=input();value.handModel.handCards=[{cardCode:'GD99-099',count:5}];value.handModel.latestSnapshot.expectedCount=5;variants.push(value);
  for(const [index,item] of variants.entries())parity(item,'hand evidence ' + index);
});

test('safe-integer validation and repeated-card sums agree at JavaScript numeric boundaries',()=>{
  for(const count of [0,-0,-1,.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,NaN,Infinity]){
    const value=input();value.handModel.handCards=[{cardCode:'GD99-001',count}];
    value.handModel.latestSnapshot.expectedCount=count;
    parity(value,'safe integer hand count ' + String(count));
  }
  const value=input();
  value.handModel.handCards=[{cardCode:'GD99-001',count:Number.MAX_SAFE_INTEGER},{cardCode:'GD99-001',count:Number.MAX_SAFE_INTEGER}];
  value.handModel.latestSnapshot.expectedCount=null;
  parity(value,'summed repeated large card observations');
});

test('all public primary-card classes preserve duplicates, unknowns and generated-card separation', () => {
  const events=['deploy-unit','play-command','play-action','play-base','replace-base','pair-pilot','link-pilot']
    .map(action=>play({action}));
  events.push(play(),play(),play({actor:OPPONENT}),play({actor:''}),play({actor:'Unverified actor'}),
    play({primaryCard:null,cards:[{cardCode:'GD99-099',name:'Unrelated target'}]}),
    play({primaryCard:{cardCode:null,name:'Unknown public card'}}),
    play({action:'deploy-token',isPlay:false,primaryCard:{cardCode:'T-001',name:'Synthetic token'}}),
    play({sourceZone:'generated'}),play({action:'return-hand',isPlay:false}),
    play({action:'future-public-format'}),play({isPlay:'true'}));
  parity(input({events}),'public primary cards');
  parity(input({events,context:{gameId:GAME,runId:RUN,playerName:''}}),'anonymous public-only projection');
});

test('public card normalization retains host Unicode uppercase rather than an ASCII-only approximation',()=>{
  const events=[' gd99-001 ','\ufeffgd99-002\u00a0','ſt04-010','ſlb01-001'].map(cardCode=>
    play({primaryCard:{cardCode,name:'Synthetic normalization'}}));
  const actual=parity(input({events}),'Unicode public card normalization');
  assert.ok(actual.publicCards.own.some(row=>row.cardCode==='ST04-010'));
  assert.ok(actual.publicCards.own.some(row=>row.cardCode==='SLB01-001'));
});

test('parsed Battle Log pilot/base events retain their primary card rather than linked targets', () => {
  const events=battle.parseRows([
    {text:'Paired pilot: Synthetic Pilot to Synthetic Unit',actor:PLAYER,cards:[{cardCode:'GD99-002',name:'Synthetic Pilot'},{cardCode:'GD99-001',name:'Synthetic Unit'}]},
    {text:'Replaced Synthetic Old base: Synthetic New',actor:PLAYER,cards:[{cardCode:'GD99-003',name:'Synthetic Old'},{cardCode:'GD99-004',name:'Synthetic New'}]}
  ]);
  parity(input({events}),'actual log parser output');
});

test('host date parsing preserves offset, legacy-format, invalid and coercible timestamps', () => {
  const times=[WHEN,'1999-12-31T16:00:00-08:00','2000-01-01T02:00:00+02:00',
    'Sat, 01 Jan 2000 00:00:00 GMT','January 2, 2000 00:00:00 GMT','2000-02-30',
    'not a date','',null,0,1,99,[],[2000],[2000,1,2]];
  for(const [index,stamp] of times.entries()) {
    const value=input();
    value.values['msa.match.synthetic-match'].updatedAt=stamp;
    value.values['msa.match.z-last']=match('z-last',{updatedAt:WHEN,deckVersionId:null,frozenDeckVersion:null});
    value.values['msa.deck.'+VERSION].createdAt=stamp;
    value.values['msa.deck.extra']=deck('extra',{name:'Additional synthetic deck',createdAt:WHEN});
    parity(value,'host date ' + index + ': ' + JSON.stringify(stamp));
  }
});

test('English collation and insertion-order ties match the browser-facing JavaScript order', () => {
  const names=['a','A','á','ä','a2','a10','_a','-a','測試','🙂','１２','12','é','e\u0301'];
  const value=input();
  for(const [index,name] of names.entries()) {
    const id='collation-'+String(index).padStart(2,'0');
    value.values['msa.deck.'+id]=deck(id,{name});
    value.events.push(play({actor:name,primaryCard:{cardCode:'GD99-004',name}}));
  }
  parity(value,'English collation');
  const tie=input();
  tie.values['msa.deck.first']=deck('first',{name:'é'});
  tie.values['msa.deck.second']=deck('second',{name:'e\u0301'});
  parity(tie,'equivalent-collation tie order');
});

test('JS trim and UTF-16 length/slicing keep non-BMP names compatible', () => {
  const names=['\ufeff Synthetic North \u00a0','\u200bSynthetic North\u200b','\u0085Synthetic North\u0085','\u2028Synthetic North\u2029'];
  for(const [index,name] of names.entries())parity(input({context:{gameId:GAME,runId:RUN,playerName:name}}),'trim ' + index);
  for(const size of [59,60,61]) {
    const value=input();value.values['msa.deck.'+VERSION].name='😀'.repeat(size);
    value.values['msa.match.synthetic-match'].frozenDeckVersion.name='😀'.repeat(size);
    parity(value,'UTF-16 deck length ' + size);
  }
  for(const name of ['\ufeff Synthetic name \u00a0',' '+'x'.repeat(119)+' ','\u200b','\ufeff\u00a0']){
    const value=input();value.values['msa.deck.'+VERSION].name=name;
    value.values['msa.match.synthetic-match'].frozenDeckVersion.name=name;
    parity(value,'raw deck name versus trimmed validation');
  }
  for(const name of ['x'.repeat(299)+'😀suffix','😀'.repeat(151),'e\u0301'.repeat(151),'中文'.repeat(151)]) {
    parity(input({events:[play({primaryCard:{cardCode:'GD99-001',name}})]}),'UTF-16 public name slice');
  }
});

test('the lossless boundary preserves undefined, non-finite values and existing lone UTF-16 surrogates',()=>{
  for(const stamp of [undefined,NaN,Infinity,-Infinity]){
    const value=input();value.values['msa.match.synthetic-match'].updatedAt=stamp;
    value.values['msa.match.z-last']=match('z-last',{updatedAt:WHEN,deckVersionId:null,frozenDeckVersion:null});
    value.coverage={hasGaps:stamp,unmergedCaptureCount:stamp,publicLogComplete:stamp};
    value.unused={nested:[undefined,NaN,Infinity,-Infinity]};
    parity(value,'lossless number ' + String(stamp));
  }
  for(const name of ['lone-high-\ud83d','lone-low-\ude00','pair-😀-\ud800-tail']){
    const value=input({events:[play({primaryCard:{cardCode:'GD99-001',name}})]});
    value.values['msa.deck.'+VERSION].name=name;
    value.values['msa.match.synthetic-match'].frozenDeckVersion.name=name;
    value.unused={['key-'+name]:name};
    parity(value,'lossless UTF-16 ' + JSON.stringify(name));
  }
});

test('latest per-game statistics keep confirmed results and historical deck reassignment semantics', () => {
  const value=input();
  const add=(id,gameId,result,extra={})=>{value.values['msa.match.'+id]=match(id,{gameId,result,resultConfirmed:true,...extra});};
  add('win',GAME+'-win','win');add('loss',GAME+'-loss','loss');add('draw',GAME+'-draw','draw');add('concede',GAME+'-concede','concede');
  add('old-result',GAME+'-unknown','win');add('new-result',GAME+'-unknown','unknown',{updatedAt:'2000-01-02T00:00:00Z'});
  add('old-deck',GAME+'-other-deck','win');add('new-deck',GAME+'-other-deck','loss',{updatedAt:'2000-01-02T00:00:00Z',deckVersionId:'another-version'});
  add('foreign-player',GAME+'-foreign','win',{playerName:OPPONENT});
  add('automatic',GAME+'-automatic','win',{source:'automatic'});
  parity(value,'latest game statistics');
});

test('deterministic malformed-field and repeated-event corpus agrees with the original projector', () => {
  const actions=['deploy-unit','play-command','play-action','pair-pilot','link-pilot','play-base','replace-base','deploy-token','return-hand','draw','future-action'];
  const codes=['GD99-001','GD99-002','GD99-099','T-001',null,' gd99-001 ','invalid'];
  const actors=[PLAYER,OPPONENT,'Unverified actor','',null,17];
  const timestamps=[WHEN,'2000-01-02T01:00:00+01:00','January 1, 2000 UTC','invalid',null];
  for(let seed=1;seed<=160;seed++) {
    const next=generator(seed*2654435761),value=input();
    value.events=Array.from({length:next(55)},()=>play({action:actions[next(actions.length)],isPlay:[true,false,'true',null][next(4)],
      actor:actors[next(actors.length)],sourceZone:['unknown','generated',null][next(3)],
      primaryCard:next(5)?{cardCode:codes[next(codes.length)],name:['Synthetic Alpha','Synthetic Beta','',null][next(4)]}:null}));
    if(next(3)===0)value.handModel.quality=['complete','partial','unavailable'][next(3)];
    if(next(3)===0)value.handModel.latestSnapshot.expectedCount=[null,0,2,3,'2',-1][next(6)];
    if(next(4)===0)value.handModel.handCards=[{cardCode:codes[next(codes.length)],count:[0,1,2,5,-1,'2',null,.5][next(8)]}];
    if(next(4)===0)value.context.playerName=[PLAYER,OPPONENT,'',null][next(4)];
    value.coverage={hasGaps:[false,true,0,'pending'][next(4)],publicLogComplete:[false,true][next(2)],unmergedCaptureCount:next(3)};
    const latest=match('new-'+seed,{updatedAt:timestamps[next(timestamps.length)],result:['win','loss','draw','concede','unknown'][next(5)],resultConfirmed:next(2)===1});
    if(next(5)===0)latest.deckVersionId=null;
    if(next(5)===0)latest.playerName=OPPONENT;
    value.values['msa.match.'+latest.id]=latest;
    if(next(4)===0)value.values['msa.match.synthetic-match'].frozenDeckVersion.main[0].count=5;
    parity(value,'seeded corpus ' + seed);
  }
});

test('projecting with Rust leaves JSON workspace backups and standalone HTML import payloads unchanged', () => {
  const value=input(),source=value.values['msa.session.'+SESSION];
  source.recorderVersion='0.7.0';source.futureField={original:['preserve','<literal>',17]};
  const records=clone(value.values),before=JSON.stringify(records);
  const originalBackup=library.createBackup(records,{exportedAt:WHEN});
  const originalHtml=battle.toHTML(source,{exportInfo:{exportedAt:WHEN,workspaceRecords:{
    ['msa.deck.'+VERSION]:records['msa.deck.'+VERSION],'msa.match.synthetic-match':records['msa.match.synthetic-match']}}});
  parity(value,'storage-format-compatible projection');
  assert.equal(JSON.stringify(value.values),before);
  assert.deepEqual(library.createBackup(value.values,{exportedAt:WHEN}),originalBackup);
  const restored=library.parseImport(JSON.stringify(originalBackup));
  assert.deepEqual(restored.records,records);
  const htmlRestored=library.parseImport(originalHtml);
  assert.deepEqual(htmlRestored.records['msa.session.'+SESSION],source);
  assert.deepEqual(htmlRestored.records['msa.deck.'+VERSION],records['msa.deck.'+VERSION]);
  assert.deepEqual(htmlRestored.records['msa.match.synthetic-match'],records['msa.match.synthetic-match']);
  assert.deepEqual(value.values,records);
});

test('browser loading does not invoke Chrome storage or turn the old JS oracle into a runtime dependency', () => {
  const source=fs.readFileSync(require.resolve('../extension/deck-tracker-core.js'),'utf8');
  assert.doesNotMatch(source,/fixtures\/deck-tracker-js-reference/);
  const forbidden=()=>{throw new Error('projection may not write or read Chrome storage');};
  const model=parity(input({unused:{storage:{get:'data only',set:'data only'}}}),'no runtime IO dependency');
  assert.equal(model.state,'bound');
  const realm=vm.createContext({chrome:{storage:{local:{get:forbidden,set:forbidden,remove:forbidden}}},fetch:forbidden});
  // Loading the facade with no extension identity must not probe user storage.
  // Its explicit Wasm lifecycle is verified by the loader tests supplied by root.
  assert.doesNotThrow(()=>vm.runInContext(source,realm));
});
