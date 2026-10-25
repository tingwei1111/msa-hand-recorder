'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../extension/library-core.js');
const recorder=require('../extension/recorder-core.js');
const battle=require('../extension/battle-log-core.js');
const annotations=require('../extension/annotations-core.js');
const reviewWorkspace=require('../extension/review-workspace.js');
const storeApi=require('../extension/library-store.js');
const GAME='00000000-0000-4000-8000-000000000611';
const WHEN='2000-01-01T00:00:00.000Z';
const key=session=>'msa.session.'+session.id;
const backup=records=>({format:core.FORMAT,schemaVersion:1,exportedAt:WHEN,records});
function source(run,count=1){
  const session=recorder.createSession({id:GAME+'.'+run,gameId:GAME,playerName:'Synthetic Player',startedAt:WHEN});
  return recorder.appendSnapshot(session,{timestamp:WHEN,turn:1,turnSource:'log',observedTurn:1,
    hand:[{cardCode:'GD01-001',count}],expectedCount:count,unknownCount:0,quality:'complete'});
}
function fixture(){
  const a=source('alpha'),b=source('bravo',2);
  a.futureSource={unchanged:'synthetic extra field'};
  const combined=battle.combineSessions([a,b]);
  combined.futureCombined={unchanged:['original wrapper']};
  const note=annotations.create(a,a.snapshots[0],{note:'Synthetic anchored note'},{id:'synthetic-note',now:WHEN});
  return {a,b,combined,note,workspaceRecords:{['msa.note.'+note.id]:note}};
}
function harness(initial={}){
  const db=structuredClone(initial);
  const storage={async get(keys){if(keys===null)return structuredClone(db);const names=Array.isArray(keys)?keys:[keys];
    return Object.fromEntries(names.filter(name=>Object.hasOwn(db,name)).map(name=>[name,structuredClone(db[name])]))},
    async set(patch){Object.assign(db,structuredClone(patch));}};
  return {db,store:storeApi.create({storage})};
}
async function restore(h,text){
  const preview=await h.store.previewImport({text});
  const result=await h.store.applyImport({text,previewToken:preview.previewToken,confirmed:true});
  assert.equal(result.ok,true);return preview;
}
function assertNoteAnchor(db,combined,note){
  const notes=reviewWorkspace.recordsForSession(combined,db);
  assert.equal(notes.length,1);assert.equal(notes[0].sourceSessionId,note.sourceSessionId);
  const source=db['msa.session.'+note.sourceSessionId];
  assert.ok(source);assert.equal(source.gameId,combined.gameId);assert.equal(source.playerName,combined.playerName);
  assert.ok(combined.sourceSessions.some(item=>item.id===source.id));
  assert.ok(source.snapshots.some(snapshot=>snapshot.id===note.snapshotId));
  const shown=combined.snapshots.find(snapshot=>snapshot.id===note.snapshotId);
  assert.equal(shown.sourceSessionId,source.id);
  // The ordinary note-create path can use the restored source without any
  // fallback to an unpersisted embedded report object.
  assert.equal(annotations.create(source,source.snapshots[0],{note:'New restored note'},
    {id:'new-synthetic-note',now:WHEN}).sourceSessionId,source.id);
}

for(const format of ['json','html','batch']) test('combined '+format+' restores complete source sessions and usable note anchors',async()=>{
  const {a,b,combined,note,workspaceRecords}=fixture();
  let original=combined,text;
  if(format==='json'){
    original={...combined,exportInfo:{workspaceRecords}};text=JSON.stringify(original);
  }else if(format==='html')text=battle.toHTML(combined,{exportInfo:{workspaceRecords}});
  else text=JSON.stringify(backup({[key(combined)]:combined,...workspaceRecords}));
  const h=harness(),preview=await restore(h,text);
  assert.equal(preview.summary.sessions,3);
  assert.deepEqual(h.db[key(a)],a);assert.deepEqual(h.db[key(b)],b);
  assert.deepEqual(h.db[key(combined)],original);
  assert.equal(h.db[key(combined)].snapshots.length,2);
  assertNoteAnchor(h.db,h.db[key(combined)],h.db['msa.note.'+note.id]);
  assert.equal((await h.store.previewImport({text})).summary.writes,0);
});

