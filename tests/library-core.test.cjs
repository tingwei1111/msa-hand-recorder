'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../extension/library-core.js');
const recorder=require('../extension/recorder-core.js');
const storeApi=require('../extension/library-store.js');
const GAME='00000000-0000-4000-8000-000000000401';
const WHEN='2000-01-01T00:00:00.000Z';
const make=(id=GAME+'.synthetic')=>recorder.createSession({id,gameId:GAME,playerName:'Demo North',startedAt:WHEN});
const sessionKey=record=>'msa.session.'+record.id;
const backup=records=>({format:core.FORMAT,schemaVersion:1,exportedAt:WHEN,records});
const parse=records=>core.parseImport(JSON.stringify(backup(records)),{fileName:'synthetic.json'});
const mainText=Array.from({length:13},(_,i)=>`${i===12?2:4}xGD01-${String(i+1).padStart(3,'0')}`).join('\n');
const deckDraft=extra=>({deckId:'deck-synthetic',name:'Synthetic deck',mainText,resourcesText:'10xR-001',tokensText:'2xT-001',...extra});
const matchDraft=extra=>({gameId:GAME,playerName:'Demo North',sourceSessionId:GAME+'.synthetic',identityConfirmed:true,result:'win',resultConfirmed:true,firstPlayer:'first',...extra});
function harness(initial={},failAt=Infinity){
  const db=structuredClone(initial),writes=[];
  const storage={async get(keys){if(keys===null)return structuredClone(db);const names=Array.isArray(keys)?keys:[keys];return Object.fromEntries(names.filter(key=>Object.hasOwn(db,key)).map(key=>[key,structuredClone(db[key])]))},
    async set(patch){if(writes.length===failAt)throw new Error('Synthetic quota error');writes.push(structuredClone(patch));Object.assign(db,structuredClone(patch));}};
  return {db,writes,storage,store:storeApi.create({storage})};
}

test('workspace backup preserves unknown fields and only allowed data keys',()=>{
  const record=make();record.futureField={retained:['<x>',17]};
  const note={schemaVersion:1,id:'note-synthetic',gameId:GAME,playerName:'Demo North',note:'Synthetic note',sourceSessionId:record.id,deletedAt:WHEN};
  const out=core.createBackup({[sessionKey(record)]:record,'msa.note.note-synthetic':note,'msa.settings':{enabled:false},'msa.livePanel':{expanded:true},'msa.status.1':{message:'not backup'}});
  assert.deepEqual(Object.keys(out.records).sort(),['msa.note.note-synthetic',sessionKey(record)].sort());
  assert.deepEqual(out.records[sessionKey(record)].futureField,record.futureField);
  assert.equal(out.records['msa.note.note-synthetic'].deletedAt,WHEN);
  out.records[sessionKey(record)].futureField.retained.push(1);assert.equal(record.futureField.retained.length,2);
});

test('single-session JSON and standalone HTML parse exact data without executing HTML',()=>{
  const record=make();record.extra='<script>globalThis.syntheticExecuted=true</script>';
  const single=core.parseImport(JSON.stringify(record));assert.deepEqual(single.records[sessionKey(record)],record);
  const note={schemaVersion:1,id:'note-a',gameId:GAME,playerName:'Demo North',note:'from HTML',sourceSessionId:record.id};
  const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  const html=`<html><script>throw new Error('never execute')</script><script type="application/json" id="msa-record-data">${json(record)}</script><script id="msa-export-info" type="application/json">${json({workspaceRecords:{'msa.note.note-a':note}})}</script></html>`;
  const parsed=core.parseImport(html,{fileName:'report.html'});
  assert.equal(parsed.kind,'html');assert.deepEqual(parsed.records[sessionKey(record)],record);assert.deepEqual(parsed.records['msa.note.note-a'],note);
  assert.equal(globalThis.syntheticExecuted,undefined);
});

