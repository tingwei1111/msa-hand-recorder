'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const core=require('../extension/recorder-core.js');
const battle=require('../extension/battle-log-core.js');
const diagnostics=require('../extension/diagnostics-core.js');
const annotations=require('../extension/annotations-core.js');
const library=require('../extension/library-core.js');
const libraryStore=require('../extension/library-store.js');
const cardProvider=require('../extension/card-provider.js');
const GAME='00000000-0000-4000-8000-000000000701';
const OTHER_GAME='00000000-0000-4000-8000-000000000702';
const RUN='10000000-0000-4000-8000-000000000701';
const OTHER_RUN='10000000-0000-4000-8000-000000000702';
const ID=GAME+'.'+RUN;
const KEY='msa.session.'+ID;
const CODE='GD99-001';
const EXT_ID='synthetic-extension';
const VERSION=JSON.parse(fs.readFileSync(path.join(__dirname,'../extension/manifest.json'),'utf8')).version;
const page={frameId:0,documentId:'synthetic-doc-A',url:`https://mobilesuitarena.com/game/${GAME}`,tab:{id:7}};
const extension={id:EXT_ID,url:`chrome-extension://${EXT_ID}/library.html`};
const when='2000-01-01T00:00:00.000Z';
const copy=value=>structuredClone(value);
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function snapshot(phase='MAIN'){
  return {timestamp:when,turn:3,turnSource:'log',observedTurn:2,activePlayer:'Demo North',phase,
    hand:[{cardCode:CODE,count:2}],expectedCount:2,unknownCount:0,quality:'complete',reason:'synthetic-visible-hand'};
}
function sourceSession(id=ID){
  const session=core.appendSnapshot(core.createSession({id,gameId:GAME,playerName:'Demo North',startedAt:when}),snapshot());
  session.captureSource={tabId:7,documentId:page.documentId};return session;
}
function metadata(code=CODE,locale='zh-tw'){
  return {status:'ok',cardCode:code,name:'Synthetic Unit',cardType:'UNIT',text:'Synthetic preview text.',
    imageUrl:`https://www.gundam-gcg.com/jp/images/cards/card/${code}.webp?261025`,imageLocale:'jp',
    sourceUrl:cardProvider.sourceUrlFor(code,locale),locale,fetchedAt:when};
}
function harness(options={}){
  const db=copy(options.initial||{}),writes=[],reads=[],tabsCreated=[],tabMessages=[],queries=[],lookupCalls=[],imageCalls=[];
  let listener;
  const forbiddenFetch=async()=>{throw new Error('Tests must never use the network');};
  const provider={normalizeCardCode:cardProvider.normalizeCardCode,allowedImageUrl:cardProvider.allowedImageUrl,
    async lookupCard(code,args){lookupCalls.push({code,locale:args.locale,fetch:args.fetch});return options.lookup?options.lookup(code,args):metadata(code,args.locale);},
    async fetchCardImage(url,args){imageCalls.push({url,cardCode:args.cardCode,fetch:args.fetch});return options.image?options.image(url,args):{status:'ok',dataUrl:'data:image/webp;base64,UklGRgQAAABXRUJQ',mime:'image/webp'};}};
  const chrome={runtime:{id:EXT_ID,getURL:file=>`chrome-extension://${EXT_ID}/${file}`,getManifest:()=>({version:VERSION}),onMessage:{addListener(fn){listener=fn;}}},
    tabs:{async query(query){queries.push(copy(query));return options.query?options.query(query):[{id:7,active:true}];},
      async create(details){tabsCreated.push(copy(details));return {id:99};},
      async sendMessage(tabId,message,settings){tabMessages.push({tabId,message:copy(message),settings:copy(settings)});if(options.pageReply)return options.pageReply(tabId,message,settings);throw new Error('Synthetic no receiver');}},
    storage:{local:{async get(keys){reads.push(copy(keys));await options.beforeGet?.(keys);const list=keys===null?Object.keys(db):Array.isArray(keys)?keys:[keys];
      const value=Object.fromEntries(list.filter(key=>Object.hasOwn(db,key)).map(key=>[key,copy(db[key])]));await options.afterGet?.(keys,value,db);return value;},
      async set(patch){await options.beforeSet?.(patch,db);writes.push(copy(patch));Object.assign(db,copy(patch));}}}};
  const context=vm.createContext({MSARecorderCore:core,MSABattleLogCore:battle,MSADiagnosticsCore:diagnostics,MSAAnnotationsCore:annotations,
    MSALibraryCore:library,MSALibraryStore:libraryStore,MSACardProvider:provider,chrome,fetch:forbiddenFetch,
    URL,Map,Promise,Date,JSON,setTimeout,clearTimeout,importScripts(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),context);
  function send(message,sender=page){return new Promise((resolve,reject)=>{
    let responded=false;
    const respond=value=>{responded=true;resolve(copy(value));};
    try{const pending=listener(message,sender,respond);if(!pending&&!responded)resolve({ignored:true});}catch(error){reject(error);}
  });}
  return {db,writes,reads,tabsCreated,tabMessages,queries,lookupCalls,imageCalls,forbiddenFetch,send};
}
function noteCreate(session=sourceSession(),extra={}){
  return {type:'MSA_NOTE_ACTION',action:'create',gameId:GAME,runId:RUN,playerName:'Demo North',
    payload:{snapshotId:session.snapshots[0].id,note:'Synthetic note',tag:'待檢討'},...extra};
}
const libraryMessage=(action,extra={})=>({type:'MSA_LIBRARY_ACTION',action,...extra});
const liveRecord=phase=>({type:'MSA_RECORD',gameId:GAME,runId:RUN,playerName:'Demo North',snapshot:snapshot(phase)});

test('card lookup allows own extension pages and MSA game mainframe, while denying unrelated callers',async()=>{
  const h=harness();
  for(const sender of [extension,{...extension,url:`chrome-extension://${EXT_ID}/review.html`},page]) {
    assert.equal((await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},sender)).status,'ok');
  }
  for(const sender of [{...page,frameId:2},{...page,url:'https://other.test/game/'+GAME},{...page,url:'https://mobilesuitarena.com/'},
    {...extension,id:'other-extension'},{...extension,url:`chrome-extension://${EXT_ID}/unknown.html`}]) {
    assert.equal((await h.send({type:'MSA_CARD_LOOKUP',cardCode:'GD99-002'},sender)).status,'error');
  }
  assert.equal(h.lookupCalls.length,1);assert.equal(h.writes.length,0);
});
test('card lookup rejects a UUID in a non-game MSA route',async()=>{
  const h=harness();
  const reply=await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},{...page,url:`https://mobilesuitarena.com/profile/${GAME}`});
  assert.equal(reply.status,'error');assert.equal(h.lookupCalls.length,0);
});
test('invalid card code cannot make a network lookup or inject an image/source URL',async()=>{
  const h=harness();
  for(const cardCode of ['https://evil.test/a','prefix '+CODE,CODE+'0','__proto__',null]) {
    assert.equal((await h.send({type:'MSA_CARD_LOOKUP',cardCode},extension)).status,'error');
  }
  assert.equal(h.lookupCalls.length,0);
  const result=await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE,imageUrl:'https://evil.test/private',sourceUrl:'https://evil.test/private'},extension);
  assert.equal(result.status,'ok');assert.equal(h.imageCalls[0].url,metadata().imageUrl);
  assert.equal(h.lookupCalls[0].fetch,h.forbiddenFetch);assert.equal(h.imageCalls[0].fetch,h.forbiddenFetch);
});
test('same canonical card requests share in-flight work and cache without writing storage',async()=>{
  const gate=deferred(),h=harness({lookup:async(code,args)=>{await gate.promise;return metadata(code,args.locale);}});
  const first=h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},page);
  const second=h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE+'_p2.webp'},extension);
  await tick();assert.equal(h.lookupCalls.length,1);gate.resolve();
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);assert.equal(h.imageCalls.length,1);
  assert.equal((await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},extension)).status,'ok');assert.equal(h.lookupCalls.length,1);
  await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE,locale:'en'},extension);assert.equal(h.lookupCalls.length,2);
  assert.equal(h.writes.length,0);assert.deepEqual(h.db,{});
});
test('four distinct pending card lookups bound concurrency and error results can retry',async()=>{
  const gate=deferred(),h=harness({lookup:async(code)=>{await gate.promise;return {status:'error',cardCode:code,reason:'synthetic failure'};}});
  const pending=Array.from({length:4},(_,i)=>h.send({type:'MSA_CARD_LOOKUP',cardCode:`GD99-00${i+1}`},extension));
  await tick();const rejected=await h.send({type:'MSA_CARD_LOOKUP',cardCode:'GD99-005'},extension);
  assert.equal(rejected.status,'error');assert.equal(h.lookupCalls.length,4);gate.resolve();await Promise.all(pending);
  await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},extension);assert.equal(h.lookupCalls.length,5);assert.equal(h.imageCalls.length,0);
});
test('failed image preserves valid text/source metadata, and notfound does not fetch an image',async()=>{
  const h=harness({image:async()=>({status:'error',reason:'synthetic image error'})});
  const result=await h.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},extension);
  assert.equal(result.status,'ok');assert.equal(result.text,metadata().text);assert.equal(result.sourceUrl,metadata().sourceUrl);
  assert.equal(result.imageDataUrl,undefined);assert.equal(result.imageReason,'synthetic image error');assert.equal(h.writes.length,0);
  const missing=harness({lookup:async(code)=>({status:'notfound',cardCode:code,name:null,text:null,imageUrl:null})});
  assert.equal((await missing.send({type:'MSA_CARD_LOOKUP',cardCode:CODE},extension)).status,'notfound');assert.equal(missing.imageCalls.length,0);
});
test('diagnostics reads manifest/page versions from the active mainframe without capture actions',async()=>{
  const h=harness({pageReply:async()=>({connected:true,version:'0.0.0',gameId:GAME,ready:true,enabled:true,playerName:'Demo North',snapshotCount:1,quality:'complete'})});
  const reply=await h.send({type:'MSA_RUN_DIAGNOSTICS'},extension);
  assert.equal(reply.ok,true);assert.equal(reply.report.extensionVersion,VERSION);
  assert.equal(reply.report.checks.find(item=>item.id==='version').level,'error');
  assert.deepEqual(h.queries,[{active:true,currentWindow:true}]);
  assert.deepEqual(h.tabMessages,[{tabId:7,message:{type:'MSA_DIAGNOSTICS_QUERY'},settings:{frameId:0}}]);
  assert.equal(h.writes.length,0);assert.equal(h.tabsCreated.length,0);
  const denied=await h.send({type:'MSA_RUN_DIAGNOSTICS'},page);assert.equal(denied.ok,false);assert.equal(h.tabMessages.length,1);
});
test('diagnostics handles an absent receiver explicitly without a false success check',async()=>{
  const h=harness(),reply=await h.send({type:'MSA_RUN_DIAGNOSTICS'},extension);
  assert.equal(reply.ok,true);assert.equal(reply.report.hasErrors,true);assert.equal(reply.report.checks[0].id,'page');
  assert.equal(h.writes.length,0);
});
test('diagnostics does not claim saved observations from stale page counters after the local session is deleted',async()=>{
  const h=harness({pageReply:async()=>({connected:true,version:VERSION,gameId:GAME,runId:RUN,ready:true,enabled:true,
    playerName:'Demo North',snapshotCount:135,eventCount:350,publicLogComplete:true,lastSavedAt:when,quality:'complete'})});
  const reply=await h.send({type:'MSA_RUN_DIAGNOSTICS'},extension),checks=reply.report.checks;
  assert.equal(reply.ok,true);assert.deepEqual(h.reads,[KEY]);
  assert.equal(checks.find(item=>item.id==='storage').level,'warning');
  assert.match(checks.find(item=>item.id==='storage').detail,/尚無本機存檔/);
  assert.equal(checks.find(item=>item.id==='write').level,'warning');
  assert.match(checks.find(item=>item.id==='write').detail,/已存 0 筆/);
  assert.doesNotMatch(checks.find(item=>item.id==='write').detail,/最近成功/);
  assert.equal(checks.find(item=>item.id==='log').level,'warning');
  assert.match(checks.find(item=>item.id==='log').detail,/已存 0 筆/);
  assert.equal(h.writes.length,0);
});
test('diagnostics uses the exact owned stored session counts and coverage rather than larger reported page counters',async()=>{
  let stored=core.appendSnapshot(sourceSession(),snapshot('ATTACK'));
  stored=battle.ingest(stored,{observedAt:when,order:'oldest-first',completeFromStart:true,rows:[
    {text:'Game started!',actor:'',cards:[],sourceIndex:0},
    {text:'Turn 1: Demo North',actor:'',cards:[],sourceIndex:1}]});
  assert.equal(stored.snapshots.length,2);assert.equal(stored.battleLog.events.length,2);
  assert.equal(stored.battleLog.coverage.publicLogComplete,false);
  const h=harness({initial:{[KEY]:stored,'msa.session.unrelated':sourceSession('unrelated')},
    pageReply:async()=>({connected:true,version:VERSION,gameId:GAME,runId:RUN,ready:true,enabled:true,
      playerName:'Demo North',snapshotCount:135,eventCount:350,publicLogComplete:true,lastSavedAt:when,quality:'complete'})});
  const reply=await h.send({type:'MSA_RUN_DIAGNOSTICS'},extension),checks=reply.report.checks;
  assert.deepEqual(h.reads,[KEY]);assert.equal(checks.find(item=>item.id==='storage').level,'pass');
  assert.equal(checks.find(item=>item.id==='write').level,'pass');assert.match(checks.find(item=>item.id==='write').detail,/已存 2 筆/);
  assert.equal(checks.find(item=>item.id==='log').level,'warning');assert.match(checks.find(item=>item.id==='log').detail,/已存 2 筆/);
  assert.equal(h.writes.length,0);assert.deepEqual(h.db[KEY],stored);
});
test('diagnostics refuses stored counts belonging to a different tab or player despite a matching game/run key',async()=>{
  const original=sourceSession();
  for(const stored of [{...original,captureSource:{...original.captureSource,tabId:8}}, {...original,playerName:'Demo South'}]) {
    const h=harness({initial:{[KEY]:stored},pageReply:async()=>({connected:true,version:VERSION,gameId:GAME,runId:RUN,
      ready:true,enabled:true,playerName:'Demo North',snapshotCount:135,eventCount:350,publicLogComplete:true,quality:'complete'})});
    const reply=await h.send({type:'MSA_RUN_DIAGNOSTICS'},extension),checks=reply.report.checks;
    assert.equal(reply.report.hasErrors,true);assert.equal(checks.find(item=>item.id==='storage').level,'error');
    assert.match(checks.find(item=>item.id==='storage').detail,/玩家或分頁來源不符/);
    assert.equal(checks.find(item=>item.id==='write').level,'warning');assert.match(checks.find(item=>item.id==='write').detail,/已存 0 筆/);
    assert.equal(checks.find(item=>item.id==='log').level,'warning');assert.match(checks.find(item=>item.id==='log').detail,/已存 0 筆/);
    assert.equal(h.writes.length,0);assert.deepEqual(h.db[KEY],stored);
  }
});
test('library navigation is internal and encoded even for opaque extension session identifiers',async()=>{
  const h=harness();
  const opaque='opaque.import-&next=https://evil.test/#fragment';
  assert.equal((await h.send({type:'MSA_OPEN_LIBRARY',sessionId:opaque},extension)).ok,true);
  const url=new URL(h.tabsCreated[0].url);assert.equal(url.protocol,'chrome-extension:');assert.equal(url.hostname,EXT_ID);
  assert.equal(url.pathname,'/library.html');assert.equal(url.searchParams.get('id'),opaque);assert.equal(url.searchParams.size,1);assert.equal(url.hash,'');
  assert.equal((await h.send({type:'MSA_OPEN_LIBRARY',gameId:GAME,runId:RUN},page)).ok,true);
  assert.equal(new URL(h.tabsCreated[1].url).searchParams.get('id'),ID);
  assert.equal((await h.send({type:'MSA_OPEN_LIBRARY',gameId:OTHER_GAME,runId:RUN},page)).ok,false);
  assert.equal((await h.send({type:'MSA_OPEN_LIBRARY',gameId:GAME,runId:RUN},{...page,frameId:3})).ok,false);
  assert.equal(h.tabsCreated.length,2);
});
test('library navigation from content requires an actual game route',async()=>{
  const h=harness();
  const result=await h.send({type:'MSA_OPEN_LIBRARY',gameId:GAME,runId:RUN},{...page,url:`https://mobilesuitarena.com/profile/${GAME}`});
  assert.equal(result.ok,false);assert.equal(h.tabsCreated.length,0);
});
test('content bookmark derives immutable anchors from the stored snapshot, not payload claims',async()=>{
  const session=sourceSession(),h=harness({initial:{[KEY]:session}}),message=noteCreate(session);
  Object.assign(message.payload,{turn:999,turnSource:'unknown',observedTurn:999,gameId:OTHER_GAME,playerName:'Other',sourceSessionId:'bad',snapshot:{hand:[]}});
  const result=await h.send(message,page);assert.equal(result.ok,true);
  const note=result.bookmark;assert.equal(note.gameId,GAME);assert.equal(note.playerName,'Demo North');assert.equal(note.sourceSessionId,ID);
  assert.equal(note.snapshotId,session.snapshots[0].id);assert.equal(note.turn,3);assert.equal(note.turnSource,'log');assert.equal(note.observedTurn,2);
  assert.equal(note.observedAt,session.snapshots[0].timestamp);assert.deepEqual(h.db[KEY],session);
  assert.equal(Object.keys(h.db).filter(key=>key.startsWith('msa.note.')).length,1);
});
test('content bookmark rejects wrong game/run/player/tab/document and missing snapshots',async()=>{
  const session=sourceSession();
  const variants=[
    [noteCreate(session,{gameId:OTHER_GAME}),page],
    [noteCreate(session,{runId:OTHER_RUN}),page],
    [noteCreate(session,{playerName:'Demo South'}),page],
    [noteCreate(session),{...page,tab:{id:8}}],
    [noteCreate(session),{...page,documentId:'synthetic-doc-B'}],
    [noteCreate(session),{...page,frameId:1}],
    [noteCreate(session,{payload:{snapshotId:'not-saved',note:'x'}}),page]
  ];
  for(const [message,sender] of variants){const h=harness({initial:{[KEY]:session}});assert.equal((await h.send(message,sender)).ok,false);assert.equal(h.writes.length,0);}
});
test('content bookmark does not accept a non-game route with the same UUID',async()=>{
  const session=sourceSession(),h=harness({initial:{[KEY]:session}});
  const result=await h.send(noteCreate(session),{...page,url:`https://mobilesuitarena.com/profile/${GAME}`});
  assert.equal(result.ok,false);assert.equal(h.writes.length,0);
});
test('extension review can bookmark an opaque imported session id but cannot invent a snapshot',async()=>{
  const session=sourceSession('legacy.import-copy'),key='msa.session.'+session.id,h=harness({initial:{[key]:session}});
  const message=noteCreate(session,{sourceSessionId:session.id});
  const result=await h.send(message,{...extension,url:`chrome-extension://${EXT_ID}/review.html`});
  assert.equal(result.ok,true);assert.equal(result.bookmark.sourceSessionId,session.id);
  assert.equal((await h.send({...message,payload:{snapshotId:'invented',note:'x'}},extension)).ok,false);
});
test('only an extension page can edit UUID notes, and update cannot retarget or erase their anchors',async()=>{
  const session=sourceSession(),h=harness({initial:{[KEY]:session}}),created=await h.send(noteCreate(session));
  const original=created.bookmark,key='msa.note.'+original.id;
  const change={type:'MSA_NOTE_ACTION',action:'update',noteId:original.id,payload:{note:'Edited',tag:'檢查',deleted:true,
    id:OTHER_RUN,gameId:OTHER_GAME,sourceSessionId:'other',snapshotId:'other',turn:999,playerName:'Other'}};
  assert.equal((await h.send(change,page)).ok,false);assert.deepEqual(h.db[key],original);
  const result=await h.send(change,extension);assert.equal(result.ok,true);assert.equal(result.bookmark.note,'Edited');assert.ok(result.bookmark.deletedAt);
  for(const field of ['id','gameId','sourceSessionId','snapshotId','turn','playerName','createdAt'])assert.equal(result.bookmark[field],original[field]);
  assert.equal((await h.send({...change,noteId:'invalid-id'},extension)).ok,false);
  const restored=await h.send({...change,payload:{deleted:false}},extension);assert.equal(restored.ok,true);assert.equal(restored.bookmark.deletedAt,undefined);
});
test('bookmark storage/validation failures do not claim success or poison the workspace queue',async()=>{
  const session=sourceSession();let fail=true;
  const h=harness({initial:{[KEY]:session},beforeSet:async patch=>{if(fail&&Object.keys(patch).some(key=>key.startsWith('msa.note.')))throw new Error('Synthetic quota failure');}});
  const failed=await h.send(noteCreate(session));assert.equal(failed.ok,false);assert.match(failed.reason,/quota/);
  assert.equal(Object.keys(h.db).filter(key=>key.startsWith('msa.note.')).length,0);assert.deepEqual(h.db[KEY],session);
  fail=false;
  const invalid=noteCreate(session);invalid.payload.note='x'.repeat(1501);
  assert.equal((await h.send(invalid)).ok,false);assert.equal(h.writes.length,0);
  assert.equal((await h.send(noteCreate(session))).ok,true);assert.equal(h.writes.length,1);
});
test('library mutation is extension-only and preview has no writes or side effects',async()=>{
  const session=sourceSession(),text=JSON.stringify(session),h=harness();
  for(const sender of [page,{...extension,id:'other'}, {...extension,url:'https://other.test/library.html'}])assert.equal((await h.send(libraryMessage('previewImport',{text}),sender)).ok,false);
  assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);
  const preview=await h.send(libraryMessage('previewImport',{text}),extension);assert.equal(preview.ok,true);assert.equal(preview.summary.sessions,1);assert.equal(h.writes.length,0);
  const refused=await h.send(libraryMessage('applyImport',{text,previewToken:preview.previewToken}),extension);assert.equal(refused.code,'confirmation-required');
  assert.equal((await h.send(libraryMessage('arbitraryMethod'),extension)).ok,false);assert.equal(h.writes.length,0);
});
test('library stale preview and conflicts preserve existing live session observations',async()=>{
  const imported=sourceSession(),text=JSON.stringify(imported),h=harness();
  const preview=await h.send(libraryMessage('previewImport',{text}),extension);
  await h.send(liveRecord('ATTACK'));
  const before=copy(h.db[KEY]);
  const stale=await h.send(libraryMessage('applyImport',{text,previewToken:preview.previewToken,confirmed:true}),extension);assert.equal(stale.code,'preview-stale');assert.deepEqual(h.db[KEY],before);
  const fresh=await h.send(libraryMessage('previewImport',{text}),extension);assert.equal(fresh.summary.copies,1);
  const applied=await h.send(libraryMessage('applyImport',{text,previewToken:fresh.previewToken,confirmed:true}),extension);assert.equal(applied.ok,true);assert.deepEqual(h.db[KEY],before);
  assert.equal(Object.keys(h.db).filter(key=>key.startsWith('msa.session.')).length,2);
});
test('library import shares the exact live session queue through read/check/write/verify',async()=>{
  const reached=deferred(),release=deferred();let gated=false;
  const h=harness({beforeGet:async keys=>{if(keys===KEY&&!gated){gated=true;reached.resolve();await release.promise;}}});
  const imported=sourceSession(),text=JSON.stringify(imported),preview=await h.send(libraryMessage('previewImport',{text}),extension);
  const importing=h.send(libraryMessage('applyImport',{text,previewToken:preview.previewToken,confirmed:true}),extension);await reached.promise;
  const recording=h.send(liveRecord('ATTACK'));await tick();assert.equal(h.writes.some(patch=>Object.hasOwn(patch,KEY)),false);
  release.resolve();const [importedResult,recorded]=await Promise.all([importing,recording]);assert.equal(importedResult.ok,true);assert.equal(recorded.ok,true);
  assert.equal(h.db[KEY].snapshots.length,2);assert.equal(h.db[KEY].snapshots[0].phase,'MAIN');assert.equal(h.db[KEY].snapshots[1].phase,'ATTACK');
});
test('workspace serialization prevents a manual note from racing an import of the same note key',async()=>{
  const session=sourceSession(),noteId='20000000-0000-4000-8000-000000000701';
  const note=annotations.create(session,session.snapshots[0],{note:'Original',tag:'test'},{id:noteId,now:when});
  const noteKey='msa.note.'+noteId,reached=deferred(),release=deferred();let gate=false;
  const h=harness({initial:{[KEY]:session,[noteKey]:note},beforeSet:async patch=>{if(Object.hasOwn(patch,noteKey)&&!gate){gate=true;reached.resolve();await release.promise;}}});
  const incoming={...note,note:'Imported other version'},text=JSON.stringify({format:library.FORMAT,schemaVersion:1,records:{[noteKey]:incoming}});
  const preview=await h.send(libraryMessage('previewImport',{text}),extension);
  const editing=h.send({type:'MSA_NOTE_ACTION',action:'update',noteId,payload:{note:'New local edit'}},extension);await reached.promise;
  const importing=h.send(libraryMessage('applyImport',{text,previewToken:preview.previewToken,confirmed:true}),extension);
  await tick();assert.equal(h.writes.length,0);release.resolve();assert.equal((await editing).ok,true);
  assert.equal((await importing).code,'preview-stale');assert.equal(h.db[noteKey].note,'New local edit');
});
