'use strict';

// Synthetic preferences and records only. These checks do not establish live
// MSA capture coverage or browser layout compatibility.
const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../extension/live-panel-ui.js');
const controllerAPI = require('../extension/live-panel-controller.js');
const GAME = '00000000-0000-4000-8000-000000000601';
const RUN = '10000000-0000-4000-8000-000000000601';
const OTHER = '10000000-0000-4000-8000-000000000602';
const SESSION = `${GAME}.${RUN}`;
const KEY = `msa.session.${SESSION}`;
const PREFS = 'msa.livePanel';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const snapshot = (id = 'synthetic-1', extra = {}) => ({id, timestamp:'2026-01-01T00:00:00Z', turn:null,
  turnSource:'unknown', observedTurn:3, quality:'complete', hand:[{cardCode:'GD01-001',count:2}], ...extra});
const session = extra => ({id:SESSION, gameId:GAME, playerName:'Demo North', snapshots:[snapshot()], ...extra});

function harness(options = {}) {
  let context = {gameId:GAME,runId:RUN,playerName:'Demo North',enabled:true,...options.context};
  const values = structuredClone({[KEY]:session(),...options.values});
  const listeners = new Set(), views = [], calls = [], writes = [];
  let readCount = 0;
  function emit(changes) { for (const listener of listeners) listener(changes,'local'); }
  const storage = {local:{
    async get(request) {
      readCount += 1;
      if (options.get) { const result = options.get(request,readCount,values); if (result !== undefined) return result; }
      if (request === null) return structuredClone(values);
      return Object.hasOwn(values,request) ? {[request]:structuredClone(values[request])} : {};
    },
    async set(patch) {
      writes.push(structuredClone(patch));
      if (options.set) await options.set(patch,writes.length);
      const changes = {};
      for (const [key,value] of Object.entries(patch)) { changes[key]={oldValue:values[key],newValue:structuredClone(value)}; values[key]=structuredClone(value); }
      emit(changes);
    }
  },onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}};
  const api = controllerAPI.create({storage,debounceMs:0,getContext:()=>({...context}),
    project(cache,ctx) {
      const current=cache[`msa.session.${ctx.gameId}.${ctx.runId}`];
      return {gameId:ctx.gameId,playerName:ctx.playerName,sessionId:current?.id || null,
        identityConfirmed:current?.playerName===ctx.playerName,latestSnapshot:current?.snapshots?.at(-1),
        noteIds:Object.keys(cache).filter(key=>key.startsWith('msa.note.'))};
    },
    createUI(callbacks) {
      const view={callbacks,models:[],prefs:[],destroyed:false,
        update(model){this.models.push(structuredClone(model));},setPreferences(value){this.prefs.push(structuredClone(value));},
        focusLauncher(){},destroy(){this.destroyed=true;}};
      views.push(view);return view;
    },
    onCapture:async()=>({ok:true,refreshed:true}),onReview:async()=>({ok:true}),
    onBookmark:async(ctx,payload)=>{calls.push({kind:'bookmark',ctx,payload});return options.bookmark?options.bookmark(ctx,payload):{ok:true};},
    onCardLookup:async code=>{calls.push({kind:'lookup',code});return {status:'notfound',cardCode:code};},
    onDismissAlert:async(ctx,code)=>{calls.push({kind:'dismiss',ctx,code});return {ok:true};},
    onManage:async ctx=>{calls.push({kind:'manage',ctx});return {ok:true};}
  });
  return {api,values,calls,writes,views,view:()=>views.filter(item=>!item.destroyed).at(-1),
    async ready(){api.sync();await tick();},
    changeContext(value,sync=true){context={...context,...value};if(sync)api.sync();},
    change(key,value){if(value===undefined)delete values[key];else values[key]=structuredClone(value);emit({[key]:{newValue:value}});},
    stop(){api.destroy();}};
}

test('old preferences remain valid, preserve unknown fields, and normalize identically in UI/controller', () => {
  const legacy={expanded:true,left:20,top:30,futureOption:{compact:true}};
  const original=structuredClone(legacy);
  for(const normalize of [ui.normalizePreferences,controllerAPI.normalizePreferences]) {
    const value=normalize(legacy);
    assert.equal(value.expanded,true);assert.equal(value.left,20);assert.equal(value.top,30);
    assert.deepEqual(value.futureOption,{compact:true});assert.equal(value.tab,'hand');assert.equal(value.dock,'free');
    assert.ok(value.width>=280&&value.width<=480);assert.ok(value.fontSize>=11&&value.fontSize<=16);
  }
  assert.deepEqual(ui.normalizePreferences(legacy),controllerAPI.normalizePreferences(legacy));
  assert.deepEqual(legacy,original,'normalizing never changes the saved input');
});

