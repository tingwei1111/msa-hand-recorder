'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ui = require('../extension/deck-tracker-ui.js');

function documentHarness() {
  class Node {
    constructor(tag, doc) {
      this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.parentNode=null;
      this.dataset={}; this.attributes={}; this.listeners=new Map(); this.className=''; this._text='';
      this.value=''; this.disabled=false; this.hidden=false; this.open=false; this.scrollTop=0;
      this.classList={toggle:(name,enabled)=>{const existing=this.className.split(' ').filter(Boolean),next=enabled===undefined?!existing.includes(name):enabled;
        this.className=existing.filter(value=>value!==name).concat(next?[name]:[]).join(' '); return next;}};
    }
    get isConnected() { return this===this.ownerDocument.body || Boolean(this.parentNode?.isConnected); }
    set innerHTML(_) { throw new Error('Tests reject markup interpolation'); }
    set textContent(value) { this._text=String(value); this.replaceChildren(); }
    get textContent() { return this._text+this.children.map(item=>item.textContent).join(''); }
    append(...nodes) { for(const node of nodes){node.remove(); node.parentNode=this; this.children.push(node);} }
    replaceChildren(...nodes) { for(const child of [...this.children])child.remove(); this.children=[]; this.append(...nodes); }
    insertBefore(node,next) { node.remove(); node.parentNode=this; const index=this.children.indexOf(next); this.children.splice(index<0?this.children.length:index,0,node); }
    remove() { if(this.parentNode){if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;
      const index=this.parentNode.children.indexOf(this);if(index>=0)this.parentNode.children.splice(index,1);this.parentNode=null;} }
    contains(node) { return this===node || this.children.some(child=>child.contains(node)); }
    getRootNode() { return this.parentNode?this.parentNode.getRootNode():this.ownerDocument; }
    setAttribute(name,value) { this.attributes[name]=String(value); }
    addEventListener(name,callback) { if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback); }
    async dispatch(name) { if(name==='click'&&this.disabled)return; const event={target:this,preventDefault(){}};
      await Promise.all((this.listeners.get(name)||[]).map(callback=>callback(event))); }
    focus() { this.ownerDocument.activeElement=this; }
  }
  const doc={createElement:tag=>new Node(tag,doc),activeElement:null};doc.body=new Node('body',doc);doc.activeElement=doc.body;
  function findAll(predicate,node=doc.body) { return (predicate(node)?[node]:[]).concat(node.children.flatMap(child=>findAll(predicate,child))); }
  return {doc,findAll,role:(value,parent=doc.body)=>findAll(node=>node.dataset.role===value,parent)[0]};
}
const deck={id:'deck-synthetic.v-1',name:'合成牌組',mainCount:50};
const row=(cardCode,extra={})=>({cardCode,name:'',deckCount:4,handCount:0,handCountKind:'exact',publicUseCount:0,outsideDeck:false,...extra});
const model=extra=>({contextKey:'synthetic-game.run-a',gameId:'synthetic-game',sessionId:'synthetic-game.run-a',playerName:'Demo North',state:'bound',canBind:true,
  deck:{...deck},availableDecks:[{...deck},{id:'deck-synthetic.v-2',name:'合成牌組 v2'}],
  rows:[row('GD99-001',{handCount:2,publicUseCount:1}),row('GD99-002')],
  publicCards:{own:[],opponent:[],unknown:[],tokens:[]},stats:{confirmed:0,wins:0,losses:0,draws:0,concedes:0,winRate:null},
  warnings:[],handNote:'最近已存觀察。',publicNote:'公開使用為累計次數。',...extra});
function harness(options={}) {
  const dom=documentHarness(),bound=[],cards=[],managed=[];
  const api=ui.create({document:dom.doc,onCardControl:(button,code)=>cards.push({button,code}),
    onBindDeck:async payload=>{bound.push(structuredClone(payload));return options.bind?options.bind(payload):{ok:true};},
    onManage:async()=>{managed.push(true);return options.manage?options.manage():{ok:true};}});
  dom.doc.body.append(api.element);api.update(options.model||model());
  return {...dom,api,bound,cards,managed,
    select:async value=>{const control=dom.role('tracker-deck-select');control.value=value;await control.dispatch('change');},
    submit:()=>dom.findAll(node=>node.tagName==='FORM',api.element)[0].dispatch('submit')};
}
function deferred() { let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }

