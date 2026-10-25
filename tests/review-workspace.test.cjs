'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const workspace=require('../extension/review-workspace.js');
const GAME='00000000-0000-4000-8000-000000000701';
const SECOND_GAME='00000000-0000-4000-8000-000000000702';
const current={schemaVersion:1,id:'segment-a',gameId:GAME,playerName:'Demo North',snapshots:[]};
const note=(id,extra={})=>({schemaVersion:1,id,gameId:GAME,playerName:'Demo North',sourceSessionId:'segment-a',snapshotId:'snapshot-a',
  turn:null,turnSource:'unknown',observedTurn:3,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z',note:'Synthetic note',tag:'順序',...extra});
const match=(id,extra={})=>({schemaVersion:1,id,gameId:GAME,playerName:'Demo North',identityConfirmed:true,source:'manual',
  sourceSessionId:'segment-a',deckVersionId:'deck-a',result:'unknown',resultConfirmed:false,...extra});

test('review notes require a known player and explicit selected source IDs',()=>{
  const values={'msa.note.own':note('own'),'msa.note.other':note('other',{playerName:'Demo South'}),
    'msa.note.older':note('older',{sourceSessionId:'segment-b'}),'msa.note.foreign':note('foreign',{gameId:SECOND_GAME})};
  assert.deepEqual(workspace.recordsForSession(current,values).map(item=>item.id),['own']);
  assert.deepEqual(workspace.recordsForSession({...current,playerName:''},values),[]);
  assert.deepEqual(workspace.recordsForSession({...current,playerName:'  '},values),[]);
  assert.deepEqual(workspace.recordsForSession({...current,id:null},values),[]);
  assert.deepEqual(workspace.recordsForSession({...current,isCombined:true,sourceSessions:[]},values),[]);
});

test('combined review selects notes by original source segment and retains unknown turn anchors',()=>{
  const values={'msa.note.a':note('a'),'msa.note.b':note('b',{sourceSessionId:'segment-b',observedTurn:1}),
    'msa.note.outside':note('outside',{sourceSessionId:'segment-c'})};
  const combined={...current,id:'combined-synthetic',isCombined:true,sourceSessions:[{id:'segment-a'},{id:'segment-b'}]};
  const result=workspace.recordsForSession(combined,values);
  assert.deepEqual(result.map(item=>item.id),['a','b']);
  assert.equal(result[1].turn,null);assert.equal(result[1].observedTurn,1);assert.equal(result[1].sourceSessionId,'segment-b');
  result[0].note='changed';assert.equal(values['msa.note.a'].note,'Synthetic note');
});

test('deleted notes are opt-in for display and always included in scoped exports',()=>{
  const values={'msa.note.active':note('active'),'msa.note.deleted':note('deleted',{deletedAt:'2026-01-02T00:00:00Z',customLegacy:{keep:true}})};
  assert.deepEqual(workspace.recordsForSession(current,values).map(item=>item.id),['active']);
  assert.equal(workspace.recordsForSession(current,values,{includeDeleted:true}).length,2);
  const exported=workspace.exportRecords(current,values);
  assert.deepEqual(exported['msa.note.deleted'],values['msa.note.deleted']);
  exported['msa.note.deleted'].customLegacy.keep=false;assert.equal(values['msa.note.deleted'].customLegacy.keep,true);
});

test('workspace export includes only this player/game manual matches and their exact referenced deck versions',()=>{
  const deck={schemaVersion:1,id:'deck-a',deckId:'family-a',name:'Synthetic deck',main:[],resources:[],tokens:[],legacy:{preserve:true}};
  const values={'msa.note.own':note('own'),'msa.note.outside':note('outside',{sourceSessionId:'segment-z'}),
    'msa.match.own':match('own'), 'msa.match.opponent':match('opponent',{playerName:'Demo South',deckVersionId:'deck-b'}),
    'msa.match.foreign':match('foreign',{gameId:SECOND_GAME,deckVersionId:'deck-c'}),
    'msa.match.unconfirmed':match('unconfirmed',{identityConfirmed:false,deckVersionId:'deck-d'}),
    'msa.match.auto':match('auto',{source:'inferred',deckVersionId:'deck-e'}),
    'msa.match.duplicate-key':match('different-id'),
    'msa.deck.deck-a':deck,'msa.deck.deck-b':{schemaVersion:1,id:'deck-b'},'msa.deck.unrelated':{schemaVersion:1,id:'unrelated'},
    'msa.session.segment-a':current,'msa.settings':{playerName:'Demo North'},'msa.livePanel':{expanded:true},
    'msa.import.archive':{schemaVersion:1,id:'archive',sourceRecords:{'msa.note.extra':note('extra')}}};
  const exported=workspace.exportRecords(current,values);
  assert.deepEqual(Object.keys(exported).sort(),['msa.deck.deck-a','msa.match.own','msa.note.own']);
  assert.deepEqual(exported['msa.deck.deck-a'],deck);
  assert.deepEqual(workspace.exportRecords({...current,playerName:''},values),{});
});

test('note/deck/match key mismatches and unsupported schemas do not enter a report',()=>{
  const values={'msa.note.bad-key':note('different-id'),'msa.note.new':note('new',{schemaVersion:2}),
    'msa.match.own':match('own'),'msa.deck.deck-a':{schemaVersion:1,id:'different-deck'},
    'msa.match.new':match('new',{schemaVersion:2})};
  assert.deepEqual(workspace.recordsForSession(current,values),[]);
  assert.deepEqual(Object.keys(workspace.exportRecords(current,values)),['msa.match.own']);
  values['msa.deck.deck-a']={schemaVersion:2,id:'deck-a'};
  assert.deepEqual(Object.keys(workspace.exportRecords(current,values)),['msa.match.own']);
});

test('displayed note turn labels keep direct Log, estimated, and uncalibrated anchors separate',()=>{
  assert.equal(workspace.turnLabel({turn:10,turnSource:'log'}),'Log 校準 · T10');
  assert.equal(workspace.turnLabel({turn:10,turnSource:'phase-observed'}),'推計回合 · T10');
  assert.equal(workspace.turnLabel({turn:10,turnSource:'unknown',observedTurn:2}),'觀察 2 · 回合未校準');
  assert.equal(workspace.turnLabel({observedAt:'2026-01-01T00:00:00Z'}),'回合未校準');
});

// Minimal DOM lifecycle surface, deliberately without parsing or executing
// markup. Browser rendering and native-dialog behavior remain browser checks.
function documentHarness() {
  class Node {
    constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.parentNode=null;this.dataset={};this.listeners=new Map();this.attributes={};this.className='';this.disabled=false;this.hidden=false;this.open=false;this.value='';this._text='';
      this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ');},
        toggle:(name,enabled)=>{const present=this.className.split(' ').includes(name),next=enabled===undefined?!present:enabled;
          this.className=this.className.split(' ').filter(item=>item&&item!==name).concat(next?[name]:[]).join(' ');return next;}};
    }
    get isConnected(){return this===this.ownerDocument.body || Boolean(this.parentNode?.isConnected);}
    set textContent(value){this._text=String(value);this.replaceChildren();}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...nodes);}
    insertBefore(node,next){node.remove();node.parentNode=this;const index=this.children.indexOf(next);this.children.splice(index<0?this.children.length:index,0,node);}
    remove(){if(this.parentNode){const index=this.parentNode.children.indexOf(this);if(index>=0)this.parentNode.children.splice(index,1);this.parentNode=null;}}
    setAttribute(name,value){this.attributes[name]=String(value);}
    addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
    async dispatch(name){if(name==='click'&&this.disabled)return;const event={target:this,preventDefault(){}};await Promise.all((this.listeners.get(name)||[]).map(callback=>callback(event)));}
    focus(){this.ownerDocument.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const doc={createElement:tag=>new Node(tag,doc),createTextNode:value=>{const node=new Node('#text',doc);node._text=value;return node;},activeElement:null};
  doc.body=new Node('body',doc);const container=doc.createElement('section');doc.body.append(container);
  const find=predicate=>{const visit=node=>predicate(node)?node:node.children.map(visit).find(Boolean);return visit(doc.body);};
  return {doc,container,find,action:name=>find(node=>node.dataset.action===name),field:name=>find(node=>node.dataset.field===name)};
}
function uiHarness(options={}) {
  const dom=documentHarness();
  const source={...current,snapshots:[{id:'snapshot-a',timestamp:'2026-01-01T00:00:00Z',turn:null,turnSource:'unknown',observedTurn:3}]};
  let selected=source;
  const values={'msa.session.segment-a':source,...options.values},messages=[],notices=[];
  const originalChrome=globalThis.chrome;
  globalThis.chrome={runtime:{sendMessage:async message=>{
    messages.push(structuredClone(message));
    if(options.send)return options.send(message);
    if(message.type==='MSA_OPEN_LIBRARY')return {ok:true};
    const record=message.action==='create'?note('created',message.payload):{...values['msa.note.'+message.noteId],...message.payload,updatedAt:'2026-01-03T00:00:00Z'};
    if(message.payload?.deleted===true)record.deletedAt='2026-01-03T00:00:00Z';
    if(message.payload?.deleted===false)delete record.deletedAt;
    delete record.deleted;values['msa.note.'+record.id]=record;return {ok:true,bookmark:record};
  }}};
  const api=workspace.create({container:dom.container,getCurrent:()=>selected,getValues:()=>values,
    onJump:options.onJump||(()=>false),notice:(message,error)=>notices.push({message,error})});
  return {...dom,api,values,messages,notices,source,
    select(value){selected=value;api.render();},
    addButton(snapshot=source.snapshots[0]){const button=api.buttonForSnapshot(snapshot);dom.doc.body.append(button);return button;},
    close(){globalThis.chrome=originalChrome;}};
}

