'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const tabs=require('../extension/library-tabs.js');

function harness(hash='') {
  const listeners=()=>({
    events:new Map(),
    addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,new Set());this.events.get(type).add(fn);},
    removeEventListener(type,fn){this.events.get(type)?.delete(fn);},
    dispatch(type,detail={}){const event={prevented:false,preventDefault(){this.prevented=true;},...detail};for(const fn of this.events.get(type)||[])fn(event);return event;}
  });
  const doc={activeElement:null},nodes={},history=[];
  function node(id){return {...listeners(),id,attributes:{},hidden:false,tabIndex:0,children:[],
    setAttribute(key,value){this.attributes[key]=String(value);},
    contains(other){return this===other||this.children.some(child=>child.contains(other));},
    focus(){doc.activeElement=this;}};}
  for(const id of tabs.SECTIONS){nodes[id]=node(id);nodes['tab-'+id]=node('tab-'+id);}
  const outside=node('language');doc.activeElement=outside;doc.getElementById=id=>nodes[id];
  const win={...listeners(),location:{hash,pathname:'/extension/library.html',search:'?id=synthetic-session'},history:{pushState(_state,_title,url){history.push(url);win.location.hash=url.slice(url.indexOf('#'));}}};
  const api=tabs.mount({document:doc,window:win});
  return {doc,nodes,win,api,history,outside,node,go(hash,type='hashchange'){win.location.hash=hash;win.dispatch(type);}};
}
function assertSelected(h,id){
  assert.equal(h.api.selected,id);
  for(const key of tabs.SECTIONS){assert.equal(h.nodes[key].hidden,key!==id);assert.equal(h.nodes['tab-'+key].attributes['aria-selected'],String(key===id));assert.equal(h.nodes['tab-'+key].tabIndex,key===id?0:-1);}
}

test('default matches and existing deep links select exactly one panel without rewriting the URL',()=>{
  for(const [hash,id]of [['','matches'],['#matches','matches'],['#decks','decks'],['#statistics','statistics'],['#restore','restore'],['#unknown','matches'],['#%E0%A4%A','matches']]){
    const h=harness(hash);assertSelected(h,id);assert.equal(h.history.length,0);assert.equal(h.win.location.hash,hash);assert.equal(h.doc.activeElement,h.outside);
  }
});

test('click navigation preserves the selected session query and avoids duplicate history entries',()=>{
  const h=harness();h.nodes['tab-decks'].dispatch('click');assertSelected(h,'decks');
  assert.deepEqual(h.history,['/extension/library.html?id=synthetic-session#decks']);
  h.nodes['tab-decks'].dispatch('click');assert.equal(h.history.length,1);
  h.go('#statistics','popstate');assertSelected(h,'statistics');assert.equal(h.history.length,1);
  h.go('#restore');assertSelected(h,'restore');
});

test('horizontal arrow navigation wraps, Home and End work, and browser shortcuts are untouched',()=>{
  const h=harness();
  let event=h.nodes['tab-matches'].dispatch('keydown',{key:'ArrowLeft'});assert.equal(event.prevented,true);assertSelected(h,'restore');assert.equal(h.doc.activeElement,h.nodes['tab-restore']);
  h.nodes['tab-restore'].dispatch('keydown',{key:'ArrowRight'});assertSelected(h,'matches');
  h.nodes['tab-matches'].dispatch('keydown',{key:'End'});assertSelected(h,'restore');
  h.nodes['tab-restore'].dispatch('keydown',{key:'Home'});assertSelected(h,'matches');
  for(const detail of [{key:'Tab'},{key:'ArrowDown'},{key:'ArrowRight',altKey:true},{key:'End',metaKey:true}]){
    event=h.nodes['tab-matches'].dispatch('keydown',detail);assert.equal(event.prevented,false);assertSelected(h,'matches');
  }
});

test('tab changes retain the exact draft, selection, disclosure and import-preview nodes',()=>{
  const h=harness();
  const draft=h.node('draft');draft.value='4xGD01-001\n2xGD01-002';draft.checked=true;
  const preview=h.node('preview');preview.previewToken='synthetic-token';preview.hidden=false;
  const selection=h.node('selection');selection.value='frozen-deck-v1';
  const details=h.node('details');details.open=true;
  h.nodes.decks.children.push(draft,details);h.nodes.matches.children.push(selection);h.nodes.restore.children.push(preview);
  for(const id of ['decks','restore','statistics','matches'])h.nodes['tab-'+id].dispatch('click');
  // A language renderer changes labels, not the selected tab or form contents.
  h.nodes['tab-decks'].textContent='Decks';h.go('#decks');
  assertSelected(h,'decks');assert.equal(h.nodes.decks.children[0],draft);assert.equal(draft.value,'4xGD01-001\n2xGD01-002');assert.equal(draft.checked,true);
  assert.equal(selection.value,'frozen-deck-v1');assert.equal(details.open,true);assert.equal(preview.previewToken,'synthetic-token');assert.equal(preview.hidden,false);
});

test('history navigation rescues focus from a hidden form without stealing focus elsewhere',()=>{
  const h=harness();const input=h.node('player');h.nodes.matches.children.push(input);input.focus();
  h.go('#restore','popstate');assert.equal(h.doc.activeElement,h.nodes['tab-restore']);
  h.outside.focus();h.go('#decks');assert.equal(h.doc.activeElement,h.outside);
});

test('disposal removes navigation hooks and incomplete markup is rejected',()=>{
  const h=harness();h.api.destroy();h.nodes['tab-decks'].dispatch('click');h.go('#restore');assertSelected(h,'matches');
  assert.throws(()=>tabs.mount({document:{getElementById:()=>null},window:{}}),/markup is incomplete/);
});

test('real markup connects the four accessible tabs to persistent panels and loads navigation first',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../extension/library.html'),'utf8');
  assert.ok(html.indexOf('src="library-tabs.js"')<html.indexOf('src="library.js"'));
  assert.match(html,/role="tablist"[^>]*aria-orientation="horizontal"/);
  for(const id of tabs.SECTIONS){
    assert.match(html,new RegExp('id="tab-'+id+'"[^>]*role="tab"[^>]*aria-controls="'+id+'"'));
    const panel=html.match(new RegExp('<section id="'+id+'"[^>]*>'))?.[0];assert.ok(panel);
    assert.match(panel,/role="tabpanel"/);assert.ok(panel.includes('aria-labelledby="tab-'+id+'"'));
    assert.equal(/\bhidden\b/.test(panel),id!=='matches');
  }
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
});