test('UMD creates no network or Chrome dependency and requires an explicit document',()=>{
  const realm=vm.createContext({fetch(){throw new Error('Network forbidden');}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/deck-tracker-ui.js'),'utf8'),realm);
  assert.equal(typeof realm.MSADeckTrackerUI.create,'function');
  assert.throws(()=>ui.create(),/document/); assert.throws(()=>realm.MSADeckTrackerUI.create({}),/document/);
});

test('deck rows distinguish exact zero, partial lower bounds and unknown without subtracting public uses',()=>{
  const h=harness({model:model({rows:[row('GD99-001',{handCount:0,publicUseCount:7}),row('GD99-002',{handCount:2,handCountKind:'at-least'}),
    row('GD99-003',{handCount:null,handCountKind:'unknown'}),row('GD99-004',{deckCount:null,handCount:1,outsideDeck:true})]})});
  const rows=h.findAll(node=>node.dataset.role==='tracker-card-row');
  const value=(index,column)=>rows[index].children.find(node=>node.dataset.column===column).textContent;
  assert.equal(value(0,'hand'),'0');assert.equal(value(0,'public'),'7');assert.equal(value(0,'deck'),'4');
  assert.equal(value(1,'hand'),'≥2');assert.equal(value(2,'hand'),'?');assert.equal(value(3,'deck'),'—');
  assert.match(h.role('tracker-deck-meta').textContent,/主牌 50 張/);
  assert.match(h.role('tracker-audit').textContent,/不表示精確剩餘牌庫/);
});

test('literal card names and player data stay text; invalid card strings cannot become preview controls',()=>{
  const label='<img src=x onerror=alert(1)>',h=harness({model:model({playerName:label,deck:{...deck,name:label},rows:[row('GD99-001',{name:label}),row('https://evil.test/GD99-002')]})});
  assert.equal(h.role('tracker-deck-name').textContent,label);
  const controls=h.findAll(node=>node.dataset.role==='tracker-card-control');assert.equal(controls.length,1);
  assert.match(controls[0].textContent,/<img src=x/);assert.deepEqual(h.cards.map(item=>item.code),['GD99-001']);
  assert.equal(h.findAll(node=>node.tagName==='IMG').length,0);
});

test('manual binding needs a valid selection and sends only an explicit confirmed version',async()=>{
  const h=harness({model:model({state:'unbound',deck:null})});
  assert.equal(h.role('tracker-binding').open,true);assert.equal(h.role('tracker-bind').disabled,true);
  await h.submit();assert.equal(h.bound.length,0);
  await h.select('deck-synthetic.v-2');assert.equal(h.role('tracker-bind').disabled,false);assert.equal(h.bound.length,0);
  await h.submit();assert.deepEqual(h.bound,[{deckVersionId:'deck-synthetic.v-2',confirmed:true}]);
  assert.match(h.role('tracker-status').textContent,/本場牌組已綁定/);
  assert.match(h.role('tracker-status').textContent,/勝負|結果/);
});

test('model refresh preserves an unsubmitted selection, focus and scroll, without repeated card hooks',async()=>{
  const h=harness({model:model({state:'unbound',deck:null})});
  await h.select('deck-synthetic.v-2');const select=h.role('tracker-deck-select');select.focus();h.api.element.scrollTop=156;
  const original=h.role('tracker-card-row');original.children[0].focus();
  h.api.update(model({state:'unbound',deck:null,rows:[row('GD99-002'),row('GD99-001',{handCount:3,publicUseCount:2})]}));
  assert.equal(select.value,'deck-synthetic.v-2');assert.equal(h.doc.activeElement,original.children[0]);assert.equal(h.api.element.scrollTop,156);
  assert.equal(h.cards.length,2);assert.equal(h.findAll(node=>node.dataset.role==='tracker-card-row')[1],original);
});

test('failed or missing binding acknowledgement keeps the selected draft and allows retry',async()=>{
  const h=harness({bind:async()=>({ok:false,reason:'Synthetic storage failure'}),model:model({state:'unbound',deck:null})});
  await h.select('deck-synthetic.v-2');await h.submit();
  assert.equal(h.role('tracker-deck-select').value,'deck-synthetic.v-2');assert.equal(h.role('tracker-bind').disabled,false);
  assert.match(h.role('tracker-status').textContent,/Synthetic storage failure/);
  assert.equal(h.role('tracker-status').className.includes('error'),true);assert.doesNotMatch(h.role('tracker-status').textContent,/已綁定/);
});

test('pending binding disables duplicate submit and a new match discards its late acknowledgement',async()=>{
  const gate=deferred(),h=harness({bind:()=>gate.promise,model:model({state:'unbound',deck:null})});
  await h.select('deck-synthetic.v-1');const pending=h.submit();
  assert.equal(h.role('tracker-bind').disabled,true);await h.submit();assert.equal(h.bound.length,1);
  h.api.update(model({contextKey:'another-game.run-a',gameId:'another-game',sessionId:'another-game.run-a',state:'unbound',deck:null,playerName:'Demo South'}));
  assert.equal(h.role('tracker-deck-select').value,'');gate.resolve({ok:true});await pending;
  assert.equal(h.role('tracker-status').textContent,'');assert.equal(h.role('tracker-status').hidden,true);
});

test('same-match pending refresh keeps its busy state and successful response',async()=>{
  const gate=deferred(),h=harness({bind:()=>gate.promise,model:model({state:'unbound',deck:null})});
  await h.select('deck-synthetic.v-1');const pending=h.submit();h.api.update(model({state:'unbound',deck:null}));
  assert.equal(h.role('tracker-bind').disabled,true);assert.equal(h.role('tracker-deck-select').value,'deck-synthetic.v-1');
  gate.resolve({ok:true});await pending;assert.match(h.role('tracker-status').textContent,/已綁定/);
});

test('a player change in the same run clears selection and cannot display the previous player acknowledgement',async()=>{
  const gate=deferred(),h=harness({bind:()=>gate.promise,model:model({state:'unbound',deck:null})});
  await h.select('deck-synthetic.v-1');const pending=h.submit();
  h.api.update(model({state:'unbound',deck:null,playerName:'Demo South'}));
  assert.equal(h.role('tracker-deck-select').value,'');
  gate.resolve({ok:true});await pending;
  assert.equal(h.role('tracker-status').hidden,true);assert.doesNotMatch(h.role('tracker-status').textContent,/已綁定/);
});

test('unknown identity or unavailable stored source cannot submit a deck binding',async()=>{
  const h=harness({model:model({state:'identity-unknown',canBind:false,playerName:'',deck:null,rows:[],stateDetail:'尚未確認本人來源。'})});
  assert.equal(h.role('tracker-binding').hidden,true);assert.equal(h.role('tracker-bind').disabled,true);
  await h.select('deck-synthetic.v-1');await h.submit();assert.equal(h.bound.length,0);
  assert.match(h.role('tracker-state').textContent,/尚未確認/);
  h.api.update(model({state:'invalid',canBind:false,deck:null,rows:[],stateDetail:'找不到已存本人段落。'}));
  await h.submit();assert.equal(h.bound.length,0);assert.match(h.role('tracker-empty').textContent,/待核對/);
});

test('public users, unknown actors and token generation have separate cumulative groups',()=>{
  const publicCards={own:[{cardCode:'GD99-001',name:'Synthetic Unit',actor:'Demo North',count:6}],
    opponent:[{cardCode:'GD99-002',actor:'Demo South',count:3}],unknown:[{cardCode:'GD99-003',actor:'',count:1}],
    tokens:[{cardCode:'T-001',actor:'Demo South',count:4}]};
  const h=harness({model:model({publicCards})});const own=h.role('tracker-public-own');own.open=true;
  assert.match(own.textContent,/6 次/);assert.match(h.role('tracker-public-opponent').textContent,/Demo South/);
  assert.match(h.role('tracker-public-unknown').textContent,/待核對/);assert.match(h.role('tracker-public-tokens').textContent,/4 次生成/);
  assert.match(h.role('tracker-public-tokens').textContent,/不計手牌出牌/);
  h.api.update(model({publicCards:{...publicCards,own:[{...publicCards.own[0],count:7}]}}));
  assert.equal(own.open,true);assert.match(own.textContent,/7 次/);assert.equal(h.cards.length,6);
});

test('unknown public card identities and tokens retain names and counts without borrowing unrelated lookup targets',()=>{
  const h=harness({model:model({rows:[],publicCards:{own:[],opponent:[],tokens:[{cardCode:null,name:'Unidentified token',actor:'',count:2}],unknown:[
    {cardCode:null,name:'Unidentified Alpha',actor:'Demo South',count:2,targetCard:{cardCode:'GD99-001'}},
    {cardCode:null,name:'Unidentified Beta',actor:'Demo South',count:1},
    {cardCode:null,name:'',actor:'',count:3}]}})});
  const section=h.role('tracker-public-unknown');assert.match(section.textContent,/6 次/);
  assert.match(section.textContent,/Unidentified Alpha/);assert.match(section.textContent,/Unidentified Beta/);
  assert.equal(h.findAll(node=>node.dataset.role==='tracker-unknown-card').length,4);
  assert.equal(h.cards.length,0);assert.equal(h.findAll(node=>node.dataset.role==='tracker-public-row').length,4);
  assert.match(h.role('tracker-public-tokens').textContent,/2 次生成/);
  assert.match(h.role('tracker-public-tokens').textContent,/Unidentified token/);
});

test('an unassigned public actor can still preview its own explicitly known primary card',()=>{
  const h=harness({model:model({rows:[],publicCards:{own:[],opponent:[],tokens:[],unknown:[
    {cardCode:'GD99-010',name:'Known Synthetic Primary',actor:'',count:2,targetCard:{cardCode:'GD99-001'}}]}})});
  assert.deepEqual(h.cards.map(item=>item.code),['GD99-010']);
  assert.equal(h.findAll(node=>node.dataset.role==='tracker-unknown-card').length,0);
  assert.match(h.role('tracker-public-unknown').textContent,/2 次/);
});

test('version statistics show confirmed sample size, concede as loss and no invented zero-sample rate',()=>{
  const h=harness();assert.equal(h.role('tracker-win-rate').textContent,'—');
  h.api.update(model({stats:{confirmed:5,wins:2,losses:1,draws:1,concedes:1,winRate:.4}}));
  assert.equal(h.role('tracker-win-rate').textContent,'40.0%');
  assert.match(h.role('tracker-stats').textContent,/5 場 · 2 勝／2 負／1 和/);assert.match(h.role('tracker-stats').textContent,/本人投降 1/);
  h.api.update(model({state:'unbound',deck:null}));assert.equal(h.role('tracker-stats').hidden,true);
});

test('removed selected version is cleared explicitly and cannot be submitted from an older draft',async()=>{
  const h=harness({model:model({state:'unbound',deck:null})});await h.select('deck-synthetic.v-2');
  h.api.update(model({state:'unbound',deck:null,availableDecks:[deck]}));
  assert.equal(h.role('tracker-deck-select').value,'');assert.match(h.role('tracker-status').textContent,/不在可選清單/);
  await h.submit();assert.equal(h.bound.length,0);
});

test('management failures are visible and destroy invalidates in-flight responses and future actions',async()=>{
  const h=harness({manage:async()=>({ok:false,reason:'Synthetic open failure'})});await h.role('tracker-manage').dispatch('click');
  assert.match(h.role('tracker-status').textContent,/Synthetic open failure/);assert.equal(h.role('tracker-manage').disabled,false);
  const gate=deferred(),late=harness({bind:()=>gate.promise,model:model({state:'unbound',deck:null})});
  await late.select('deck-synthetic.v-1');const pending=late.submit(),status=late.role('tracker-status');late.api.destroy();
  gate.resolve({ok:true});await pending;assert.equal(late.api.element.isConnected,false);assert.doesNotMatch(status.textContent,/已綁定/);
  await late.submit();assert.equal(late.bound.length,1);late.api.update(model());assert.equal(late.api.element.isConnected,false);
});
