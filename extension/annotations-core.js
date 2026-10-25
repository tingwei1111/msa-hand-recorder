(function(root,factory){
  'use strict';const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.MSAAnnotationsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PREFIX='msa.note.';
  const text=value=>typeof value==='string'?value:'';
  function clean(value,max,label){
    if(typeof value!=='string'||value.length>max)throw new TypeError(label+'格式或長度不符。');
    return value.trim();
  }
  function create(session,snapshot,payload,options){
    options=options||{};payload=payload||{};
    if(!session||!snapshot||!session.id||!session.gameId||!text(session.playerName).trim()||!text(snapshot.id))throw new TypeError('請先選擇來源相符且已確認玩家的已存手牌。');
    const id=options.id||globalThis.crypto.randomUUID(),timestamp=options.now||new Date().toISOString();
    return {schemaVersion:1,id,gameId:session.gameId,playerName:session.playerName,sourceSessionId:session.id,
      snapshotId:snapshot.id,turn:Number.isInteger(snapshot.turn)?snapshot.turn:null,
      turnSource:['log','phase-observed','unknown'].includes(snapshot.turnSource)?snapshot.turnSource:'unknown',
      observedTurn:Number.isInteger(snapshot.observedTurn)?snapshot.observedTurn:null,
      observedAt:text(snapshot.timestamp),createdAt:timestamp,updatedAt:timestamp,
      tag:clean(payload.tag??'待檢討',40,'標籤'),note:clean(payload.note??'',1500,'筆記')};
  }
  function update(original,payload,now){
    if(!original||original.schemaVersion!==1||!text(original.id))throw new TypeError('找不到原筆記。');
    payload=payload||{};
    const next={...original,updatedAt:now||new Date().toISOString()};
    if(payload.note!==undefined)next.note=clean(payload.note,1500,'筆記');
    if(payload.tag!==undefined)next.tag=clean(payload.tag,40,'標籤');
    if(payload.deleted===true)next.deletedAt=next.updatedAt;
    if(payload.deleted===false)delete next.deletedAt;
    return next;
  }
  function list(values,selection){
    selection=selection||{};
    const sourceIds=new Set(selection.sourceIds||[]);
    return Object.entries(values||{}).filter(([key,item])=>key.startsWith(PREFIX)&&item?.schemaVersion===1&&
      key===PREFIX+item.id&&(!item.deletedAt||selection.includeDeleted)&&item.gameId===selection.gameId&&
      (!selection.playerName||item.playerName===selection.playerName)&&(!sourceIds.size||sourceIds.has(item.sourceSessionId)))
      .map(([,item])=>JSON.parse(JSON.stringify(item))).sort((a,b)=>text(a.createdAt).localeCompare(text(b.createdAt)));
  }
  return {PREFIX,create,update,list};
});
