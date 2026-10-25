(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MSAStorageHealth=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);

  async function measure(storage){
    if(typeof storage?.getBytesInUse!=='function')return {available:false};
    try{
      const used=await storage.getBytesInUse(null),limit=Number(storage.QUOTA_BYTES)||10485760;
      if(!Number.isFinite(used)||used<0)return {available:false};
      return {available:true,used,limit,ratio:used/limit,remaining:Math.max(0,limit-used),
        level:used/limit>=0.95?'error':used/limit>=0.8?'warning':'normal'};
    }catch(_){return {available:false};}
  }
  function render(doc,health){
    const container=doc.getElementById('storage-health');if(!container)return;
    const label=doc.getElementById('storage-label'),note=doc.getElementById('storage-note'),meter=doc.getElementById('storage-meter');
    container.dataset.level=health.available?health.level:'unknown';
    if(!health.available){label.textContent=l10n('暫時無法讀取容量');note.textContent=l10n('仍可下載完整備份。');meter.hidden=true;return;}
    meter.hidden=false;meter.max=health.limit;meter.value=health.used;
    label.textContent=`${(health.used/1048576).toFixed(2)} / ${(health.limit/1048576).toFixed(0)} MiB`;
    note.textContent=health.level==='error'?l10n('容量即將用盡，請先下載完整備份。'):health.level==='warning'?l10n('容量已超過 80%，建議先備份重要對局。'):l10n('對局保存在這個瀏覽器，建議定期備份。');
  }
  return Object.freeze({measure,render});
});