test('display preference bounds and invalid input are conservative', () => {
  const cases=[null,[],{width:1,fontSize:60,left:-8,top:Infinity,tab:'bad',dock:'bad'},
    {width:999,fontSize:0,left:12.4,top:13.6,tab:'events',dock:'right'},
    {width:'420',fontSize:NaN,expanded:'true',tab:'all',dock:'left'}];
  for(const value of cases)assert.deepEqual(ui.normalizePreferences(value),controllerAPI.normalizePreferences(value));
  const small=ui.normalizePreferences(cases[2]);
  assert.equal(small.width,280);assert.equal(small.fontSize,16);assert.equal(small.left,0);assert.equal(small.top,null);
  const large=ui.normalizePreferences(cases[3]);
  assert.equal(large.width,480);assert.equal(large.fontSize,11);assert.equal(large.left,12);assert.equal(large.top,14);
  assert.equal(ui.normalizePreferences(cases[4]).expanded,false);
});

test('preview image accepts data only when its declared official source matches the requested card', () => {
  const data='data:image/webp;base64,UklGRg==';
  const source='https://www.gundam-gcg.com/jp/images/cards/card/GD01-001_p2.webp?20261025';
  assert.equal(ui.safeCardImageSource(data,source,'GD01-001'),data);
  assert.equal(ui.safeCardImageSource('data:image/png;base64,iVBORw==',source,'GD01-001'),'data:image/png;base64,iVBORw==');
  for(const image of ['https://example.test/card.png','data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PHN2Zz4=',data+'\n']) {
    assert.equal(ui.safeCardImageSource(image,source,'GD01-001'),null);
  }
  for(const bad of [undefined,source.replace('https:','http:'),source.replace('www.gundam-gcg.com','www.gundam-gcg.com.evil.test'),
    source.replace('/jp/','/any/'),source.replace('GD01-001','GD01-002'),source+'#x',source.replace('?20261025','?tracking=yes'),
    source.replace('/GD01','/%47D01'),source.replace('https://','https://user:pass@')]) {
    assert.equal(ui.safeCardImageSource(data,bad,'GD01-001'),null);
  }
  assert.equal(ui.safeCardImageSource('data:image/png;base64,'+'A'.repeat(3*1024*1024),source,'GD01-001'),null);
});

test('bookmark anchor is derived from the current stored snapshot rather than UI-supplied turn fields', async () => {
  const h=harness();try {
    await h.ready();assert.equal(h.view().models.at(-1).canBookmark,true);
    const result=await h.view().callbacks.onBookmark({snapshotId:'synthetic-1',turn:99,turnSource:'log',observedTurn:99,note:'N'.repeat(501),tag:'T'.repeat(41)});
    assert.equal(result.ok,true);
    const call=h.calls.at(-1);assert.equal(call.ctx.sessionId,SESSION);
    assert.deepEqual(call.payload,{snapshotId:'synthetic-1',turn:null,turnSource:'unknown',observedTurn:3,note:'N'.repeat(500),tag:'T'.repeat(40)});
    assert.equal(h.writes.length,0,'controller delegates note persistence, never rewrites a session');
  }finally{h.stop();}
});

test('bookmark cannot use another segment, another player, or a stale view', async () => {
  const h=harness();try {
    await h.ready();const view=h.view();
    assert.equal((await view.callbacks.onBookmark({snapshotId:'older-segment'})).ok,false);
    h.changeContext({playerName:'Demo South'});await tick();
    assert.equal(h.view().models.at(-1).canBookmark,false);
    assert.equal((await view.callbacks.onBookmark({snapshotId:'synthetic-1'})).ok,false);
    h.changeContext({playerName:'Demo North',runId:OTHER});await tick();
    assert.equal((await view.callbacks.onBookmark({snapshotId:'synthetic-1'})).ok,false);
    assert.equal(h.calls.length,0);
  }finally{h.stop();}
});

test('navigation before a queued bookmark callback is executed prevents the write', async () => {
  const h=harness();try {
    await h.ready();const pending=h.view().callbacks.onBookmark({snapshotId:'synthetic-1',note:'anchor'});
    h.changeContext({runId:OTHER},false);
    assert.equal((await pending).ok,false);assert.equal(h.calls.length,0);
  }finally{h.stop();}
});