test('review dialog keeps its draft and original source anchor across live renders and selection changes',async()=>{
  const h=uiHarness();try{
    const button=h.addButton();await button.dispatch('click');
    h.field('review-note').value='Keep this original snapshot';h.field('review-tag').value='順序';
    h.api.render();assert.equal(h.field('review-note').value,'Keep this original snapshot');
    h.select({...current,id:'segment-b'});assert.equal(h.field('review-note').value,'Keep this original snapshot');
    await h.find(node=>node.tagName==='FORM').dispatch('submit');
    assert.deepEqual(h.messages[0],{type:'MSA_NOTE_ACTION',action:'create',sourceSessionId:'segment-a',
      payload:{snapshotId:'snapshot-a',note:'Keep this original snapshot',tag:'順序'}});
    assert.equal(h.find(node=>node.tagName==='DIALOG').open,false);
    assert.equal(h.notices.at(-1).error,false);
  }finally{h.close();}
});

test('a failed save keeps the draft open, clears busy controls, and never claims success',async()=>{
  const h=uiHarness({send:async()=>({ok:false,reason:'Synthetic save failure'})});try{
    await h.addButton().dispatch('click');h.field('review-note').value='Do not lose this draft';
    await h.find(node=>node.tagName==='FORM').dispatch('submit');
    assert.equal(h.find(node=>node.tagName==='DIALOG').open,true);
    assert.equal(h.field('review-note').value,'Do not lose this draft');assert.equal(h.action('note-save').disabled,false);
    assert.match(h.find(node=>node.className==='workspace-dialog-status').textContent,/Synthetic save failure/);
    assert.equal(h.notices.filter(item=>/已保存/.test(item.message)).length,0);
    await h.action('note-cancel').dispatch('click');assert.equal(h.find(node=>node.tagName==='DIALOG').open,false);
  }finally{h.close();}
});

