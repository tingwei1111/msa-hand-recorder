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
    const jobs = [], quarantined = [];
    let running = null, lastError = '', nextRetryAt = 0, rejectedCount = 0, suspended = false;
    const state = () => ({pendingCount:jobs.length, quarantinedCount:quarantined.length, lastError, rejectedCount, suspended});
    function pump(force = false) {
      if (running) return running;
      if (suspended || !jobs.length || (!force && Date.now() < nextRetryAt)) return Promise.resolve();
      running = (async () => {
        while (jobs.length && !suspended) {
          const payload = jobs[0];
          try {
            // Do not time out the write itself: retrying an unresolved write can
            // append it twice. Only callers' waits have a time limit.
            const result = await options.write(payload);
            if (result?.ok === false && result.retryable === false) {
              // Preserve the rejected original, but do not let a permanently
              // invalid Log block valid hand observations behind it.
              const item = {payload,error:String(result.error || 'record-rejected'),code:result.code || 'record-rejected',quarantinedAt:new Date().toISOString()};
              quarantined.push(item); jobs.shift(); lastError = ''; nextRetryAt = 0;
              try { options.onQuarantine?.(payload, item); } catch (_) {}
              continue;
            }
            if (!result?.ok || result.paused) throw new Error(result?.error || (result?.paused ? 'recording-paused' : 'write-failed'));
            jobs.shift(); lastError = ''; nextRetryAt = 0;
            try { options.onResult?.(payload, result); } catch (_) {}
          } catch (error) {
            lastError = String(error.message || error); nextRetryAt = Date.now() + (options.retryDelayMs || 2000);
            try { options.onError?.(payload, error); } catch (_) {}
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
        jobs.push(JSON.parse(JSON.stringify(payload)));
        void pump(); return {accepted:true, ...state()};
      },
      retry: () => pump(), state,
      rescue: () => JSON.parse(JSON.stringify({pending:jobs,quarantined})),
      suspend(reason) { suspended = true; lastError = reason || 'context-changed'; return state(); },
      async flush(milliseconds = 9000) {
        try { await withTimeout(pump(true), milliseconds, 'storage-timeout'); }
        catch (error) { return {ok:false, ...state(), error:String(error.message || error)}; }
        return {ok:jobs.length === 0, ...state()};
      }
    });
  }
  return Object.freeze({withTimeout, createWriteQueue});
});