test('invalid, duplicate-block, unsafe-key, oversized and deeply nested payloads fail before planning',()=>{
  const record=make(),block=`<script type="application/json" id="msa-record-data">${JSON.stringify(record)}</script>`;
  assert.throws(()=>core.parseImport(block+block),/唯一/);
  assert.throws(()=>core.parseImport(block+'<script type="application/json" id="msa-export-info">{}</script>'.repeat(2)),/唯一/);
  assert.throws(()=>core.parseImport('<script id="msa-record-data">{}</script>'),/application\/json/);
  assert.throws(()=>core.parseImport('{not json}'),/JSON/);
  assert.throws(()=>core.parseImport(' '.repeat(core.LIMITS.bytes+1)+'{}'),/20 MiB/);
  assert.throws(()=>parse({'msa.settings':{enabled:false}}),/不允許/);
  assert.throws(()=>core.parseImport(JSON.stringify(record).replace('"schemaVersion":1','"__proto__":{"polluted":true},"schemaVersion":1')),/不安全/);
  let nested={};for(let n=0;n<45;n++)nested={nested};record.extra=nested;
  assert.throws(()=>core.parseImport(JSON.stringify(record)),/過大或過深/);
  assert.equal({}.polluted,undefined);
});

test('session key mismatch and excessive snapshot count are rejected',()=>{
  const record=make();assert.throws(()=>parse({'msa.session.wrong':record}),/ID 不符/);
  record.snapshots=Array.from({length:core.LIMITS.snapshots+1},()=>({hand:[]}));
  assert.throws(()=>parse({[sessionKey(record)]:record}),/筆數/);
});

test('import requires explicit preview confirmation and an unchanged relevant plan',async()=>{
  const record=make(),h=harness(),text=JSON.stringify(record);
  const preview=await h.store.previewImport({text,fileName:'one.json'});
  assert.equal(preview.summary.sessions,1);assert.equal(h.writes.length,0);
  const refused=await h.store.applyImport({text,previewToken:preview.previewToken});assert.equal(refused.code,'confirmation-required');
  h.db[sessionKey(record)]={...record,extra:'new local change'};
  const stale=await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true});assert.equal(stale.code,'preview-stale');assert.equal(h.writes.length,0);
});

test('unrelated recording changes do not invalidate import preview',async()=>{
  const record=make(),h=harness(),text=JSON.stringify(record);
  const preview=await h.store.previewImport({text,fileName:'one.json'});
  const unrelated=make(GAME+'.another');h.db[sessionKey(unrelated)]=unrelated;
  const result=await h.store.applyImport({text,fileName:'one.json',previewToken:preview.previewToken,confirmed:true});
  assert.equal(result.ok,true);assert.deepEqual(h.db[sessionKey(record)],record);assert.deepEqual(h.db[sessionKey(unrelated)],unrelated);
});

test('session conflicts create a copy without changing game/player and preserve exact original receipt',async()=>{
  const imported=make();imported.extra={unknownField:['kept']};
  const local={...imported,localOnly:true},h=harness({[sessionKey(local)]:local}),text=JSON.stringify(imported);
  const preview=await h.store.previewImport({text,fileName:'source.json'});assert.equal(preview.summary.copies,1);
  const result=await h.store.applyImport({text,fileName:'source.json',previewToken:preview.previewToken,confirmed:true});assert.equal(result.ok,true);
  assert.deepEqual(h.db[sessionKey(local)],local);
  const copy=Object.entries(h.db).find(([key])=>key.startsWith('msa.session.')&&key!==sessionKey(local))[1];
  assert.notEqual(copy.id,local.id);assert.equal(copy.gameId,GAME);assert.equal(copy.playerName,'Demo North');
  const receipt=h.db['msa.import.'+copy.importProvenance.receiptId];assert.deepEqual(receipt.sourceRecords[sessionKey(imported)],imported);
  const again=await h.store.previewImport({text,fileName:'different-name.json'});assert.equal(again.summary.writes,0);assert.equal(again.summary.skipped,1);
});