test('unknown preference fields survive writing before the initial record read resolves', async () => {
  const first=deferred();
  const h=harness({values:{[PREFS]:{expanded:false,width:430,fontSize:15,tab:'all',dock:'left',futureOption:{one:1}}},
    get:(request,count)=>request===null&&count===1?first.promise:undefined});
  try {
    h.api.sync();await tick();h.api.show();await tick();
    assert.equal(h.values[PREFS].expanded,true);assert.equal(h.values[PREFS].width,430);
    assert.deepEqual(h.values[PREFS].futureOption,{one:1});
    first.resolve({[KEY]:session(),[PREFS]:{expanded:false,width:280}});await tick();
    assert.equal(h.view().prefs.at(-1).width,430);assert.equal(h.view().prefs.at(-1).expanded,true);
    assert.deepEqual(Object.keys(h.writes[0]),[PREFS]);
  }finally{h.stop();}
});

test('later preference changes retain fields concurrently added to storage', async () => {
  const h=harness({values:{[PREFS]:{expanded:true,tab:'hand',futureOption:'keep'}}});
  try {
    await h.ready();const older=h.view().prefs.at(-1);
    h.values[PREFS]={...h.values[PREFS],newerUnknown:{version:9},width:440};
    h.view().callbacks.onPreferencesChange({...older,tab:'events'});await tick();
    assert.equal(h.values[PREFS].tab,'events');assert.equal(h.values[PREFS].width,440);
    assert.equal(h.values[PREFS].futureOption,'keep');assert.deepEqual(h.values[PREFS].newerUnknown,{version:9});
  }finally{h.stop();}
});

test('note changes are filtered to the current game and player without replacing stored snapshots', async () => {
  const h=harness({values:{'msa.note.own':{gameId:GAME,playerName:'Demo North'},'msa.note.other':{gameId:GAME,playerName:'Demo South'}}});
  try {
    await h.ready();assert.deepEqual(h.view().models.at(-1).noteIds,['msa.note.own']);
    h.change('msa.note.next',{gameId:GAME,playerName:'Demo North'});await tick();
    assert.deepEqual(h.view().models.at(-1).noteIds,['msa.note.own','msa.note.next']);
    h.change('msa.note.own',undefined);await tick();
    assert.deepEqual(h.view().models.at(-1).noteIds,['msa.note.next']);
    assert.equal(h.view().models.at(-1).latestSnapshot.id,'synthetic-1');
  }finally{h.stop();}
});

test('note deletion during initial read cannot resurrect an older note', async () => {
  const first=deferred(), note={gameId:GAME,playerName:'Demo North'};
  const h=harness({get:(request,count)=>request===null&&count===1?first.promise:undefined});
  try {
    h.api.sync();await tick();h.change('msa.note.old',undefined);
    first.resolve({[KEY]:session(),'msa.note.old':note});await tick();
    assert.deepEqual(h.view().models.at(-1).noteIds,[]);
  }finally{h.stop();}
});

test('management and alert actions use the active context while card lookup receives only one code', async () => {
  const h=harness({context:{diagnostics:{pendingCount:2}}});try {
    await h.ready();const view=h.view();
    await view.callbacks.onManage();await view.callbacks.onDismissAlert('save-error');await view.callbacks.onCardLookup('GD01-001');
    assert.equal(h.calls[0].ctx.sessionId,SESSION);assert.deepEqual(h.calls[0].ctx.diagnostics,{pendingCount:2});
    assert.equal(h.calls[1].code,'save-error');assert.deepEqual(h.calls[2],{kind:'lookup',code:'GD01-001'});
    h.changeContext({runId:OTHER});await tick();
    assert.equal((await view.callbacks.onManage()).ok,false);
    assert.equal((await view.callbacks.onDismissAlert('save-error')).ok,false);
    assert.equal((await view.callbacks.onCardLookup('GD01-001')).status,'error');
    assert.equal(h.calls.length,3);
  }finally{h.stop();}
});

test('management does not pass a record with another player hand as its selected session', async () => {
  const h=harness({context:{playerName:'Demo South'}});try {
    await h.ready();assert.equal((await h.view().callbacks.onManage()).ok,true);
    assert.equal(h.calls[0].ctx.sessionId,null);
  }finally{h.stop();}
});
