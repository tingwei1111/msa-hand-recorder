(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MSADiagnosticsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function signature(snapshot){
    if(!snapshot)return '';
    return JSON.stringify({hand:snapshot.hand||[],expectedCount:snapshot.expectedCount??null,
      unknownCount:snapshot.unknownCount??null,quality:snapshot.quality||'unavailable',
      turn:snapshot.turn??null,turnSource:snapshot.turnSource||'unknown',observedTurn:snapshot.observedTurn??null,
      activePlayer:snapshot.activePlayer||'',phase:snapshot.phase||'',resources:snapshot.resources||null,
      reason:snapshot.reason||''});
  }
  function alerts(state,now){
    now=Number.isFinite(now)?now:Date.now();state=state||{};
    if(state.enabled===false)return [];
    const result=[];
    const add=(code,level,title,detail,at)=>{
      const since=Number.isFinite(at)?at:now;
      if(state.dismissed?.[code]===since)return;
      result.push({code,level,title,detail,observedAt:since});
    };
    if(state.writeError){
      add('write-error','error','記錄尚未存妥','最近寫入失敗；小窗保留上次已存資料。請檢查儲存狀態，先備份已有對局。',state.writeErrorSince);
    }else if(state.changedAt&&state.observedSignature&&state.observedSignature!==state.savedSignature&&now-state.changedAt>=5000){
      add('save-stalled','warning','可見變化仍未確認存入','已觀察到手牌狀態改變，但五秒內尚未確認儲存成功；這不是完整收錄保證。',state.changedAt);
    }
    if(state.handExpected&&state.startedAt&&now-state.startedAt>=8000&&!state.snapshotCount&&!state.writeError){
      add('no-saved-hand','warning','尚無本段已存手牌','已看到本人手牌，但還沒有成功保存；請核對玩家與手牌位置，必要時重新整理 MSA。',state.startedAt);
    }
    if(state.endObservedAt&&now-state.endObservedAt>=5000&&!state.publicLogComplete&&(state.eventCount||state.snapshotCount)){
      add('end-log-incomplete','warning','賽後公開 Log 仍待確認','已看到結束畫面，已存公開 Log 尚未確認包含完整起尾。保持對局分頁開著，在安全時更新後再備份。',state.endObservedAt);
    }
    return result;
  }
  function report(input){
    input=input||{};const page=input.page;
    const checks=[];
    const add=(id,level,label,detail)=>checks.push({id,level,label,detail});
    if(!page?.connected){
      add('page','error','尚未連線到本場記錄器',input.reason||'請切到 MSA 對局分頁，更新擴充功能後重新整理該頁。');
    }else{
      const same=Boolean(input.extensionVersion&&page.version&&input.extensionVersion===page.version);
      add('version',same?'pass':'error','擴充功能與分頁版本',same?`兩端均為 v${page.version}`:`擴充功能 v${input.extensionVersion||'未知'}，分頁 v${page.version||'未知'}；請重新整理 MSA 分頁。`);
      add('settings',page.ready&&page.enabled?'pass':'warning','設定與記錄開關',!page.ready?'設定仍在載入。':page.enabled?'自動記錄已啟用；開關狀態不代表已存完整。':'目前已暫停新觀察。');
      add('identity',page.playerName?'pass':'warning','本人身分',page.playerName?`目前確認玩家：${page.playerName}`:'尚未確認本人身分，不借用其他玩家或舊段手牌。');
      if(page.storageCheck)add('storage',page.storageCheck==='verified'?'pass':page.storageCheck==='error'||page.storageCheck==='mismatch'?'error':'warning','本機存檔核對',
        page.storageCheck==='verified'?'已重新讀取與目前分頁來源相符的本段存檔。':page.storageCheck==='missing'?'目前段落尚無本機存檔，不能將分頁累計值視為已保存。':page.storageCheck==='mismatch'?'本段存檔與目前玩家或分頁來源不符，未採用其中的筆數。':'本機存檔讀取失敗，無法核對已存筆數。');
      add('write',page.writeError?'error':page.pendingCount?'warning':page.snapshotCount?'pass':'warning','本段手牌儲存',page.writeError?`最近寫入失敗：${page.writeError}`:page.pendingCount?`${page.pendingCount} 筆觀察待存；已存 ${page.snapshotCount||0} 筆。`:`已存 ${page.snapshotCount||0} 筆手牌觀察${page.lastSavedAt?'；最近成功 '+page.lastSavedAt:''}。`);
      add('quality',page.quality==='complete'?'pass':'warning','最近畫面辨識',page.quality==='complete'?'最近一次畫面辨識完整；仍需人工核對張數。':'目前畫面部分或無法辨識，不能當作空手。');
      add('log',page.publicLogComplete?'pass':'warning','公開 Battle Log',page.publicLogComplete?'已存公開 Log 已見起尾；不代表所有手牌時點均已記錄。':`已存 ${page.eventCount||0} 筆公開事件；起尾仍需核對。`);
    }
    return {schemaVersion:1,checkedAt:new Date().toISOString(),extensionVersion:input.extensionVersion||'',
      gameId:page?.gameId||null,checks,hasErrors:checks.some(c=>c.level==='error'),
      summary:'此自檢只確認版本、已存資料及可見狀態，不能證明整場沒有未觀察瞬間。'};
  }
  return {signature,alerts,report};
});
