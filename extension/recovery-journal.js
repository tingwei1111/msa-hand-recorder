(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MSARecoveryJournal=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const LIMITS=Object.freeze({bytes:16*1024*1024,entries:512,entryBytes:2*1024*1024});
  const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const byteLength=value=>new TextEncoder().encode(value).length;
  function keyFor(payload){
    if(!UUID.test(payload?.gameId||'')||!UUID.test(payload?.runId||'')||!Number.isSafeInteger(payload.sequence)||payload.sequence<1)
      throw new Error('recovery-invalid-identity');
    return payload.gameId+'.'+payload.runId+':'+payload.sequence;
  }
  function entryFor(payload,source,limits=LIMITS){
    const key=keyFor(payload);
    if(!['MSA_RECORD','MSA_LOG'].includes(payload.type)||!Number.isInteger(source?.tabId)||typeof source.documentId!=='string'||!source.documentId)
      throw new Error('recovery-invalid-source');
    const raw=JSON.stringify(payload),bytes=byteLength(raw)+byteLength(JSON.stringify(source))+key.length+256;
    if(bytes>limits.entryBytes)throw new Error('recovery-entry-too-large');
    return {key,gameId:payload.gameId,runId:payload.runId,sequence:payload.sequence,playerName:String(payload.playerName||''),
      payload:JSON.parse(raw),source:clone(source),bytes,stagedAt:new Date().toISOString(),state:'unconfirmed'};
  }
  function planPut(existing,usage,entry,limits=LIMITS){
    if(existing){
      if(JSON.stringify(existing.payload)!==JSON.stringify(entry.payload)||JSON.stringify(existing.source)!==JSON.stringify(entry.source))
        throw new Error('recovery-sequence-conflict');
      return {existing:true,usage};
    }
    const next={bytes:(usage?.bytes||0)+entry.bytes,entries:(usage?.entries||0)+1};
    if(next.bytes>limits.bytes||next.entries>limits.entries)throw new Error('recovery-journal-full');
    return {existing:false,usage:next};
  }
  // Resolution follows transaction.oncomplete, never just request.onsuccess.
  // A full journal fails visibly; it never evicts another match's evidence.
  function indexedDBBackend(indexedDB,limits=LIMITS,databaseName='msa-recovery-journal'){
    let opening;
    function open(){
      if(opening)return opening;
      opening=new Promise((resolve,reject)=>{
        if(!indexedDB){reject(new Error('recovery-unavailable'));return;}
        const request=indexedDB.open(databaseName,1);
        request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('records',{keyPath:'key'});db.createObjectStore('meta');};
        request.onerror=()=>reject(request.error||new Error('recovery-open-failed'));
        request.onblocked=()=>reject(new Error('recovery-open-blocked'));
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
      }).catch(error=>{opening=null;throw error;});
      return opening;
    }
    async function transaction(mode,work){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['records','meta'],mode),records=tx.objectStore('records'),meta=tx.objectStore('meta');
        let result,failure;
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(failure||tx.error||new Error('recovery-transaction-aborted'));
        tx.onerror=()=>{failure ||= tx.error;};
        const done=value=>{result=value;};
        const fail=error=>{failure=error;try{tx.abort();}catch(_){reject(error);}};
        try{work(records,meta,done,fail);}catch(error){fail(error);}
      });
    }
    return Object.freeze({
      put:entry=>transaction('readwrite',(records,meta,done,fail)=>{
        const previous=records.get(entry.key),usage=meta.get('usage');let waiting=2;
        const ready=()=>{if(--waiting)return;try{
          const plan=planPut(previous.result,usage.result,entry,limits);
          if(!plan.existing){records.put(entry);meta.put(plan.usage,'usage');}
          done({durable:true,key:entry.key,existing:plan.existing});
        }catch(error){fail(error);}};
        previous.onsuccess=ready;usage.onsuccess=ready;
      }),
      remove:keys=>transaction('readwrite',(records,meta,done)=>{
        const usage=meta.get('usage');usage.onsuccess=()=>{
          const next={bytes:usage.result?.bytes||0,entries:usage.result?.entries||0};let waiting=keys.length;
          if(!waiting){done();return;}
          keys.forEach(key=>{const request=records.get(key);request.onsuccess=()=>{
            if(request.result){next.bytes=Math.max(0,next.bytes-request.result.bytes);next.entries=Math.max(0,next.entries-1);records.delete(key);}
            if(!--waiting){meta.put(next,'usage');done();}
          };});
        };
      }),
      list:()=>transaction('readonly',(records,_meta,done)=>{const request=records.getAll();request.onsuccess=()=>done(request.result);})
    });
  }
  function create(options={}){
    const limits={...LIMITS,...options.limits},backend=options.backend||indexedDBBackend(options.indexedDB??globalThis.indexedDB,limits,options.databaseName);
    return Object.freeze({
      async stage(payload,source){return backend.put(entryFor(payload,source,limits));},
      async complete(payloads){const keys=[...new Set(payloads.filter(p=>p.sequence).map(keyFor))];if(keys.length)await backend.remove(keys);},
      async backup(){
        const entries=await backend.list();
        return {format:'msa-recovery-journal',schemaVersion:1,exportedAt:new Date().toISOString(),
          warning:'持久化救援原件尚未核對正規存檔，可能已經保存；不可自動重播或當作完整對局。',
          records:clone(entries).sort((a,b)=>a.gameId.localeCompare(b.gameId)||a.runId.localeCompare(b.runId)||a.sequence-b.sequence)};
      }
    });
  }
  return Object.freeze({LIMITS,keyFor,entryFor,planPut,indexedDBBackend,create});
});