test('same file repeat skips, while separate run and legal repeated events remain distinct',async()=>{
  const record=make();record.battleLog={schemaVersion:1,events:[{id:'a',rawText:'Passed'},{id:'b',rawText:'Passed'}]};
  const second={...structuredClone(record),id:GAME+'.second'},h=harness(),text=JSON.stringify(backup({[sessionKey(record)]:record,[sessionKey(second)]:second}));
  const first=await h.store.previewImport({text});await h.store.applyImport({text,previewToken:first.previewToken,confirmed:true});
  assert.equal(h.db[sessionKey(record)].battleLog.events.length,2);assert.equal(h.db[sessionKey(second)].battleLog.events.length,2);
  const repeat=await h.store.previewImport({text});assert.equal(repeat.summary.writes,0);assert.equal(repeat.summary.skipped,2);
});

test('manual-note conflicts keep local content, archive import, and repeat skips the archived original',async()=>{
  const note={schemaVersion:1,id:'note-one',gameId:GAME,playerName:'Demo North',note:'imported original'};
  const key='msa.note.'+note.id,local={...note,note:'local text'},h=harness({[key]:local}),text=JSON.stringify(backup({[key]:note}));
  const first=await h.store.previewImport({text});assert.equal(first.items[0].status,'archived-conflict');
  await h.store.applyImport({text,previewToken:first.previewToken,confirmed:true});assert.deepEqual(h.db[key],local);
  const archive=Object.values(h.db).find(item=>item.sourceRecords);assert.deepEqual(archive.sourceRecords[key],note);
  const again=await h.store.previewImport({text});assert.equal(again.summary.writes,0);assert.equal(again.summary.skipped,1);
});

test('best-effort failure reports exact saved and remaining keys without overwriting old records',async()=>{
  const old=make(GAME+'.old'),incoming=make(),h=harness({[sessionKey(old)]:old},1),text=JSON.stringify(incoming);
  const preview=await h.store.previewImport({text});const result=await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true});
  assert.equal(result.ok,false);assert.equal(result.partial,true);assert.equal(result.savedKeys.length,1);assert.equal(result.failedKeys.length,1);
  assert.ok(result.savedKeys[0].startsWith('msa.import.'));assert.deepEqual(h.db[sessionKey(old)],old);assert.equal(h.db[sessionKey(incoming)],undefined);
  const original=h.db[result.savedKeys[0]].sourceRecords[sessionKey(incoming)];assert.deepEqual(original,incoming);
});

test('backup round trip retains active and archived unknown fields',async()=>{
  const record=make();record.legacy={nested:'exact'};const h=harness(),text=JSON.stringify(record);
  const p=await h.store.previewImport({text});await h.store.applyImport({text,previewToken:p.previewToken,confirmed:true});
  const full=(await h.store.createBackup()).backup,fresh=harness(),restoreText=JSON.stringify(full);
  const preview=await fresh.store.previewImport({text:restoreText});assert.equal((await fresh.store.applyImport({text:restoreText,previewToken:preview.previewToken,confirmed:true})).ok,true);
  for(const [key,value] of Object.entries(full.records))assert.deepEqual(fresh.db[key],value);
});

test('deck parser accepts three formats, merges duplicates and checks only explicit shape constraints',()=>{
  const variants=mainText.replace('4xGD01-001','2 GD01-001\nGD01-001x2').replace('4xGD01-002','4×GD01-002');
  const result=core.parseDeck(variants);assert.equal(result.ok,true);assert.equal(result.total,50);assert.equal(result.cards[0].count,4);
  assert.equal(core.parseDeck(mainText+'\n1xGD01-001').ok,false);
  assert.equal(core.parseDeck(mainText.replace('4xGD01-001','4xR-001')).ok,false);
  assert.equal(core.parseDeck('1xT-001','tokens').ok,true);
  assert.equal(core.parseDeck('1xGD01-001','resources').ok,true); // User assigns the zone; no card-database claim.
  assert.equal(core.parseDeck('50xnot-a-card').ok,false);
});

