'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../extension'),code=fs.readFileSync(path.join(root,'i18n.js'),'utf8'),data=fs.readFileSync(path.join(root,'i18n-data.js'),'utf8');
const en=require('../extension/locales/en.json'),cn=require('../extension/locales/zh-CN.json');
function sharedStorage(initial={},options={}) {
  const values=structuredClone(initial),listeners=new Set(),writes=[];
  const storage={local:{async get(key){return options.get?options.get(key,values):{[key]:values[key]};},async set(patch){if(options.fail)throw Error('quota');writes.push(structuredClone(patch));const changes={};for(const[key,value]of Object.entries(patch)){changes[key]={oldValue:values[key],newValue:value};values[key]=value;}for(const listener of [...listeners])listener(changes,'local');}},onChanged:{addListener(fn){listeners.add(fn);}}};
  return {storage,values,writes,emit(changes,area='local'){for(const listener of listeners)listener(changes,area);}};
}
function realm(shared=sharedStorage(),languages=['zh-TW']) {
  const context=vm.createContext({chrome:{storage:shared.storage},navigator:{languages},console});vm.runInContext(data,context);vm.runInContext(code,context);return {context,api:context.MSAI18n,...shared};
}
test('all catalog translations preserve every interpolation and native metadata is valid',()=>{
  assert.deepEqual(Object.keys(en).sort(),Object.keys(cn).sort());assert.ok(Object.keys(en).length>1000);
  for(const[source,english]of Object.entries(en))for(const translated of [english,cn[source]]){
    assert.ok(translated.trim(),source);assert.deepEqual((translated.match(/\{\d+\}/g)||[]).sort(),(source.match(/\{\d+\}/g)||[]).sort(),source);
  }
  for(const[source,value]of Object.entries(en))assert.doesNotMatch(value,/[\u3400-\u9fff]/,source);
  const manifest=require('../extension/manifest.json');assert.equal(manifest.default_locale,'zh_TW');
  for(const locale of ['zh_TW','zh_CN','en']){const messages=require('../extension/_locales/'+locale+'/messages.json');assert.ok(messages.extensionName.message);assert.ok(messages.extensionDescription.message);}
  assert.deepEqual(manifest.permissions,['storage']);assert.deepEqual(manifest.host_permissions,['https://www.gundam-gcg.com/*']);
});
test('every authored UI literal and static HTML attribute has English and Simplified translations',()=>{
  const files=['popup.js','review.js','library.js','review-workspace.js','live-panel-ui.js','deck-tracker-ui.js','live-panel-core.js','diagnostics-core.js','storage-health.js','library-core.js','library-store.js','live-panel-controller.js'];
  for(const file of files){const source=fs.readFileSync(path.join(root,file),'utf8');for(const match of source.matchAll(/l10n\((('(?:\\.|[^'\\])*')|("(?:\\.|[^"\\])*"))/g)){
    const key=vm.runInNewContext(match[1]);if(/[\u3400-\u9fff]/.test(key)){assert.ok(Object.hasOwn(en,key),file+': '+key);assert.ok(Object.hasOwn(cn,key),file+': '+key);}
  }}
  const decode=value=>value.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  for(const file of ['popup.html','review.html','library.html'])for(const match of fs.readFileSync(path.join(root,file),'utf8').matchAll(/data-i18n(?:-(?:title|placeholder|aria-label))?="([^"]+)"/g))assert.ok(Object.hasOwn(en,decode(match[1])),file+': '+match[1]);
});
test('browser defaults distinguish Traditional, Simplified and English with a deterministic fallback',()=>{
  const {api}=realm();for(const[inputs,result]of [[['zh-TW'],'zh-TW'],[['zh-Hant-HK'],'zh-TW'],[['zh-CN'],'zh-CN'],[['zh-Hans'],'zh-CN'],[['zh_SG'],'zh-CN'],[['en-US'],'en'],[['fr','en-GB'],'en'],[['de-DE'],'en']])assert.equal(api.detect(inputs),result);
});
test('saved choice takes priority over the browser language, persists and synchronizes open contexts',async()=>{
  const shared=sharedStorage({'msa.language':'zh-TW'}),a=realm(shared,['en-US']),b=realm(shared,['zh-CN']);await Promise.all([a.api.ready(),b.api.ready()]);
  assert.equal(a.api.language,'zh-TW');assert.equal(b.api.language,'zh-TW');let renders=0;const unsubscribe=b.api.subscribe(()=>renders++);
  await a.api.setLanguage('en');assert.equal(b.api.language,'en');assert.equal(b.api.t('對局回顧'),'Match review');assert.equal(renders,1);
  unsubscribe();await a.api.setLanguage('zh-CN');assert.equal(b.api.t('對局回顧'),'对局回顾');assert.equal(renders,1);
  const reopened=realm(shared,['en']);await reopened.api.ready();assert.equal(reopened.api.language,'zh-CN');
});
test('a language change writes only its own preference; original names, notes and Log remain byte-for-byte unchanged',async()=>{
  const record={playerName:'未知',note:'繁體中文原文 <script>',rawText:'部署機體',hand:[{cardCode:'GD01-001',count:2}]};const shared=sharedStorage({'msa.session.fixture':record,'msa.settings':{enabled:true,playerName:'資料與牌組'}}),before=JSON.stringify(shared.values);
  const {api}=realm(shared);await api.ready();await api.setLanguage('en');
  assert.deepEqual(shared.writes,[{'msa.language':'en'}]);delete shared.values['msa.language'];assert.equal(JSON.stringify(shared.values),before);assert.equal(api.t('Custom name 自訂'),'Custom name 自訂');
});
test('failed preference saves leave the current language unchanged and unsupported choices never write',async()=>{
  const h=realm(sharedStorage({'msa.language':'zh-TW'},{fail:true}));await h.api.ready();await assert.rejects(h.api.setLanguage('en'),/quota/);assert.equal(h.api.language,'zh-TW');await assert.rejects(h.api.setLanguage('fr'),/Unsupported/);assert.equal(h.writes.length,0);
});
test('storage initialization cannot overwrite a newer change with a delayed saved preference',async()=>{
  let resolve;const shared=sharedStorage({},{get:()=>new Promise(done=>resolve=done)}),h=realm(shared,['en']);const ready=h.api.ready();await Promise.resolve();shared.emit({'msa.language':{newValue:'zh-CN'}});resolve({'msa.language':'zh-TW'});await ready;assert.equal(h.api.language,'zh-CN');
});
test('local storage errors and invalid preferences keep a usable browser-language fallback',async()=>{
  const h=realm(sharedStorage({},{get:()=>Promise.reject(Error('offline'))}),['en']);await h.api.ready();assert.equal(h.api.t('對局回顧'),'Match review');
  h.emit({'msa.language':{newValue:'fr'}});assert.equal(h.api.language,'en');h.emit({'msa.language':{newValue:'zh-CN'}},'sync');assert.equal(h.api.language,'en');
});
test('template interpolation preserves arbitrary player text and raw syntax literally',async()=>{
  const {api}=realm();await api.ready();await api.setLanguage('en');const player='未知 {1} <script> & 简体';assert.equal(api.t('{0} 的對局記錄',player),player+'’s match record');assert.equal(api.t('第 {0} 回合',12),'Turn 12');assert.equal(api.cardLocale,'en');await api.setLanguage('zh-CN');assert.equal(api.cardLocale,'zh-tw');
});
test('recorder-authored messages can be rendered after switching back from a previous language',async()=>{
  const {api}=realm();await api.ready();await api.setLanguage('en');const text=api.message('主牌組共 48 張，需要 50 張。');assert.equal(text,'Main deck has 48 cards; 50 are required.');await api.setLanguage('zh-CN');assert.equal(api.message(text),'主牌组共 48 张，需要 50 张。');assert.equal(api.message('Raw Battle Log xyz'),'Raw Battle Log xyz');
});
test('static translation changes labels and document language without overwriting busy text or user inputs',async()=>{
  const {api}=realm();await api.ready();function node(source){const attributes={'data-i18n':source};return {textContent:source,value:'玩家原文',getAttribute:name=>Object.hasOwn(attributes,name)?attributes[name]:null,setAttribute(name,value){attributes[name]=value;}};}
  const label=node('對局回顧'),busy=node('讀取中…'),scope={nodeType:9,documentElement:{lang:'zh-Hant'},querySelectorAll:()=>[label,busy]};api.applyStatic(scope);busy.textContent='Working on a specific task';await api.setLanguage('en');api.applyStatic(scope);assert.equal(label.textContent,'Match review');assert.equal(label.value,'玩家原文');assert.equal(busy.textContent,'Working on a specific task');assert.equal(scope.documentElement.lang,'en');
});
