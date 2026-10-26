'use strict';
// Deterministic IndexedDB API fixture. Writes commit only on transaction
// completion; an injected abort discards the entire transaction snapshot.
// This is not a replacement for a browser reload acceptance check.
function createIndexedDBFixture(){
  const databases=new Map();let abortNext=false,held=false,releaseCommit=null;
  const clone=value=>value===undefined?undefined:structuredClone(value);
  function database(name){
    const stores=new Map();let tail=Promise.resolve();const db={onversionchange:null,close(){},
      createObjectStore(store){stores.set(store,new Map());},
      transaction(names,mode){
        let snapshot,release;
        const starting=tail.then(()=>{snapshot=new Map(names.map(name=>[name,new Map([...stores.get(name)].map(([key,value])=>[key,clone(value)]))]));});
        tail=new Promise(resolve=>{release=resolve;});
        let pending=0,ended=false,completionScheduled=false;
        const tx={error:null,oncomplete:null,onabort:null,onerror:null,
          abort(){if(ended)return;ended=true;starting.then(()=>{release();queueMicrotask(()=>tx.onabort?.());});},
          objectStore(name){
            function request(operation){
              if(ended)throw new Error('transaction inactive');pending++;
              const req={result:undefined,error:null,onsuccess:null,onerror:null};
              starting.then(()=>queueMicrotask(()=>{
                if(ended)return;
                try{req.result=operation();req.onsuccess?.();}
                catch(error){req.error=tx.error=error;req.onerror?.();tx.onerror?.();tx.abort();}
                pending--;schedule();
              }));return req;
            }
            return {get:key=>request(()=>clone(snapshot.get(name).get(key))),getAll:()=>request(()=>[...snapshot.get(name).values()].map(clone)),
              put:(value,key)=>request(()=>{if(mode!=='readwrite')throw new Error('readonly');snapshot.get(name).set(key??value.key,clone(value));}),
              delete:key=>request(()=>snapshot.get(name).delete(key))};
          }};
        function finish(){
          if(ended||pending)return;
          if(abortNext){abortNext=false;tx.error=new Error('synthetic commit abort');tx.abort();return;}
          if(mode==='readwrite')for(const [key,value] of snapshot)stores.set(key,value);
          ended=true;release();tx.oncomplete?.();
        }
        function schedule(){if(ended||pending||completionScheduled)return;completionScheduled=true;
          setImmediate(()=>{completionScheduled=false;if(held)releaseCommit=finish;else finish();});}
        starting.then(schedule);return tx;
      }};
    databases.set(name,db);return db;
  }
  return {indexedDB:{open(name){const req={result:undefined,error:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
    queueMicrotask(()=>{const exists=databases.has(name);req.result=databases.get(name)||database(name);if(!exists)req.onupgradeneeded?.();req.onsuccess?.();});return req;}},
    abortNextCommit(){abortNext=true;},holdCommit(){held=true;},releaseCommit(){held=false;releaseCommit?.();releaseCommit=null;}};
}
module.exports={createIndexedDBFixture};