test('deck versions use stable SHA-256 content identity and edits produce a new immutable version',async()=>{
  const first=await core.createDeckVersion(deckDraft(),{createdAt:WHEN});
  const same=await core.createDeckVersion(deckDraft({mainText:mainText.split('\n').reverse().join('\n')}));
  assert.equal(first.id,same.id);assert.equal(first.contentHash,same.contentHash);assert.equal(first.contentHash.length,64);
  assert.equal(first.validation.rulesLegality,'not-checked');assert.equal(first.validation.cardTypes,'user-assigned');
  const changed=await core.createDeckVersion(deckDraft({parentVersionId:first.id,mainText:mainText.replace('GD01-013','GD01-014')}));
  assert.notEqual(first.id,changed.id);assert.equal(changed.parentVersionId,first.id);
  const h=harness();const saved=await h.store.saveDeck({draft:deckDraft()});const again=await h.store.saveDeck({draft:deckDraft()});
  assert.equal(again.existing,true);assert.deepEqual(saved.record,again.record);assert.equal(h.writes.length,1);
});

test('match confirmations freeze the selected deck and reject implicit result or wrong source identity',async()=>{
  const source=make(),h=harness({[sessionKey(source)]:source});const deck=(await h.store.saveDeck({draft:deckDraft()})).record;
  await assert.rejects(()=>h.store.saveMatch({draft:matchDraft({identityConfirmed:false})}),/確認/);
  await assert.rejects(()=>h.store.saveMatch({draft:matchDraft({resultConfirmed:false})}),/確認/);
  await assert.rejects(()=>h.store.saveMatch({draft:matchDraft({playerName:'Demo South'})}),/不符/);
  const saved=await h.store.saveMatch({draft:matchDraft({deckVersionId:deck.id})});assert.equal(saved.record.source,'manual');
  assert.deepEqual(saved.record.frozenDeckVersion,deck);
  h.db['msa.deck.'+deck.id].name='Later local mutation';assert.equal(saved.record.frozenDeckVersion.name,'Synthetic deck');
  const second={...source,id:GAME+'.second'};h.db[sessionKey(second)]=second;
  const updated=await h.store.saveMatch({draft:matchDraft({sourceSessionId:second.id,result:'draw'})});
  assert.equal(updated.key,saved.key);assert.equal(Object.keys(h.db).filter(key=>key.startsWith('msa.match.')).length,1);
});

test('win rate deduplicates game/player, separates unconfirmed, and explicitly counts draw/concede',async()=>{
  const values={};
  for(const [index,result] of ['win','loss','draw','concede','unknown'].entries()){
    const record=await core.createMatchRecord(matchDraft({gameId:GAME+'-'+index,result,resultConfirmed:result!=='unknown',firstPlayer:index%2?'second':'first'}),null,{updatedAt:WHEN});
    values['msa.match.'+record.id]=record;
  }
  const original=Object.values(values)[0];values['msa.match.duplicate']={...original,id:'duplicate',updatedAt:'1999-01-01T00:00:00.000Z',result:'loss'};
  const stats=core.calculateStats(values);assert.equal(stats.total,5);assert.equal(stats.confirmed,4);assert.equal(stats.unconfirmed,1);
  assert.equal(stats.wins,1);assert.equal(stats.losses,1);assert.equal(stats.concedes,1);assert.equal(stats.lossesIncludingConcedes,2);assert.equal(stats.draws,1);
  assert.equal(stats.winRate,0.25);assert.equal(stats.decisiveWinRate,1/3);
  const first=core.calculateStats(values,{firstPlayer:'first'});assert.equal(first.total,3);assert.equal(first.confirmed,2);assert.equal(first.winRate,0.5);
  const empty=core.calculateStats(values,{deckVersionId:'missing'});assert.equal(empty.winRate,null);
});

