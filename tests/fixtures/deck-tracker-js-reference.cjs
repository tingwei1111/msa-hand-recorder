(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSADeckTrackerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DECK = 'msa.deck.', MATCH = 'msa.match.', SESSION = 'msa.session.';
  const CODE = /^(?:(?:GD|ST|EB|SC|SLB)\d{2,3}|EXB|EXR|PR|P|R|T)-\d{3}$/;
  const ID = /^[A-Za-z0-9_.:-]{1,256}$/;
  const PLAYS = new Set(['deploy-unit','play-command','play-action','play-base','replace-base','pair-pilot','link-pilot']);
  const RESULTS = new Set(['win','loss','draw','concede','unknown']);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' ? value : '';
  const name = value => text(value).trim();
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const identifier = value => typeof value === 'string' && ID.test(value);
  const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
  const code = value => { const candidate = name(value).toUpperCase(); return CODE.test(candidate) ? candidate : null; };
  const order = (a,b) => a.localeCompare(b, 'en');
  function cardRows(rows) {
    if (!Array.isArray(rows) || rows.length > 200) return null;
    const counts = new Map(), names = new Map();
    for (const row of rows) {
      if (!object(row) || !CODE.test(row.cardCode) || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 100) return null;
      counts.set(row.cardCode, (counts.get(row.cardCode) || 0) + row.count);
      if (!names.has(row.cardCode) && name(row.name)) names.set(row.cardCode, name(row.name).slice(0,300));
    }
    return {counts,names,total:[...counts.values()].reduce((sum,amount) => sum + amount,0)};
  }
  function deckRecord(value, expectedId) {
    if (!object(value) || value.schemaVersion !== 1 || !identifier(value.id) || value.id !== expectedId ||
        !identifier(value.deckId) || !name(value.name) || value.name.length > 120) return null;
    const main = cardRows(value.main), resources = cardRows(value.resources), tokens = cardRows(value.tokens);
    if (!main || !resources || !tokens || main.total !== 50 || [...main.counts].some(([cardCode,count]) => count > 4 || /^(?:R|EXR|EXB|T)-/.test(cardCode))) return null;
    return {record:value,main};
  }
  function manualMatch(key, value) {
    return key.startsWith(MATCH) && object(value) && value.schemaVersion === 1 && identifier(value.id) && key === MATCH + value.id &&
      identifier(value.gameId) && value.gameId.length <= 128 && name(value.playerName) && value.playerName.length <= 200 &&
      value.source === 'manual' && value.identityConfirmed === true;
  }
  function newer(a,b) {
    return time(a.updatedAt) > time(b.updatedAt) || (time(a.updatedAt) === time(b.updatedAt) && text(a.id) > text(b.id));
  }
  function matchRecords(values, playerName) {
    const selected = new Map();
    if (!playerName) return selected;
    for (const [key,value] of Object.entries(values)) {
      if (!manualMatch(key,value) || name(value.playerName) !== playerName) continue;
      const previous = selected.get(value.gameId);
      if (!previous || newer(value,previous)) selected.set(value.gameId,value);
    }
    return selected;
  }
  function statistics(matches, deckId) {
    const result = {confirmed:0,wins:0,losses:0,draws:0,concedes:0,winRate:null};
    if (!deckId) return result;
    for (const match of matches.values()) {
      if (match.deckVersionId !== deckId || match.resultConfirmed !== true || !RESULTS.has(match.result) || match.result === 'unknown') continue;
      result.confirmed += 1;
      if (match.result === 'win') result.wins += 1;
      else if (match.result === 'loss') result.losses += 1;
      else if (match.result === 'draw') result.draws += 1;
      else result.concedes += 1;
    }
    result.winRate = result.confirmed ? result.wins / result.confirmed : null;
    return result;
  }
  function publicCards(events, playerName, players) {
    const maps = {own:new Map(),opponent:new Map(),unknown:new Map(),tokens:new Map()};
    const names = new Map(), opponents = new Set((Array.isArray(players) ? players : []).map(name).filter(value => value && value !== playerName));
    let unsupported = 0;
    function add(kind,cardCode,cardName,actor,side) {
      const key = JSON.stringify([actor,cardCode,cardCode ? '' : cardName]);
      let row = maps[kind].get(key);
      if (!row) { row = {cardCode,name:cardName,count:0,actor}; if (side) row.side = side; maps[kind].set(key,row); }
      row.count += 1;
      if (!row.name && cardName) row.name = cardName;
      if (cardCode && cardName && !names.has(cardCode)) names.set(cardCode,cardName);
    }
    for (const event of Array.isArray(events) ? events : []) {
      if (!object(event)) continue;
      const primary = object(event.primaryCard) ? event.primaryCard : null;
      const cardCode = code(primary?.cardCode), cardName = name(primary?.name).slice(0,300), actor = name(event.actor);
      const side = !playerName || !actor ? 'unknown' : actor === playerName ? 'own' : opponents.has(actor) ? 'opponent' : 'unknown';
      if (event.action === 'deploy-token' || event.sourceZone === 'generated' || (event.isPlay === true && cardCode?.startsWith('T-'))) {
        add('tokens',cardCode,cardName,actor,side); continue;
      }
      if (event.isPlay !== true) continue;
      if (!PLAYS.has(event.action)) { unsupported += 1; continue; }
      // Never borrow an unrelated target or the latest hand card when the
      // parser did not identify a primary played card.
      add(cardCode ? side : 'unknown',cardCode,cardName,actor);
    }
    const lists = {};
    for (const kind of Object.keys(maps)) lists[kind] = [...maps[kind].values()].sort((a,b) => order(a.cardCode || '\uffff',b.cardCode || '\uffff') || order(a.actor,b.actor) || order(a.name,b.name));
    return {lists,names,unsupported};
  }
  function handEvidence(handModel, playerName, currentId, source) {
    const counts = new Map(), snapshot = handModel?.latestSnapshot;
    const absent = {counts:new Map(),kind:'unknown',note:'尚無本段來源相符的已存本人手牌，未推定各卡為 0。'};
    if (!playerName || !source || !object(snapshot) || !name(snapshot.id) || !source.snapshots.some(item => item?.id === snapshot.id) ||
        (snapshot.sourceSessionId && snapshot.sourceSessionId !== currentId) ||
        (handModel.sessionId && handModel.sessionId !== currentId) || !Array.isArray(handModel.handCards)) return absent;
    if (!['complete','partial'].includes(handModel.quality)) return {...absent,note:'最近已存手牌無法完整辨識，各卡數量維持未知。'};
    for (const row of handModel.handCards) {
      const cardCode = code(row?.cardCode);
      if (!cardCode || !Number.isSafeInteger(row.count) || row.count < 1) return {...absent,note:'最近手牌欄位未通過格式核對，各卡數量維持未知。'};
      counts.set(cardCode,(counts.get(cardCode) || 0) + row.count);
    }
    const total = [...counts.values()].reduce((sum,amount) => sum + amount,0);
    const exact = handModel.quality === 'complete' && snapshot.quality === 'complete' && snapshot.unknownCount === 0 &&
      integer(snapshot.expectedCount) && snapshot.expectedCount === total;
    return {counts,kind:exact?'exact':'at-least',note:exact ? '手牌張數依最近已存完整觀察；未涵蓋所有瞬間。' : '部分辨識只列已辨識張數下限；未辨識到的卡維持未知。'};
  }
  function project(input = {}) {
    const values = object(input.values) ? input.values : {}, context = object(input.context) ? input.context : {};
    const gameId = text(context.gameId), playerName = name(context.playerName), currentId = gameId && text(context.runId) ? gameId + '.' + context.runId : '';
    const available = [];
    for (const [key,value] of Object.entries(values)) {
      if (!key.startsWith(DECK)) continue;
      const deck = deckRecord(value,key.slice(DECK.length));
      if (deck) available.push(deck.record);
    }
    available.sort((a,b) => time(b.createdAt) - time(a.createdAt) || order(a.name,b.name) || order(a.id,b.id));
    const current = values[SESSION + currentId];
    const canBind = Boolean(playerName && currentId && object(current) && current.schemaVersion === 1 && current.id === currentId &&
      current.gameId === gameId && name(current.playerName) === playerName && Array.isArray(current.snapshots) && current.snapshots.length > 0);
    const result = {state:playerName?'unbound':'identity-unknown',gameId,playerName,contextKey:currentId,sessionId:canBind?currentId:null,canBind,
      availableDecks:available.map(deck => ({id:deck.id,name:deck.name})),deck:null,rows:[],publicCards:null,
      warnings:[],handNote:'',publicNote:'',stateDetail:playerName?'本場尚未綁定牌組，請選擇並確認使用的版本。':'本人身分尚未確認，不借用其他玩家牌組或手牌。',
      stats:{confirmed:0,wins:0,losses:0,draws:0,concedes:0,winRate:null},unsupportedPublicCount:0};
    const publicView = publicCards(input.events,playerName,input.players);
    result.publicCards = publicView.lists; result.unsupportedPublicCount = publicView.unsupported;
    if (publicView.unsupported) result.warnings.push(`有 ${publicView.unsupported} 筆未支援的公開動作格式，未計入使用次數。`);
    const coverage = object(input.coverage) ? input.coverage : {};
    result.publicNote = '只計已收錄公開使用次數；同卡再次使用會重複計數，不推算剩餘牌庫。' +
      (coverage.hasGaps || coverage.unmergedCaptureCount ? '公開 Log 有待確認缺口。' : coverage.publicLogComplete ? '公開 Log 已見起尾。' : '公開 Log 尚未確認整場完整。');
    const hand = handEvidence(input.handModel,playerName,currentId,canBind?current:null); result.handNote = hand.note;
    const matches = matchRecords(values,playerName), match = matches.get(gameId);
    if (!playerName || !match || !match.deckVersionId) return result;
    const deckId = text(match.deckVersionId);
    let bound;
    if (match.frozenDeckVersion !== null && match.frozenDeckVersion !== undefined) {
      bound = deckRecord(match.frozenDeckVersion,deckId);
      if (!bound) { result.state='invalid'; result.stateDetail='本場凍結牌組版本格式或 ID 不符，未改用其他版本。'; return result; }
    } else {
      bound = deckRecord(values[DECK + deckId],deckId);
      if (!bound) { result.state='invalid'; result.stateDetail='找不到本場綁定且格式有效的牌組版本，請重新核對綁定。'; return result; }
      result.warnings.push('此舊記錄缺少凍結牌表，目前使用同 ID 的已存版本，請核對內容。');
    }
    result.state='bound'; result.stateDetail='使用本場人工確認的牌組版本；主牌格式通過不代表賽制合法性已驗證。';
    result.deck={id:deckId,name:bound.record.name,mainCount:bound.main.total};
    result.stats=statistics(matches,deckId);
    const ownUses = new Map(result.publicCards.own.filter(row => row.cardCode).map(row => [row.cardCode,row.count]));
    const codes = new Set([...bound.main.counts.keys(),...hand.counts.keys(),...ownUses.keys()]);
    for (const cardCode of [...codes].sort(order)) {
      const present = hand.counts.has(cardCode), deckCount = bound.main.counts.get(cardCode) || 0;
      result.rows.push({cardCode,name:bound.main.names.get(cardCode) || publicView.names.get(cardCode) || '',deckCount,
        handCount:hand.kind==='exact'?(hand.counts.get(cardCode) || 0):hand.kind==='at-least'&&present?hand.counts.get(cardCode):null,
        handCountKind:hand.kind==='exact'?'exact':hand.kind==='at-least'&&present?'at-least':'unknown',
        publicUseCount:ownUses.get(cardCode) || 0,outsideDeck:deckCount===0});
    }
    const outside = result.rows.filter(row => row.outsideDeck);
    if (outside.length) result.warnings.push(`本人已存觀察或公開使用含 ${outside.length} 種牌表外卡號，請核對牌組綁定與記錄；未改寫牌表。`);
    if (result.rows.some(row => row.deckCount && row.handCount !== null && row.handCount > row.deckCount)) result.warnings.push('已辨識手牌張數超過所綁牌表的同卡數量，請核對版本與辨識結果。');
    return result;
  }
  return Object.freeze({project});
});
