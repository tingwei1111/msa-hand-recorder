(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MSACaptureCoordinator = api;
})(globalThis, function () {
  'use strict';
  function withTimeout(promise, milliseconds, code = 'timeout') {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds);
    })]).finally(() => clearTimeout(timer));
  }
  function createWriteQueue(options) {
    const jobs = [], quarantined = [], durability = new Map();
    let running = null, scheduled = null, lastError = '', nextRetryAt = 0, rejectedCount = 0, suspended = false;
    const state = () => {
      const records=[...durability.values()];
      return {pendingCount:jobs.length,quarantinedCount:quarantined.length,lastError,rejectedCount,suspended,
        recovery:{durableCount:records.filter(item=>item.durable).length,pendingCount:records.filter(item=>!item.settled).length,
          unprotectedCount:records.filter(item=>item.settled&&!item.durable).length,error:records.find(item=>item.error)?.error||''}};
    };
    function notifyRecovery(){try{options.onRecovery?.(state().recovery);}catch(_){}}
    function stage(payload){
      if(!options.persist)return;
      const status={durable:false,settled:false,error:'',promise:null};durability.set(payload,status);
      status.promise=Promise.resolve().then(()=>options.persist(payload)).then(result=>{
        if(!result?.durable)throw new Error(result?.error||'recovery-unconfirmed');
        status.durable=true;
      }).catch(error=>{status.error=String(error.message||error);}).finally(()=>{status.settled=true;notifyRecovery();});
    }
    function schedule(){
      if(!options.writeBatch||!options.batchDelayMs){void pump();return;}
      if(!scheduled&&!running)scheduled=setTimeout(()=>{scheduled=null;void pump();},options.batchDelayMs);
    }
    function takeBatch(){
      if(!options.writeBatch)return jobs.slice(0,1);
      const batch=[];let bytes=0;
      for(const payload of jobs.slice(0,options.maxBatch||16)){
        const size=JSON.stringify(payload).length;
        if(batch.length&&bytes+size>(options.maxBatchBytes||512*1024))break;
        batch.push(payload);bytes+=size;
      }
      return batch;
    }
    function pump(force = false) {
      if(force&&scheduled){clearTimeout(scheduled);scheduled=null;}
      if (running) return running;
      if (suspended || !jobs.length || (!force && Date.now() < nextRetryAt)) return Promise.resolve();
      running = (async () => {
        while (jobs.length && !suspended) {
          const batch=takeBatch();
          try {
            // Do not time out the write itself: retrying an unresolved write can
            // append it twice. Only callers' waits have a time limit.
            if(options.persist)await Promise.all(batch.map(payload=>durability.get(payload)?.promise));
            // A navigation while journaling revokes the regular write. Its
            // durable original remains available for an explicit rescue export.
            if(suspended)break;
            const response=options.writeBatch?await options.writeBatch(batch):{results:[await options.write(batch[0])]};
            const results=response?.results;
            if(!Array.isArray(results)||results.length!==batch.length)throw new Error(response?.error||'invalid-write-acknowledgement');
            for(let index=0;index<batch.length;index++){
            const payload=batch[index],result=results[index];
            if (result?.ok === false && result.retryable === false) {
              // Preserve the rejected original, but do not let a permanently
              // invalid Log block valid hand observations behind it.
              const item = {payload,error:String(result.error || 'record-rejected'),code:result.code || 'record-rejected',quarantinedAt:new Date().toISOString()};
              quarantined.push(item); jobs.shift(); lastError = ''; nextRetryAt = 0;
              try { options.onQuarantine?.(payload, item); } catch (_) {}
              continue;
            }
            if (!result?.ok || result.paused) throw new Error(result?.error || (result?.paused ? 'recording-paused' : 'write-failed'));
            jobs.shift();durability.delete(payload); lastError = ''; nextRetryAt = 0;
            try { options.onResult?.(payload, result); } catch (_) {}
            }
          } catch (error) {
            lastError = String(error.message || error); nextRetryAt = Date.now() + (options.retryDelayMs || 2000);
            try { options.onError?.(jobs[0]||batch[0], error); } catch (_) {}
            break;
          }
        }
      })().finally(() => { running = null; });
      return running;
    }
    return Object.freeze({
      enqueue(payload) {
        if (suspended || jobs.length + quarantined.length >= (options.maxPending || 512)) {
          rejectedCount += 1;
          return {accepted:false, reason:'buffer-full', ...state()};
        }
        const original=JSON.parse(JSON.stringify(payload));jobs.push(original);stage(original);
        schedule(); return {accepted:true, ...state()};
      },
      retry: () => pump(), state,
      rescue: () => JSON.parse(JSON.stringify({pending:jobs,quarantined,recovery:state().recovery})),
      suspend(reason) { suspended = true;if(scheduled){clearTimeout(scheduled);scheduled=null;}lastError = reason || 'context-changed'; return state(); },
      async flush(milliseconds = 9000) {
        try { await withTimeout(pump(true), milliseconds, 'storage-timeout'); }
        catch (error) { return {ok:false, ...state(), error:String(error.message || error)}; }
        return {ok:jobs.length === 0, ...state()};
      }
    });
  }
  return Object.freeze({withTimeout, createWriteQueue});
});