test('conflicting deck versions and related match/note references remap safely while originals remain recoverable',async()=>{
  const original=make(),local={...original,localOnly:true};
  const deck=await core.createDeckVersion(deckDraft(),{createdAt:WHEN});
  const conflictingDeck={...deck,name:'Different local title'};
  const match=await core.createMatchRecord(matchDraft({deckVersionId:deck.id}),deck,{updatedAt:WHEN});
  const note={schemaVersion:1,id:'note-remap',gameId:GAME,playerName:'Demo North',note:'Synthetic note',sourceSessionId:original.id,snapshotId:'synthetic-snapshot'};
  const incoming={[sessionKey(original)]:original,['msa.deck.'+deck.id]:deck,['msa.match.'+match.id]:match,['msa.note.'+note.id]:note};
  const h=harness({[sessionKey(local)]:local,['msa.deck.'+deck.id]:conflictingDeck}),text=JSON.stringify(backup(incoming));
  const preview=await h.store.previewImport({text});assert.equal(preview.summary.copies,2);
  assert.equal((await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true})).ok,true);
  const savedMatch=h.db['msa.match.'+match.id],savedNote=h.db['msa.note.'+note.id];
  assert.notEqual(savedMatch.deckVersionId,deck.id);assert.equal(savedMatch.frozenDeckVersion.id,savedMatch.deckVersionId);
  assert.equal(savedMatch.frozenDeckVersion.name,deck.name);assert.equal(h.db['msa.deck.'+deck.id].name,'Different local title');
  assert.notEqual(savedNote.sourceSessionId,original.id);assert.equal(savedNote.snapshotId,note.snapshotId);assert.equal(savedNote.gameId,GAME);
  assert.equal(savedMatch.sourceSessionId,savedNote.sourceSessionId);
  const receipt=Object.values(h.db).find(record=>record.sourceRecords);assert.deepEqual(receipt.sourceRecords,incoming);
  assert.equal(core.calculateStats(h.db,{deckVersionId:savedMatch.deckVersionId}).confirmed,1);
});

test('preview confirmation survives a service-worker restart and failed receipt writes create no active partial import',async()=>{
  const original=make(),text=JSON.stringify(original),h=harness();
  const preview=await h.store.previewImport({text});const restarted=storeApi.create({storage:h.storage});
  assert.equal((await restarted.applyImport({text,previewToken:preview.previewToken,confirmed:true})).ok,true);
  const failure=harness({},0),p=await failure.store.previewImport({text}),result=await failure.store.applyImport({text,previewToken:p.previewToken,confirmed:true});
  assert.equal(result.partial,false);assert.equal(result.savedKeys.length,0);assert.equal(Object.keys(failure.db).length,0);
});

test('parser rejects combined over-limit zone rows and imported duplicated main cards beyond four',async()=>{
  assert.equal(core.parseDeck('60xR-001\n60xR-001','resources').ok,false);
  const deck=await core.createDeckVersion(deckDraft());
  deck.main[0].count=3;deck.main.push({cardCode:deck.main[0].cardCode,count:1});
  assert.doesNotThrow(()=>core.validateRecords({['msa.deck.'+deck.id]:deck}));
  deck.main[0].count=4;deck.main[1].count=3;
  assert.throws(()=>core.validateRecords({['msa.deck.'+deck.id]:deck}),/不超過 4/);
});

test('archive-key collisions preserve the full incoming archive and remain idempotent',async()=>{
  const record=make(),key='msa.import.shared';
  const incoming={schemaVersion:1,id:'shared',fingerprint:'incoming-fingerprint',sourceRecords:{[sessionKey(record)]:{...record,marker:'INCOMING_ONLY'}}};
  const local={...structuredClone(incoming),fingerprint:'local-fingerprint',sourceRecords:{[sessionKey(record)]:{...record,marker:'LOCAL_ONLY'}}};
  const h=harness({[key]:local}),text=JSON.stringify(backup({[key]:incoming}));
  const preview=await h.store.previewImport({text});assert.equal(preview.items[0].status,'archived-conflict');
  assert.equal((await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true})).ok,true);
  assert.deepEqual(h.db[key],local);
  const preserved=Object.entries(h.db).find(([name])=>name!==key)[1].sourceRecords[key];assert.deepEqual(preserved,incoming);
  const repeated=await h.store.previewImport({text});assert.equal(repeated.summary.writes,0);assert.equal(repeated.summary.skipped,1);
});

