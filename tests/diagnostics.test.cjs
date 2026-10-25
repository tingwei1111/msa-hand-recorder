'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const health=require('../extension/diagnostics-core.js');
test('health only alerts stalled observed writes, not an unchanged quiet turn',()=>{
 const base={enabled:true,startedAt:1000,snapshotCount:3,observedSignature:'A',savedSignature:'A',changedAt:1000};
 assert.deepEqual(health.alerts(base,100000),[]);
 assert.equal(health.alerts({...base,observedSignature:'B'},5000).length,0);
 assert.equal(health.alerts({...base,observedSignature:'B'},6001)[0].code,'save-stalled');
});
test('paused recorder does not repeatedly alert and acknowledgement is episode-specific',()=>{
 const error={enabled:true,writeError:'quota',writeErrorSince:1000,snapshotCount:1};
 assert.equal(health.alerts(error,2000)[0].level,'error');
 assert.equal(health.alerts({...error,enabled:false},2000).length,0);
 assert.equal(health.alerts({...error,dismissed:{'write-error':1000}},2000).length,0);
 assert.equal(health.alerts({...error,writeErrorSince:3000,dismissed:{'write-error':1000}},4000).length,1);
});
test('a match end with saved hands but zero public logs is flagged independently',()=>{
 assert.equal(health.alerts({enabled:true,endObservedAt:1000,snapshotCount:2,eventCount:0},7000)[0].code,'end-log-incomplete');
 assert.equal(health.alerts({enabled:true,endObservedAt:1000,snapshotCount:2,publicLogComplete:true},7000).length,0);
});
test('version diagnostics do not turn an enabled switch into capture completeness',()=>{
 const report=health.report({extensionVersion:'0.6.0',page:{connected:true,version:'0.5.0',ready:true,enabled:true,quality:'unavailable',snapshotCount:0,eventCount:0}});
 assert.equal(report.hasErrors,true);assert.equal(report.checks.find(c=>c.id==='version').level,'error');
 assert.equal(report.checks.find(c=>c.id==='write').level,'warning');
 assert.match(report.summary,/不能證明/);
 assert.equal(health.report({extensionVersion:'0.6.0',reason:'no receiver'}).checks[0].level,'error');
});
