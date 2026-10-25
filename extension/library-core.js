(function(root,factory){
  'use strict';
  const common=typeof module==='object' && module.exports;
  const api=factory(common?require('node:crypto').webcrypto:root.crypto);
  if(common) module.exports=api;
  if(root) root.MSALibraryCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(crypto){
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);

  const FORMAT='msa-workspace-backup';
  const LIMITS=Object.freeze({bytes:20*1024*1024,depth:40,nodes:500000,records:5000,snapshots:50000,events:100000});
  const PREFIXES=['msa.session.','msa.deck.','msa.match.','msa.note.','msa.import.'];
  const RESULTS=['win','loss','draw','concede','unknown'];
  const ORDERS=['first','second','unknown'];
  const CODE=/^(?:(?:GD|ST|EB|SC|SLB)\d{2,3}|EXB|EXR|PR|P|R|T)-\d{3}$/;
  const object=value=>value && typeof value==='object' && !Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const str=value=>typeof value==='string'?value:'';
  const fail=message=>{throw new Error(message);};
  const timestamp=value=>typeof value==='string' && Number.isFinite(Date.parse(value))?value:new Date().toISOString();
  const allowedKey=key=>PREFIXES.some(prefix=>key.startsWith(prefix)) || key==='msa.annotations';
  function guard(value){
    let nodes=0;
    function visit(item,depth){
      if(++nodes>LIMITS.nodes || depth>LIMITS.depth) fail(l10n('資料結構過大或過深，未匯入。'));
      if(item===null || typeof item==='boolean' || typeof item==='string') return;
      if(typeof item==='number'){if(!Number.isFinite(item)) fail(l10n('資料含非有限數字。'));return;}
      if(!item || typeof item!=='object') fail(l10n('僅支援 JSON 資料。'));
      if(!Array.isArray(item) && ![Object.prototype,null].includes(Object.getPrototypeOf(item))) fail(l10n('資料必須是一般 JSON 物件。'));
      for(const key of Object.keys(item)){
        if(['__proto__','prototype','constructor'].includes(key)) fail(l10n('資料含不安全的物件欄位，未匯入。'));
        visit(item[key],depth+1);
      }
    }
    visit(value,0);return value;
  }
  function canonical(value){
    if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
    if(object(value)) return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  const equal=(a,b)=>canonical(a)===canonical(b);
  async function hash(value){
    const bytes=new TextEncoder().encode(canonical(value));
    if(!crypto?.subtle) fail(l10n('此環境無法建立資料識別碼。'));
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function identifier(value,label){
    if(typeof value!=='string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) fail(label+l10n('格式不正確。'));
  }
  function identity(record){
    identifier(record.gameId,l10n('對局 ID'));
    if(record.gameId.length>128) fail(l10n('對局 ID 過長。'));
    if(typeof record.playerName!=='string' || record.playerName.length>200) fail(l10n('玩家名稱格式不正確。'));
  }
  function cardRows(rows,label){
    if(!Array.isArray(rows) || rows.length>200) fail(label+l10n('資料過大或格式不正確。'));
    for(const card of rows) if(!object(card) || !CODE.test(card.cardCode) || !Number.isSafeInteger(card.count) || card.count<1 || card.count>100) fail(label+l10n('卡號或數量不正確。'));
  }
  function validateRecord(key,record){
    if(!allowedKey(key)) fail(l10n('包含不允許的資料鍵：')+key);
    if(!object(record)) fail(l10n('資料記錄必須是物件：')+key);
    if(key==='msa.annotations') return;
    if(record.schemaVersion!==1) fail(l10n('不支援的資料版本：')+key);
    identifier(record.id,l10n('記錄 ID'));
    const prefix=PREFIXES.find(value=>key.startsWith(value));
    if(key!==prefix+record.id) fail(l10n('資料鍵與記錄 ID 不符：')+key);
    if(prefix==='msa.session.'){
      identity(record);
      if(!Array.isArray(record.snapshots) || record.snapshots.length>LIMITS.snapshots) fail(l10n('手牌觀察筆數或格式不正確。'));
      for(const snapshot of record.snapshots){
        if(!object(snapshot) || !Array.isArray(snapshot.hand) || snapshot.hand.length>200) fail(l10n('手牌觀察格式不正確。'));
        for(const card of snapshot.hand) if(!object(card) || typeof card.cardCode!=='string' || card.cardCode.length>100 || !Number.isSafeInteger(card.count) || card.count<1 || card.count>100) fail(l10n('手牌卡號或數量不正確。'));
      }
      if(record.battleLog && (!object(record.battleLog) || !Array.isArray(record.battleLog.events) || record.battleLog.events.length>LIMITS.events)) fail(l10n('公開 Log 筆數或格式不正確。'));
    }else if(prefix==='msa.deck.'){
      identifier(record.deckId,l10n('牌組 ID'));
      if(typeof record.name!=='string' || record.name.length>120) fail(l10n('牌組名稱格式不正確。'));
      cardRows(record.main,l10n('主牌組'));cardRows(record.resources,l10n('資源'));cardRows(record.tokens,'Token');
      const mainCounts=new Map();
      for(const card of record.main) mainCounts.set(card.cardCode,(mainCounts.get(card.cardCode)||0)+card.count);
      if(record.main.reduce((sum,card)=>sum+card.count,0)!==50 || [...mainCounts.values()].some(count=>count>4) || record.main.some(card=>/^(R|EXR|EXB|T)-/.test(card.cardCode))) fail(l10n('牌組版本必須有 50 張主牌且同卡號不超過 4 張，資源與 Token 需另列。'));
    }else if(prefix==='msa.match.'){
      identity(record);
      if(!record.playerName.trim() || record.identityConfirmed!==true || record.source!=='manual') fail(l10n('戰績必須有人工確認的玩家身分。'));
      if(!RESULTS.includes(record.result) || !ORDERS.includes(record.firstPlayer) || typeof record.resultConfirmed!=='boolean') fail(l10n('戰績結果或先後手格式不正確。'));
    }else if(prefix==='msa.note.'){
      identity(record);
      if(typeof record.note!=='string' || record.note.length>20000) fail(l10n('註記內容格式不正確或過長。'));
    }else if(prefix==='msa.import.'){
      if(!object(record.sourceRecords) || Object.keys(record.sourceRecords).length>LIMITS.records) fail(l10n('匯入原件格式不正確。'));
      // Archives are data, never automatically applied as active records.
      for(const sourceKey of Object.keys(record.sourceRecords)) if(!allowedKey(sourceKey)) fail(l10n('匯入原件包含不允許的資料鍵。'));
    }
  }
  function validateRecords(records){
    if(!object(records) || Object.keys(records).length>LIMITS.records) fail(l10n('資料記錄筆數或格式不正確。'));
    guard(records);
    for(const [key,value] of Object.entries(records)) validateRecord(key,value);
    return records;
  }
  function workspace(values){
    const records={};
    for(const [key,value] of Object.entries(values||{})) if(allowedKey(key)) records[key]=clone(value);
    return validateRecords(records);
  }
  function createBackup(values,options={}){
    return {format:FORMAT,schemaVersion:1,exportedAt:timestamp(options.exportedAt),records:workspace(values)};
  }
  function createArchiveBackup(values,archive,options={}){
    const original=clone(archive.sourceRecords||{});
    for(const key of archive.importedArchiveKeys||[]) if(!Object.hasOwn(original,key) && values[key]) original[key]=clone(values[key]);
    return createBackup(original,options);
  }
  function jsonBlock(html,id,required){
    const matches=[],lower=html.toLowerCase();let cursor=0;
    // Advance once through each script. A repeated malformed '<script ' must
    // not make a global regex rescan the remaining file at every position.
    while(cursor<html.length){
      const start=lower.indexOf('<script',cursor);if(start<0)break;
      if(!/[\s/>]/.test(html[start+7]||'')){cursor=start+7;continue;}
      const openEnd=html.indexOf('>',start+7);
      if(openEnd<0 || openEnd-start>4096 || html.slice(start+7,openEnd).includes('<')) fail(l10n('HTML script 標籤不完整或過大。'));
      const close=lower.indexOf('</script',openEnd+1),closeEnd=close<0?-1:html.indexOf('>',close+8);
      if(close<0 || closeEnd<0 || !/^<\/script\s*>$/i.test(html.slice(close,closeEnd+1))) fail(l10n('HTML script 結束標籤不完整。'));
      const attributeText=html.slice(start+7,openEnd),body=html.slice(openEnd+1,close);cursor=closeEnd+1;
      const attrs={};
      for(const attr of attributeText.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)){
        const key=attr[1].toLowerCase();if(Object.hasOwn(attrs,key)) fail(l10n('HTML 含重複 script 屬性。'));
        attrs[key]=attr[2]??attr[3]??attr[4];
      }
      if(attrs.id===id){if(str(attrs.type).toLowerCase()!=='application/json') fail(l10n('HTML 資料區塊不是 application/json。'));matches.push(body);}
    }
    if(matches.length>1 || (required && matches.length!==1)) fail(l10n('HTML 必須含唯一的 ')+id+l10n(' JSON 區塊。'));
    if(!matches.length) return null;
    try{return guard(JSON.parse(matches[0]));}catch(error){fail(l10n('HTML 資料區塊無法解析：')+error.message);}
  }
  function recordsFrom(value){
    guard(value);
    if(value?.format===FORMAT){if(value.schemaVersion!==1) fail(l10n('不支援的備份版本。'));return validateRecords(value.records);}
    if(object(value) && value.schemaVersion===1 && typeof value.id==='string' && Array.isArray(value.snapshots)) return validateRecords({['msa.session.'+value.id]:value});
    fail(l10n('請選擇本工具的批次 JSON、單場 JSON 或獨立 HTML 報告。'));
  }
  function addWorkspaceRecords(records,extra){
    validateRecords(extra);
    for(const [key,value] of Object.entries(extra)){
      if(Object.hasOwn(records,key) && !equal(records[key],value)) fail(l10n('匯出資料區塊含同名衝突記錄。'));
      records[key]=clone(value);
    }
  }
  function expandCombinedSources(records,warnings){
    const authoritative=new Set(Object.keys(records));
    const visited=new Set();
    function expand(wrapper){
      if(wrapper.isCombined!==true || !Array.isArray(wrapper.sourceRecords)) return;
      if(visited.has(wrapper.id)) return;visited.add(wrapper.id);
      for(const raw of wrapper.sourceRecords){
        if(!object(raw) || typeof raw.id!=='string') fail(l10n('合併報告缺少完整來源記錄。'));
        const key='msa.session.'+raw.id;validateRecord(key,raw);
        const owner=str(wrapper.playerName).trim(),sourceOwner=raw.playerName.trim();
        if(raw.gameId!==wrapper.gameId || (sourceOwner && sourceOwner!==owner) || (raw.snapshots.length && !sourceOwner)) fail(l10n('合併來源的對局或玩家身分不符，未匯入。'));
        if(Object.hasOwn(records,key) && !equal(records[key],raw)){
          if(authoritative.has(key)){
            warnings.push(l10n("來源 {0} 與批次中的獨立記錄不同；保留獨立記錄，內嵌原件仍留在合併報告。", raw.id));
            continue;
          }
          fail(l10n('合併報告含同 ID 不同內容的內嵌來源，未匯入：')+raw.id);
        }
        if(!Object.hasOwn(records,key)) records[key]=clone(raw);
        expand(records[key]);
      }
    }
    for(const [key,record] of Object.entries(records)) if(key.startsWith('msa.session.')) expand(record);
    validateRecords(records);
  }
  function parseImport(input,options={}){
    if(typeof input!=='string' || !input.trim()) fail(l10n('檔案沒有可匯入的資料。'));
    const bytes=new TextEncoder().encode(input).length;
    if(bytes>LIMITS.bytes) fail(l10n('檔案超過 20 MiB，請分批匯入。'));
    const text=input.replace(/^\uFEFF/,'').trim();
    let records,kind;const warnings=[];
    if(text.startsWith('<')){
      const record=jsonBlock(text,'msa-record-data',true),info=jsonBlock(text,'msa-export-info',false);
      records=clone(recordsFrom(record));kind='html';
      if(info && Object.hasOwn(info,'workspaceRecords')){
        addWorkspaceRecords(records,info.workspaceRecords);
      }
    }else{
      let value;try{value=JSON.parse(text);}catch(_){fail(l10n('JSON 格式不正確，未匯入。'));}
      records=clone(recordsFrom(value));kind=value.format===FORMAT?'batch-json':'session-json';
      if(kind==='session-json'){
        // The exporter appends its new audit field after preserved earlier
        // fields. Restore the latest accompanying workspace copy; retain all
        // older metadata unchanged inside the session's original JSON.
        const metadata=Object.entries(value).filter(([key,item])=>
          /^(?:exportInfo|recorder(?:Recorder)*ExportInfo)(?:\d+|\(\d+\))?$/.test(key) && object(item) && Object.hasOwn(item,'workspaceRecords'));
        if(metadata.length) addWorkspaceRecords(records,metadata.at(-1)[1].workspaceRecords);
      }
    }
    expandCombinedSources(records,warnings);
    validateRecords(records);
    return {kind,source:{fileName:str(options.fileName).slice(0,250),kind,bytes},records,warnings};
  }
  async function planImport(values,parsed){
    const local=workspace(values),incoming=validateRecords(clone(parsed.records));
    const digest=await hash(incoming),baseReceiptId='import-'+digest.slice(0,32);
    let receiptId=baseReceiptId;
    const receiptMatches=receipt=>receipt?.fingerprint===digest && Object.entries(incoming).every(([key,value])=>
      equal(receipt.sourceRecords?.[key],value) || (key.startsWith('msa.import.') &&
        Array.isArray(receipt.importedArchiveKeys) && receipt.importedArchiveKeys.includes(key) && equal(local[key],value)));
    // An imported fingerprint is untrusted metadata. Reuse an archive only
    // when the actual original records are still present and equal.
    for(let n=1;local['msa.import.'+receiptId] && !receiptMatches(local['msa.import.'+receiptId]);n++) receiptId=baseReceiptId+'-'+n;
    const writes={},items=[],deckMap=new Map(),sessionMap=new Map();
    function archivedOriginal(record){
      const meta=record?.importProvenance;
      return meta && local['msa.import.'+meta.receiptId]?.sourceRecords?.[meta.originalKey];
    }
    function remapSessionReferences(record){
      const remap=id=>sessionMap.get(id)||id;
      if(Array.isArray(record.snapshots)) for(const snapshot of record.snapshots) if(snapshot.sourceSessionId) snapshot.sourceSessionId=remap(snapshot.sourceSessionId);
      if(Array.isArray(record.sourceSessions)) record.sourceSessions=record.sourceSessions.map(source=>typeof source==='string'?remap(source):{...source,id:remap(source.id)});
      if(Array.isArray(record.captureIssues)) for(const issue of record.captureIssues) if(issue.sourceSessionId) issue.sourceSessionId=remap(issue.sourceSessionId);
      if(record.isCombined===true && Array.isArray(record.sourceRecords)) for(const source of record.sourceRecords){source.id=remap(source.id);remapSessionReferences(source);}
    }
    async function add(key,raw){
      const original=clone(raw),record=clone(raw),prefix=PREFIXES.find(value=>key.startsWith(value));
      if(prefix==='msa.session.') remapSessionReferences(record);
      if(prefix==='msa.match.' && deckMap.has(record.deckVersionId)){
        record.deckVersionId=deckMap.get(record.deckVersionId);
        record.frozenDeckVersion=clone(writes['msa.deck.'+record.deckVersionId] || local['msa.deck.'+record.deckVersionId]);
      }
      if(['msa.note.','msa.match.'].includes(prefix) && sessionMap.has(record.sourceSessionId)) record.sourceSessionId=sessionMap.get(record.sourceSessionId);
      const existing=local[key];
      if(existing && equal(existing,record)) {items.push({key,targetKey:key,status:'identical',kind:prefix||'legacy'});return;}
      if(existing && equal(local['msa.import.'+receiptId]?.sourceRecords?.[key],original) && prefix!=='msa.session.' && prefix!=='msa.deck.'){
        items.push({key,targetKey:'msa.import.'+receiptId,status:'identical-copy',kind:prefix||'legacy'});return;
      }
      if(!existing){writes[key]=record;items.push({key,targetKey:key,status:'new',kind:prefix||'legacy'});return;}
      if(prefix==='msa.session.' || prefix==='msa.deck.'){
        const fingerprint=await hash(original);
        const base=prefix==='msa.session.'?original.gameId+'.import-'+fingerprint.slice(0,24):original.id.slice(0,200)+'.import-'+fingerprint.slice(0,16);
        let id=base,targetKey=prefix+id;
        for(let n=1;Object.hasOwn(local,targetKey)||Object.hasOwn(writes,targetKey);n++){
          const prior=local[targetKey]||writes[targetKey];
          if(prior.importProvenance?.fingerprint===fingerprint && equal(archivedOriginal(prior),original)){
            if(prefix==='msa.deck.') deckMap.set(original.id,id);else sessionMap.set(original.id,id);
            items.push({key,targetKey,status:'identical-copy',kind:prefix});return;
          }
          id=base+'-'+n;targetKey=prefix+id;
        }
        record.id=id;
        record.importProvenance={originalKey:key,originalId:original.id,fingerprint,receiptId,importedAt:null};
        if(prefix==='msa.deck.') deckMap.set(original.id,id);else sessionMap.set(original.id,id);
        if(prefix==='msa.session.') remapSessionReferences(record);
        writes[targetKey]=record;
        items.push({key,targetKey,status:'copy',kind:prefix});
      }else items.push({key,targetKey:'msa.import.'+receiptId,status:'archived-conflict',kind:prefix||'legacy'});
    }
    const sourceDepth=record=>record?.isCombined===true && Array.isArray(record.sourceRecords)?1+record.sourceRecords.reduce((depth,source)=>Math.max(depth,sourceDepth(source)),0):0;
    const priority=(key,value)=>key.startsWith('msa.deck.')?0:key.startsWith('msa.session.')?1+sourceDepth(value):key.startsWith('msa.import.')?100:50;
    for(const [key,value] of Object.entries(incoming).sort(([a,av],[b,bv])=>priority(a,av)-priority(b,bv)||a.localeCompare(b))) await add(key,value);
    const relevant=items.some(item=>!['identical','identical-copy'].includes(item.status));
    if(relevant && !local['msa.import.'+receiptId]){
      // Non-conflicting archives are copied as their own records. A conflicting
      // archive needs one preserved original here, just like another conflict.
      // Do not recursively nest every archive on ordinary backup restoration.
      const sourceRecords={};
      const archiveConflicts=new Set(items.filter(item=>item.kind==='msa.import.' && item.status==='archived-conflict').map(item=>item.key));
      for(const [key,value] of Object.entries(incoming)) if(!key.startsWith('msa.import.') || archiveConflicts.has(key)) sourceRecords[key]=clone(value);
      writes['msa.import.'+receiptId]={schemaVersion:1,id:receiptId,fingerprint:digest,importedAt:null,
        source:clone(parsed.source),sourceRecords,importedArchiveKeys:Object.keys(incoming).filter(key=>key.startsWith('msa.import.')),
        mappings:items.map(({key,targetKey,status})=>({key,targetKey,status}))};
    }
    validateRecords(writes);
    const summary={records:items.length,sessions:items.filter(item=>item.kind==='msa.session.').length,
      newRecords:items.filter(item=>item.status==='new').length,copies:items.filter(item=>item.status==='copy').length,
      conflicts:items.filter(item=>['copy','archived-conflict'].includes(item.status)).length,
      skipped:items.filter(item=>['identical','identical-copy'].includes(item.status)).length,writes:Object.keys(writes).length};
    summary.estimatedWriteBytes=new TextEncoder().encode(JSON.stringify(writes)).length;
    const warnings=Array.isArray(parsed.warnings)?parsed.warnings.slice():[];
    if(summary.conflicts) warnings.push(l10n('保留本機衝突資料；匯入原件另存於匯入副本，可下載原件。'));
    if(Object.keys(writes).length){
      warnings.push(l10n("估計新增寫入 {0} MiB（含可還原原件），不代表瀏覽器尚有足夠容量。", (summary.estimatedWriteBytes/1024/1024).toFixed(2)));
      warnings.push(l10n('寫入採逐筆最佳努力；容量不足或中斷可能只完成部分，會列出實際結果。'));
    }
    const relevantKeys=[...new Set([...Object.keys(incoming),...Object.keys(writes),...items.map(item=>item.targetKey)])].sort();
    const preconditions=Object.fromEntries(relevantKeys.map(key=>[key,local[key]??null]));
    const token=await hash({incoming,preconditions,writes});
    return {previewToken:token,source:clone(parsed.source),summary,items,warnings,writes};
  }
  function parseDeck(text,zone='main'){
    if(!['main','resources','tokens'].includes(zone)) fail(l10n('不支援的牌組區域。'));
    if(typeof text!=='string' || text.length>30000) return {ok:false,cards:[],total:0,errors:[l10n('牌表過大或格式不正確。')]};
    const counts=new Map(),errors=[];
    text.split(/\r?\n/).forEach((raw,index)=>{
      const line=raw.trim();if(!line || line.startsWith('#')) return;
      const a=line.match(/^(\d+)\s*(?:[x×]\s*|\s+)([A-Za-z0-9_-]+)$/i);
      const b=line.match(/^([A-Za-z0-9_-]+)\s*[x×]\s*(\d+)$/i);
      if(!a && !b){errors.push(l10n("第 {0} 行：請用「數量x卡號」。", index+1));return;}
      const amount=Number(a?a[1]:b[2]),code=(a?a[2]:b[1]).toUpperCase().replace('_','-');
      if(!CODE.test(code) || !Number.isSafeInteger(amount) || amount<1 || amount>100){errors.push(l10n("第 {0} 行：卡號或數量無效。", index+1));return;}
      if(zone==='main' && /^(R|EXR|EXB|T)-/.test(code)){errors.push(l10n("第 {0} 行：資源／Token 編號請放分開欄位。", index+1));return;}
      counts.set(code,(counts.get(code)||0)+amount);
    });
    const cards=[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([cardCode,count])=>({cardCode,count}));
    const total=cards.reduce((sum,card)=>sum+card.count,0);
    if(cards.length>200 || cards.some(card=>card.count>100)) errors.push(l10n('單一區域最多 200 種卡號，同卡號最多 100 張。'));
    if(zone==='main'){
      if(total!==50) errors.push(l10n("主牌組共 {0} 張，需要 50 張。", total));
      for(const card of cards) if(card.count>4) errors.push(l10n("{0} 共 {1} 張，超過 4 張。", card.cardCode, card.count));
    }
    return {ok:!errors.length,cards,total,errors};
  }
  async function createDeckVersion(draft,options={}){
    if(!object(draft)) fail(l10n('缺少牌組資料。'));
    const name=str(draft.name).trim();if(!name || name.length>120) fail(l10n('請輸入 1–120 字的牌組名稱。'));
    const main=parseDeck(str(draft.mainText),'main'),resources=parseDeck(str(draft.resourcesText),'resources'),tokens=parseDeck(str(draft.tokensText),'tokens');
    const errors=[...main.errors,...resources.errors,...tokens.errors];if(errors.length) fail(errors.join('\n'));
    const deckId=str(draft.deckId)||'deck-'+crypto.randomUUID();identifier(deckId,l10n('牌組 ID'));
    if(deckId.length>160) fail(l10n('牌組 ID 過長。'));
    const content={main:main.cards,resources:resources.cards,tokens:tokens.cards};
    const contentHash=await hash(content),versionHash=await hash({deckId,name,...content});
    return {schemaVersion:1,id:deckId+'.v-'+versionHash.slice(0,24),deckId,name,createdAt:timestamp(options.createdAt),
      parentVersionId:str(draft.parentVersionId)||null,contentHash,hashAlgorithm:'SHA-256',...content,
      validation:{mainCount:50,formatValid:true,rulesLegality:'not-checked',cardTypes:'user-assigned'}};
  }
  async function matchId(gameId,playerName){return 'match-'+(await hash([gameId,playerName.trim()])).slice(0,32);}
  async function createMatchRecord(draft,deck,options={}){
    if(!object(draft) || draft.identityConfirmed!==true) fail(l10n('請先確認這是你的玩家名稱。'));
    const gameId=str(draft.gameId),playerName=str(draft.playerName).trim();identity({gameId,playerName});
    if(!playerName) fail(l10n('請輸入已確認的玩家名稱。'));
    const result=RESULTS.includes(draft.result)?draft.result:'unknown';
    if(result!=='unknown' && draft.resultConfirmed!==true) fail(l10n('請明確確認對局結果。'));
    if(deck) validateRecord('msa.deck.'+deck.id,deck);
    const now=timestamp(options.updatedAt);
    return {schemaVersion:1,id:await matchId(gameId,playerName),gameId,playerName,identityConfirmed:true,source:'manual',
      sourceSessionId:str(draft.sourceSessionId),confirmedAt:now,updatedAt:now,
      deckVersionId:deck?.id||null,frozenDeckVersion:deck?clone(deck):null,
      firstPlayer:ORDERS.includes(draft.firstPlayer)?draft.firstPlayer:'unknown',result,
      resultConfirmed:result!=='unknown' && draft.resultConfirmed===true};
  }
  function calculateStats(values,filters={}){
    const unique=new Map();
    for(const [key,record] of Object.entries(values||{})){
      if(!key.startsWith('msa.match.') || !object(record) || record.schemaVersion!==1 || record.identityConfirmed!==true || record.source!=='manual' || !str(record.playerName).trim() || !str(record.gameId)) continue;
      const identity=JSON.stringify([record.gameId,record.playerName.trim()]);
      const previous=unique.get(identity);
      const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):-Infinity;
      if(!previous || time(record.updatedAt)>time(previous.updatedAt) || (time(record.updatedAt)===time(previous.updatedAt) && str(record.id)>str(previous.id))) unique.set(identity,record);
    }
    const matches=[...unique.values()].filter(record=>(!filters.deckVersionId || record.deckVersionId===filters.deckVersionId) &&
      (!filters.firstPlayer || record.firstPlayer===filters.firstPlayer));
    const stats={total:matches.length,confirmed:0,unconfirmed:0,wins:0,losses:0,draws:0,concedes:0,winRate:null,decisiveWinRate:null,
      denominatorLabel:l10n('勝／負／和局／本人投降的人工確認場次；未確認不列分母'),matches:clone(matches)};
    for(const match of matches){
      if(match.resultConfirmed!==true || !RESULTS.includes(match.result) || match.result==='unknown'){stats.unconfirmed++;continue;}
      stats.confirmed++;
      if(match.result==='win') stats.wins++;
      else if(match.result==='loss') stats.losses++;
      else if(match.result==='draw') stats.draws++;
      else stats.concedes++;
    }
    stats.lossesIncludingConcedes=stats.losses+stats.concedes;
    stats.winRate=stats.confirmed?stats.wins/stats.confirmed:null;
    const decisive=stats.wins+stats.losses+stats.concedes;
    stats.decisiveWinRate=decisive?stats.wins/decisive:null;
    return stats;
  }
  return Object.freeze({FORMAT,LIMITS,allowedKey,guard,canonical,equal,hash,validateRecords,workspace,createBackup,createArchiveBackup,parseImport,planImport,
    parseDeck,createDeckVersion,createMatchRecord,calculateStats,matchId});
});