test('archive download keeps conflicting original instead of replacing it with the local same-key archive',()=>{
  const record=make(),key='msa.import.shared';
  const incoming={schemaVersion:1,id:'shared',sourceRecords:{[sessionKey(record)]:{...record,marker:'INCOMING_ONLY'}}};
  const local={...incoming,sourceRecords:{[sessionKey(record)]:{...record,marker:'LOCAL_ONLY'}}};
  const receipt={sourceRecords:{[key]:incoming},importedArchiveKeys:[key]};
  assert.deepEqual(core.createArchiveBackup({[key]:local},receipt).records[key],incoming);
});

test('malformed repeated script starts fail promptly without scanning every remaining suffix',()=>{
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.execPath,['-e',`const core=require('./extension/library-core.js');try{core.parseImport('<script '.repeat(50000));process.exit(2)}catch(error){if(!/script/.test(error.message))process.exit(3)}`],{cwd:require('node:path').join(__dirname,'..'),timeout:1500,encoding:'utf8'});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
});

test('match deduplication compares actual timestamps across time zones',async()=>{
  const earlier=await core.createMatchRecord(matchDraft({result:'loss'}),null,{updatedAt:'2026-10-25T10:00:00+08:00'});
  const later={...earlier,id:'later-duplicate',result:'win',updatedAt:'2026-10-25T03:00:00Z'};
  const invalid={...earlier,id:'invalid-duplicate',result:'loss',updatedAt:'not-a-time'};
  const stats=core.calculateStats({['msa.match.'+earlier.id]:earlier,'msa.match.later-duplicate':later,'msa.match.invalid-duplicate':invalid});
  assert.equal(stats.total,1);assert.equal(stats.wins,1);assert.equal(stats.matches[0].id,later.id);
});

test('injected same-key lock protects a live record arriving after preview from being overwritten',async()=>{
  const incoming=make(),h=harness(),text=JSON.stringify(incoming),key=sessionKey(incoming),locked=[];
  const live={...incoming,liveObservation:'newly saved after planning'};
  const lockedStore=storeApi.create({storage:h.storage,withKeyLock:async(name,task)=>{
    locked.push(name);if(name===key)h.db[key]=structuredClone(live);return task();
  }});
  const preview=await lockedStore.previewImport({text});assert.ok(preview.summary.estimatedWriteBytes>JSON.stringify(incoming).length);
  const result=await lockedStore.applyImport({text,previewToken:preview.previewToken,confirmed:true});
  assert.equal(result.ok,false);assert.equal(result.partial,true);assert.ok(locked.includes(key));assert.deepEqual(h.db[key],live);
  assert.equal(h.writes.filter(patch=>Object.hasOwn(patch,key)).length,0);
});

