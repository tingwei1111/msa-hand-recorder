(function(root,factory){
  'use strict';
  const common=typeof module==='object' && module.exports;
  const api=factory(common?require('./library-core.js'):root.MSALibraryCore);
  if(common) module.exports=api;
  if(root) root.MSALibraryStore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  function create({storage,withKeyLock=(_key,task)=>task()}){
    if(!storage || typeof storage.get!=='function' || typeof storage.set!=='function') throw new Error('需要本機儲存介面。');
    // The caller serializes these mutations with recorder writes in the
    // background queue. Chrome storage is not an atomic multi-key transaction.
    const read=()=>storage.get(null);
    async function capacity(){
      if(typeof storage.getBytesInUse!=='function')return null;
      try{return {used:await storage.getBytesInUse(null),limit:Number(storage.QUOTA_BYTES)||10485760};}catch(_){return null;}
    }
    async function previewImport({text,fileName}={}){
      const parsed=core.parseImport(text,{fileName}),plan=await core.planImport(await read(),parsed);
      const {writes,...preview}=plan;
      const usage=await capacity();
      if(usage){
        usage.projected=usage.used+plan.summary.estimatedWriteBytes;
        preview.warnings.push(`本機已用 ${(usage.used/1048576).toFixed(2)} MiB；匯入後預估 ${(usage.projected/1048576).toFixed(2)} / ${(usage.limit/1048576).toFixed(0)} MiB。`);
        if(usage.projected>usage.limit)preview.warnings.push('預估容量不足；請先備份及管理既有資料，現在不會開始匯入。');
      }
      return {ok:true,...preview,capacity:usage};
    }
    async function applyImport({text,fileName,previewToken,confirmed}={}){
      if(confirmed!==true || !previewToken) return {ok:false,code:'confirmation-required',error:'請先檢查匯入預覽並確認。'};
      const parsed=core.parseImport(text,{fileName}),plan=await core.planImport(await read(),parsed);
      if(plan.previewToken!==previewToken) return {ok:false,code:'preview-stale',error:'相關本機資料已變更，請重新預覽後確認。'};
      const usage=await capacity();
      if(usage && usage.used+plan.summary.estimatedWriteBytes>usage.limit)return {ok:false,code:'insufficient-capacity',error:'預估本機容量不足，尚未寫入任何匯入資料。請先下載完整備份並管理容量。'};
      const entries=Object.entries(plan.writes).sort(([a],[b])=>Number(b.startsWith('msa.import.'))-Number(a.startsWith('msa.import.')));
      const savedKeys=[],failedKeys=[],skippedKeys=plan.items.filter(item=>['identical','identical-copy'].includes(item.status)).map(item=>item.key);
      const importedAt=new Date().toISOString();
      for(let index=0;index<entries.length;index++){
        const [key,raw]=entries[index],value=copy(raw);
        if(key.startsWith('msa.import.') && value.importedAt===null) value.importedAt=importedAt;
        if(value.importProvenance?.importedAt===null) value.importProvenance.importedAt=importedAt;
        try{
          const outcome=await withKeyLock(key,async()=>{
            const current=await storage.get(key);
            if(current[key]!==undefined){
              if(core.equal(current[key],value)) return 'skipped';
              throw new Error('寫入前發現同名資料，已保留本機內容。');
            }
            await storage.set({[key]:value});
            const verified=await storage.get(key);
            if(!core.equal(verified[key],value)) throw new Error('寫入後核對未通過，請保留原檔。');
            return 'saved';
          });
          (outcome==='skipped'?skippedKeys:savedKeys).push(key);
        }catch(error){
          failedKeys.push({key,error:String(error?.message||error)});
          return {ok:false,partial:savedKeys.length>0,code:'write-incomplete',savedKeys,skippedKeys,failedKeys,
            remainingKeys:entries.slice(index+1).map(([name])=>name),error:'匯入未全部完成；既有記錄未覆蓋。請保留原檔並檢查容量後重試。'};
        }
      }
      return {ok:true,partial:false,savedKeys,skippedKeys,failedKeys,remainingKeys:[],summary:plan.summary};
    }
    async function saveDeck({draft}={}){
      core.guard(draft);
      const record=await core.createDeckVersion(draft),key='msa.deck.'+record.id;
      const existing=(await storage.get(key))[key];
      if(existing){
        const content=value=>({deckId:value.deckId,name:value.name,main:value.main,resources:value.resources,tokens:value.tokens});
        if(existing.contentHash!==record.contentHash || !core.equal(content(existing),content(record))) throw new Error('牌組版本 ID 衝突，未覆蓋既有版本。');
        return {ok:true,key,record:existing,existing:true};
      }
      await storage.set({[key]:record});
      const actual=(await storage.get(key))[key];
      if(!core.equal(actual,record)) throw new Error('牌組儲存後核對失敗。');
      return {ok:true,key,record,existing:false};
    }
    async function saveMatch({draft}={}){
      core.guard(draft);
      const values=await read();
      const source=values['msa.session.'+draft.sourceSessionId];
      if(!source || source.gameId!==draft.gameId || (source.playerName.trim() && source.playerName.trim()!==draft.playerName.trim())) throw new Error('對局來源或玩家身分不符，未儲存戰績。');
      const deck=draft.deckVersionId?values['msa.deck.'+draft.deckVersionId]:null;
      if(draft.deckVersionId && !deck) throw new Error('找不到選取的牌組版本。');
      const record=await core.createMatchRecord(draft,deck),key='msa.match.'+record.id;
      const prior=values[key];
      if(prior && (prior.gameId!==record.gameId || prior.playerName!==record.playerName)) throw new Error('戰績 ID 衝突，未覆蓋。');
      const next=prior?{...prior,...record}:record;
      await storage.set({[key]:next});
      if(!core.equal((await storage.get(key))[key],next)) throw new Error('戰績儲存後核對失敗。');
      return {ok:true,key,record:next};
    }
    async function createBackup(options={}){return {ok:true,backup:core.createBackup(await read(),options)};}
    return Object.freeze({read,previewImport,applyImport,saveDeck,saveMatch,createBackup});
  }
  return Object.freeze({create});
});