test('soft delete and restore send only the explicit deleted flag and preserve the original anchor',async()=>{
  const h=uiHarness({values:{'msa.note.saved':note('saved')}});try{
    await h.action('note-delete').dispatch('click');
    assert.deepEqual(h.messages[0],{type:'MSA_NOTE_ACTION',action:'update',noteId:'saved',payload:{deleted:true}});
    h.action('workspace-show-deleted').checked=true;await h.action('workspace-show-deleted').dispatch('change');
    await h.action('note-restore').dispatch('click');
    assert.deepEqual(h.messages[1],{type:'MSA_NOTE_ACTION',action:'update',noteId:'saved',payload:{deleted:false}});
    assert.equal(h.values['msa.note.saved'].sourceSessionId,'segment-a');assert.equal(h.values['msa.note.saved'].snapshotId,'snapshot-a');
  }finally{h.close();}
});

test('unavailable source disables creation, missing jump is explained, and management uses a source ID',async()=>{
  const h=uiHarness({values:{'msa.note.orphan':note('orphan',{snapshotId:'missing'})}});try{
    assert.equal(h.addButton({id:'missing'}).disabled,true);
    assert.equal(h.addButton({}).disabled,true);
    await h.action('note-jump').dispatch('click');assert.match(h.notices.at(-1).message,/未在本次檢視範圍/);
    h.select({...current,id:'combined',isCombined:true,sourceSessions:[{id:'segment-a'},{id:'segment-b'}]});
    await h.action('workspace-manage').dispatch('click');
    assert.deepEqual(h.messages.at(-1),{type:'MSA_OPEN_LIBRARY',gameId:GAME,sessionId:'segment-a'});
    h.select({...current,playerName:''});assert.equal(h.addButton().disabled,true);
  }finally{h.close();}
});