test('key-lock scope covers fresh read, set and verification so later live writes serialize after import',async()=>{
  const incoming=make(),key=sessionKey(incoming),h=harness(),text=JSON.stringify(incoming),queues=new Map();
  let currentLock='',releaseRead,readReached;
  const reached=new Promise(resolve=>{readReached=resolve}),gate=new Promise(resolve=>{releaseRead=resolve});
  let blockOnce=true;
  const originalGet=h.storage.get;
  h.storage.get=async keys=>{
    if(keys===key && blockOnce){blockOnce=false;assert.equal(currentLock,key);readReached();await gate;}
    if(keys===key)assert.equal(currentLock,key);
    return originalGet(keys);
  };
  const originalSet=h.storage.set;
  h.storage.set=async patch=>{if(Object.hasOwn(patch,key))assert.equal(currentLock,key);await originalSet(patch);};
  function withKeyLock(name,task){
    const next=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(async()=>{currentLock=name;try{return await task();}finally{currentLock='';}});
    queues.set(name,next);return next;
  }
  const store=storeApi.create({storage:h.storage,withKeyLock}),preview=await store.previewImport({text});
  const importing=store.applyImport({text,previewToken:preview.previewToken,confirmed:true});await reached;
  let liveRan=false;
  const liveWrite=withKeyLock(key,async()=>{liveRan=true;const prior=(await h.storage.get(key))[key];await h.storage.set({[key]:{...prior,liveObservation:'kept'}});});
  await Promise.resolve();assert.equal(liveRan,false);releaseRead();assert.equal((await importing).ok,true);await liveWrite;
  assert.equal(h.db[key].liveObservation,'kept');
});

test('an imported receipt fingerprint cannot substitute for missing original evidence',async()=>{
  const incoming=make(),local={...incoming,localOnly:true},h=harness({[sessionKey(local)]:local}),text=JSON.stringify(incoming);
  const firstPlan=await core.planImport(h.db,core.parseImport(text));
  const receiptEntry=Object.entries(firstPlan.writes).find(([key])=>key.startsWith('msa.import.'));
  const [receiptKey,receipt]=receiptEntry;h.db[receiptKey]={...receipt,sourceRecords:{}};
  const preview=await h.store.previewImport({text});assert.equal((await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true})).ok,true);
  const copy=Object.entries(h.db).find(([key])=>key.startsWith('msa.session.')&&key!==sessionKey(local))[1];
  assert.notEqual('msa.import.'+copy.importProvenance.receiptId,receiptKey);
  assert.deepEqual(h.db['msa.import.'+copy.importProvenance.receiptId].sourceRecords[sessionKey(incoming)],incoming);
});

test('single-session JSON restores appended workspace metadata while preserving older audit fields',()=>{
  const record=make(),old={schemaVersion:1,id:'note-audit',gameId:GAME,playerName:'Demo North',note:'older'},latest={...old,note:'latest'};
  record.exportInfo={workspaceRecords:{'msa.note.note-audit':old}};
  record.recorderExportInfo={workspaceRecords:{'msa.note.note-audit':latest}};
  const result=core.parseImport(JSON.stringify(record));
  assert.deepEqual(result.records[sessionKey(record)],record);
  assert.deepEqual(result.records['msa.note.note-audit'],latest);
  delete record.recorderExportInfo;record.recorderExportInfo2={workspaceRecords:{'msa.note.note-audit':latest}};
  assert.deepEqual(core.parseImport(JSON.stringify(record)).records['msa.note.note-audit'],latest);
  record.recorderExportInfo2.workspaceRecords={'msa.settings':{enabled:false}};
  assert.throws(()=>core.parseImport(JSON.stringify(record)),/不允許/);
});

test('deck code formats accept PR/P/SC/SLB without claiming existence and keep EXB out of main',()=>{
  for(const code of ['PR-001','P-001','SC01-001','SLB01-001']) assert.equal(core.parseDeck(mainText.replace('GD01-013',code)).ok,true);
  assert.equal(core.parseDeck(mainText.replace('GD01-013','EXB-001')).ok,false);
  assert.equal(core.parseDeck('1xEXB-001','tokens').ok,true);
});

test('immutable deck reuse checks real content instead of trusting imported hash metadata',async()=>{
  const h=harness(),saved=await h.store.saveDeck({draft:deckDraft()});
  h.db[saved.key].main[0].cardCode='GD01-099';
  await assert.rejects(()=>h.store.saveDeck({draft:deckDraft()}),/ID 衝突/);
  assert.equal(h.db[saved.key].main[0].cardCode,'GD01-099');
});
