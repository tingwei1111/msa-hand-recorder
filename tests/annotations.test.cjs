'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const notes=require('../extension/annotations-core.js');
const session={id:'source',gameId:'game',playerName:'Me'},snapshot={id:'s1',turn:null,turnSource:'unknown',observedTurn:2,timestamp:'2000-01-01T00:00:00Z'};
test('bookmark uses the stored snapshot anchor, retaining uncalibrated turns and literal text',()=>{
 const note=notes.create(session,snapshot,{turn:99,note:'<script>literal</script>',tag:'待檢討'},{id:'n1',now:'2000-01-01'});
 assert.equal(note.turn,null);assert.equal(note.turnSource,'unknown');assert.equal(note.observedTurn,2);
 assert.equal(note.snapshotId,'s1');assert.equal(note.sourceSessionId,'source');assert.equal(note.note,'<script>literal</script>');
});
test('editing and soft deletion never move the original game/player/snapshot anchor',()=>{
 const note=notes.create(session,snapshot,{note:'old'},{id:'n1',now:'2000-01-01'});
 const updated=notes.update(note,{note:'new',gameId:'wrong',snapshotId:'wrong',deleted:true},'2000-01-02');
 assert.equal(updated.gameId,'game');assert.equal(updated.snapshotId,'s1');assert.ok(updated.deletedAt);assert.equal(note.note,'old');
 assert.equal(notes.list({'msa.note.n1':updated},{gameId:'game'}).length,0);
 assert.equal(notes.list({'msa.note.n1':updated},{gameId:'game',includeDeleted:true}).length,1);
 assert.equal(notes.update(updated,{deleted:false}).deletedAt,undefined);
});
test('bookmarks reject unidentified hands and excessive notes; selection is scoped',()=>{
 assert.throws(()=>notes.create({...session,playerName:''},snapshot,{},{}));
 assert.throws(()=>notes.create(session,snapshot,{note:'x'.repeat(1501)},{id:'n1'}));
 const note=notes.create(session,snapshot,{}, {id:'n1'});
 assert.equal(notes.list({'msa.note.n1':note},{gameId:'other'}).length,0);
 assert.equal(notes.list({'msa.note.n1':note},{gameId:'game',playerName:'Other'}).length,0);
 assert.equal(notes.list({'msa.note.n1':note},{gameId:'game',sourceIds:['other-run']}).length,0);
});
