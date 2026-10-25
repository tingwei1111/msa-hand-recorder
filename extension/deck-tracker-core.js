(function(root,factory){
  'use strict';
  const common=typeof module==='object'&&module.exports;
  const api=factory(root,common);
  if(common)module.exports=api;
  if(root)root.MSADeckTrackerCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root,common){
  'use strict';
  const listeners=new Set();
  const wire=common?require('./deck-tracker-wire.js'):root.MSADeckTrackerWire;
  let state='loading',failure='',wasm;
  function engineStatus(){return {engine:'rust-wasm',state,...(failure?{reason:failure}:{})};}
  function changed(){for(const listener of listeners){try{listener(engineStatus());}catch(_){/* A view cannot prevent other subscribers from updating. */}}}
  function initialize(bytes,bindings){
    if(!wire||!bindings?.initSync)throw new Error('Rust/Wasm 載入模組不完整，請更新後重新整理 MSA。');
    bindings.initSync(bytes);
    if(typeof bindings.project_wire_json!=='function')throw new Error('Rust/Wasm 介面版本不符。');
    wasm=bindings;state='ready';failure='';changed();
  }
  function failed(error){state='error';failure=String(error?.message||error);changed();throw error;}
  let initialization;
  if(common){
    try{
      const fs=require('node:fs'),path=require('node:path');
      const bytes=fs.readFileSync(path.join(__dirname,'wasm/deck_tracker_bg.wasm'));
      initialize(bytes,require('./wasm/deck_tracker.js'));initialization=Promise.resolve();
    }catch(error){state='error';failure=String(error?.message||error);initialization=Promise.reject(error);}
  }else{
    const script=root.document?.currentScript?.src;
    initialization=(async()=>{
      const url=typeof root.chrome?.runtime?.getURL==='function'?root.chrome.runtime.getURL('wasm/deck_tracker_bg.wasm'):
        script?new URL('wasm/deck_tracker_bg.wasm',script).href:null;
      if(!url)throw new Error('找不到已打包的 Rust/Wasm 核心。');
      const response=await root.fetch(url,{credentials:'omit',cache:'no-store'});
      if(!response.ok)throw new Error('Rust/Wasm 核心無法載入，請重新載入擴充功能後重整 MSA。');
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>4*1024*1024)throw new Error('Rust/Wasm 核心檔案超過預期大小。');
      initialize(bytes,root.MSADeckTrackerWasm);
    })().catch(failed);
  }
  initialization.catch(()=>{});
  function project(input={}){
    if(state!=='ready')throw new Error(state==='loading'?'牌組核心載入中。':failure||'牌組核心無法使用。');
    if(input===null)throw new TypeError('牌組投影輸入不可為 null。');
    return wire.decode(JSON.parse(wasm.project_wire_json(JSON.stringify(wire.encode(wire.projectionInput(input))))));
  }
  function subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('Engine listener must be a function');
    listeners.add(listener);return ()=>listeners.delete(listener);
  }
  return Object.freeze({project,ready:()=>initialization,engineStatus,subscribe});
});
