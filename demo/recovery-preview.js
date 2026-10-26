'use strict';
const synthetic={type:'MSA_RECORD',gameId:'00000000-0000-4000-8000-000000000911',runId:'10000000-0000-4000-8000-000000000911',
  sequence:1,playerName:'Synthetic Recovery Demo',snapshot:{timestamp:'2000-01-01T00:00:00Z',phase:'MAIN',hand:[{cardCode:'GD99-001',count:1}],quality:'complete'}};
const source={tabId:1,documentId:'synthetic-preview-document'};
const makeJournal=()=>MSARecoveryJournal.create({indexedDB,databaseName:'msa-recovery-preview'});
let journal=makeJournal();
const status=document.getElementById('status'),result=document.getElementById('result');
async function show(){const backup=await journal.backup();result.textContent=JSON.stringify(backup,null,2);return backup;}
async function action(fn){for(const button of document.querySelectorAll('button'))button.disabled=true;
  try{await fn();}catch(error){status.textContent='驗證失敗：'+String(error.message||error);}
  finally{for(const button of document.querySelectorAll('button'))button.disabled=false;}}
document.getElementById('stage').onclick=()=>action(async()=>{
  const saved=await journal.stage(synthetic,source);await show();
  status.textContent=saved.durable?'交易已完成：1 筆合成原件已持久化，可重新整理分頁後讀回。':'尚未確認持久化。';
});
document.getElementById('reopen').onclick=()=>action(async()=>{journal=makeJournal();const backup=await show();status.textContent='已重新建立連線；讀回 '+backup.records.length+' 筆合成原件。';});
document.getElementById('read').onclick=()=>action(async()=>{const backup=await show();status.textContent='已讀回 '+backup.records.length+' 筆持久化原件；未自動重播。';});
document.getElementById('reset').onclick=()=>action(async()=>{await journal.complete([synthetic]);await show();status.textContent='本頁合成原件已清除，沒有變更擴充功能資料。';});
action(async()=>{const backup=await show();status.textContent='分頁已載入；資料庫中有 '+backup.records.length+' 筆合成原件。';});
