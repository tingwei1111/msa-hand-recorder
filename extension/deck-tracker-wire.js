(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root){root.MSADeckTrackerWire=api;root.__MSADeckTrackerHost=api.host;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // This is an in-memory ABI, never a storage or backup format. UTF-16 units
  // preserve JavaScript strings even when slicing creates a lone surrogate.
  function units(value){const result=[];for(let i=0;i<value.length;i++)result.push(value.charCodeAt(i));return result;}
  function string(value){
    if(!Array.isArray(value)||value.some(unit=>!Number.isInteger(unit)||unit<0||unit>65535))throw new TypeError('Invalid UTF-16 wire string');
    let result='';for(let i=0;i<value.length;i+=8192)result+=String.fromCharCode(...value.slice(i,i+8192));return result;
  }
  function encode(value,ancestors=new Set(),budget={nodes:0},depth=0){
    if(++budget.nodes>2000000||depth>128)throw new RangeError('牌組投影資料結構過大或過深。');
    if(value===null)return {t:'null'};
    if(value===undefined)return {t:'undefined'};
    if(typeof value==='string')return {t:'string',v:units(value)};
    if(typeof value==='boolean')return {t:'bool',v:value};
    if(typeof value==='number')return Number.isNaN(value)?{t:'nan'}:value===Infinity?{t:'positive-infinity'}:value===-Infinity?{t:'negative-infinity'}:{t:'number',v:value};
    if(typeof value!=='object')throw new TypeError('牌組投影只接受可保存的資料欄位。');
    if(ancestors.has(value))throw new TypeError('牌組投影資料含循環參照。');
    ancestors.add(value);
    try{return Array.isArray(value)?{t:'array',v:Array.from(value,item=>encode(item,ancestors,budget,depth+1))}:
      {t:'object',v:Object.entries(value).map(([key,item])=>[units(key),encode(item,ancestors,budget,depth+1)])};}
    finally{ancestors.delete(value);}
  }
  function decode(value){
    if(!value||typeof value!=='object')throw new TypeError('Invalid projection wire value');
    switch(value.t){
      case 'null':return null;case 'undefined':return undefined;case 'nan':return NaN;
      case 'positive-infinity':return Infinity;case 'negative-infinity':return -Infinity;
      case 'string':return string(value.v);case 'number':return value.v;case 'bool':return value.v;
      case 'array':return value.v.map(decode);
      case 'object':{
        const result={};for(const [key,item]of value.v)Object.defineProperty(result,string(key),{value:decode(item),enumerable:true,writable:true,configurable:true});return result;
      }
      default:throw new TypeError('Unsupported projection wire tag');
    }
  }
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
  function fields(value,names){
    if(!object(value))return value;
    const result={};for(const name of names)if(name in value)result[name]=value[name];return result;
  }
  function rows(value,convert){return Array.isArray(value)?value.map(convert):value;}
  function deck(value){
    const result=fields(value,['schemaVersion','id','deckId','name','createdAt','main','resources','tokens']);
    if(object(result))for(const zone of ['main','resources','tokens'])if(zone in result)result[zone]=rows(result[zone],row=>fields(row,['cardCode','count','name']));
    return result;
  }
  function projectionInput(input){
    // Marshal only fields read by the Rust projection. Raw snapshots, public
    // text and import archives stay in storage; copying them into Wasm on each
    // UI update would increase latency without affecting the result.
    const result={};
    result.context=fields(input?.context,['gameId','runId','playerName']);
    if(object(input?.values)){
      result.values={};
      for(const [key,value]of Object.entries(input.values)){
        let item;
        if(key.startsWith('msa.deck.'))item=deck(value);
        else if(key.startsWith('msa.match.')){
          item=fields(value,['schemaVersion','id','gameId','playerName','source','identityConfirmed','updatedAt','deckVersionId','frozenDeckVersion','resultConfirmed','result']);
          if(object(item)&&'frozenDeckVersion'in item)item.frozenDeckVersion=deck(item.frozenDeckVersion);
        }else if(key.startsWith('msa.session.')){
          item=fields(value,['schemaVersion','id','gameId','playerName','snapshots']);
          if(object(item)&&'snapshots'in item)item.snapshots=rows(item.snapshots,row=>fields(row,['id']));
        }else continue;
        Object.defineProperty(result.values,key,{value:item,enumerable:true,writable:true,configurable:true});
      }
    }else result.values={};
    result.handModel=fields(input?.handModel,['sessionId','quality','latestSnapshot','handCards']);
    if(object(result.handModel)){
      if('latestSnapshot'in result.handModel)result.handModel.latestSnapshot=fields(result.handModel.latestSnapshot,['id','sourceSessionId','quality','unknownCount','expectedCount']);
      if('handCards'in result.handModel)result.handModel.handCards=rows(result.handModel.handCards,row=>fields(row,['cardCode','count']));
    }
    result.events=rows(input?.events,event=>{
      const row=fields(event,['action','isPlay','actor','primaryCard','sourceZone']);
      if(object(row)&&'primaryCard'in row)row.primaryCard=fields(row.primaryCard,['cardCode','name']);return row;
    });
    result.players=input?.players;
    result.coverage=fields(input?.coverage,['hasGaps','unmergedCaptureCount','publicLogComplete']);
    return result;
  }
  const host=Object.freeze({
    dateParse:json=>Date.parse(decode(JSON.parse(json))),
    compare:(left,right)=>Math.sign(string(JSON.parse(left)).localeCompare(string(JSON.parse(right)),'en')),
    uppercase:json=>JSON.stringify(units(string(JSON.parse(json)).toUpperCase()))
  });
  return Object.freeze({encode,decode,projectionInput,host});
});