test('source and wrapper conflicts map all active anchors while preserving exact incoming originals',async()=>{
  const {a,b,combined,note,workspaceRecords}=fixture();
  combined.captureIssues=[{sourceSessionId:a.id,reason:'Synthetic saved gap'}];
  const match=await core.createMatchRecord({gameId:GAME,playerName:a.playerName,sourceSessionId:a.id,
    identityConfirmed:true,firstPlayer:'first',result:'win',resultConfirmed:true},null,{updatedAt:WHEN});
  workspaceRecords['msa.match.'+match.id]=match;
  const original={...combined,exportInfo:{workspaceRecords}},text=JSON.stringify(original);
  const localA={...a,localOnly:'preserved local source'},localWrapper={...combined,localOnly:'preserved local report'};
  const h=harness({[key(a)]:localA,[key(combined)]:localWrapper}),preview=await restore(h,text);
  assert.equal(preview.summary.copies,2);
  assert.deepEqual(h.db[key(a)],localA);assert.deepEqual(h.db[key(combined)],localWrapper);
  const copy=Object.values(h.db).find(item=>item.isCombined&&item.importProvenance?.originalId===combined.id);
  const savedNote=h.db['msa.note.'+note.id],savedMatch=h.db['msa.match.'+match.id];
  assert.notEqual(savedNote.sourceSessionId,a.id);assertNoteAnchor(h.db,copy,savedNote);
  assert.equal(savedMatch.sourceSessionId,savedNote.sourceSessionId);
  assert.equal(copy.captureIssues[0].sourceSessionId,savedNote.sourceSessionId);
  assert.equal(copy.sourceRecords.find(item=>item.futureSource).id,savedNote.sourceSessionId);
  assert.deepEqual(copy.sourceRecords.find(item=>item.id===b.id),b);
  const receipt=h.db['msa.import.'+copy.importProvenance.receiptId];
  assert.deepEqual(receipt.sourceRecords[key(combined)],original);
  assert.deepEqual(receipt.sourceRecords[key(a)],a);
  assert.deepEqual(receipt.sourceRecords['msa.note.'+note.id],note);
  assert.equal((await h.store.previewImport({text})).summary.writes,0);
  // A subsequent complete backup restores the forked source anchors as well.
  const next=harness();await restore(next,JSON.stringify(core.createBackup(h.db)));
  assertNoteAnchor(next.db,next.db[key(copy)],next.db['msa.note.'+note.id]);
});

test('a top-level live source takes precedence over a stale embedded copy and emits a preview warning',async()=>{
  const {a,b,combined,note,workspaceRecords}=fixture();
  const updated=recorder.appendSnapshot(a,{timestamp:'2000-01-01T00:01:00.000Z',turn:2,turnSource:'log',
    hand:[{cardCode:'GD01-002',count:1}],expectedCount:1,quality:'complete'});
  const text=JSON.stringify(backup({[key(combined)]:combined,[key(a)]:updated,...workspaceRecords}));
  const parsed=core.parseImport(text);
  assert.deepEqual(parsed.records[key(a)],updated);assert.deepEqual(parsed.records[key(b)],b);
  assert.deepEqual(parsed.records[key(combined)].sourceRecords[0],a);
  const h=harness(),preview=await restore(h,text);
  assert.ok(preview.warnings.some(warning=>warning.includes('獨立記錄')));
  assert.deepEqual(h.db[key(a)],updated);
  assertNoteAnchor(h.db,h.db[key(combined)],h.db['msa.note.'+note.id]);
});

test('conflicting embedded sources with the same ID cannot silently replace each other',()=>{
  const {combined}=fixture();
  combined.sourceRecords.push({...combined.sourceRecords[0],different:'synthetic conflict'});
  assert.throws(()=>core.parseImport(JSON.stringify(combined)),/同 ID 不同內容/);
  combined.sourceRecords.pop();combined.sourceRecords.push(structuredClone(combined.sourceRecords[0]));
  const parsed=core.parseImport(JSON.stringify(combined));
  assert.equal(Object.keys(parsed.records).length,3);
  assert.equal(parsed.records[key(combined)].sourceRecords.length,3);
});

test('combined source expansion rejects another game, another player, or anonymous hand observations',()=>{
  for(const mutate of [source=>{source.gameId=GAME+'-other'},source=>{source.playerName='Other Synthetic Player'},source=>{source.playerName=''}]){
    const {combined}=fixture();mutate(combined.sourceRecords[0]);
    assert.throws(()=>core.parseImport(JSON.stringify(combined)),/對局或玩家身分不符/);
  }
  const {combined}=fixture();combined.playerName='';
  assert.throws(()=>core.parseImport(JSON.stringify(combined)),/對局或玩家身分不符/);
});

test('anonymous public-only source is restored without inventing a player or a hand',()=>{
  const a=source('known'),anonymous=recorder.createSession({id:GAME+'.public',gameId:GAME,playerName:'',startedAt:WHEN});
  const combined=battle.combineSessions([a,anonymous]),parsed=core.parseImport(JSON.stringify(combined));
  assert.deepEqual(parsed.records[key(anonymous)],anonymous);
  assert.equal(parsed.records[key(anonymous)].playerName,'');
  assert.equal(parsed.records[key(anonymous)].snapshots.length,0);
});
