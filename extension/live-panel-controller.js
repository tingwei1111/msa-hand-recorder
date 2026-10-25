(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSALivePanelController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFERENCE_KEY = 'msa.livePanel';
  const PREFIX = 'msa.session.';
  const NOTE_PREFIX = 'msa.note.';
  const MATCH_PREFIX = 'msa.match.', DECK_PREFIX = 'msa.deck.';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
  const preferences = value => ({
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    expanded: value?.expanded === true,
    left: typeof value?.left === 'number' && Number.isFinite(value.left) ? Math.max(0, Math.min(100000, Math.round(value.left))) : null,
    top: typeof value?.top === 'number' && Number.isFinite(value.top) ? Math.max(0, Math.min(100000, Math.round(value.top))) : null,
    tab: ['deck','hand','events','all'].includes(value?.tab) ? value.tab : 'hand',
    width: bounded(value?.width, 320, 280, 480),
    fontSize: bounded(value?.fontSize, 12, 11, 16),
    dock: ['free','left','right'].includes(value?.dock) ? value.dock : 'free'
  });

  function create(options) {
    const {storage, getContext, project, createUI} = options;
    let disposed = false, generation = 0, key = '', scopePlayer = '', view = null, cache = {};
    let loading = false, loaded = false, readError = '', preferenceError = '';
    let prefs = preferences(), preferenceRevision = 0, pendingPreferences = 0;
    let preferenceWrites = Promise.resolve(), changesDuringRead = new Map();
    let renderTimer, refreshing = null;
    const debounce = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : 40;

    function context() {
      const value = getContext();
      return value && UUID.test(value.gameId || '') && UUID.test(value.runId || '') ? {...value} : null;
    }
    const contextKey = ctx => ctx ? `${ctx.gameId}.${ctx.runId}` : '';
    function matches(token, expected, requirePlayer = false) {
      const now = context();
      return !disposed && token === generation && Boolean(now) && contextKey(now) === contextKey(expected) &&
        (!requirePlayer || (now.playerName || '') === (expected.playerName || ''));
    }
    function unmount() {
      generation += 1;
      clearTimeout(renderTimer);
      view?.destroy(); view = null; key = ''; scopePlayer = ''; cache = {};
      loading = false; loaded = false; readError = ''; refreshing = null;
      changesDuringRead = new Map();
    }
    function isSessionKey(name) { return name.startsWith(PREFIX); }
    function retain(name, value, ctx) {
      return isSessionKey(name) && name.startsWith(`${PREFIX}${ctx.gameId}.`) && value && value.gameId === ctx.gameId;
    }
    function apply(name, value, ctx) {
      if (name.startsWith(DECK_PREFIX)) {
        if (value?.schemaVersion === 1 && name === DECK_PREFIX + value.id && Array.isArray(value.main)) cache[name] = value;
        else delete cache[name];
        return;
      }
      if (name.startsWith(MATCH_PREFIX)) {
        if (ctx.playerName && value?.schemaVersion === 1 && name === MATCH_PREFIX + value.id &&
          value.playerName === ctx.playerName && value.source === 'manual' && value.identityConfirmed === true) cache[name] = value;
        else delete cache[name];
        return;
      }
      if (name.startsWith(NOTE_PREFIX)) {
        if (value && value.gameId === ctx.gameId && (!value.playerName || value.playerName === ctx.playerName)) cache[name] = value;
        else delete cache[name];
        return;
      }
      if (!isSessionKey(name)) return;
      if (retain(name, value, ctx)) cache[name] = value;
      else delete cache[name];
    }
    function render() {
      if (!view || disposed) return;
      const ctx = context();
      if (!ctx || contextKey(ctx) !== key) { sync(); return; }
      let model;
      try { model = project(cache, ctx); }
      catch (error) {
        model = {gameId:ctx.gameId, sessionId:null, handCards:[], recentPlays:[], captureIssues:[],
          statusTone:'error', statusLabel:'無法整理已存記錄', statusDetail:String(error?.message || error)};
      }
      model.canReview = Boolean(model.sessionId && cache[PREFIX + model.sessionId]?.gameId === ctx.gameId);
      model.canBookmark = Boolean(loaded && !readError && ctx.playerName && model.latestSnapshot?.id &&
        cache[PREFIX + contextKey(ctx)]?.playerName === ctx.playerName);
      if (model.deckTracker) model.deckTracker.canBind = Boolean(model.canBookmark && model.deckTracker.canBind);
      model.preferenceError = preferenceError;
      if (readError || !loaded) {
        model = {...model, latestSnapshot:null, handCards:[], recentPlays:[], snapshotCount:0,
          publicEventCount:0, publicPlayCount:0, canReview:false, canBookmark:false,
          handDelta:{comparable:false,added:[],removed:[],reason:'尚未確認已存觀察'},
          deckTracker:{state:'identity-unknown',playerName:ctx.playerName || '',availableDecks:[],rows:[],canBind:false,
            warnings:readError?['本機記錄讀取失敗，未使用先前的牌組或計數。']:[],publicCards:{own:[],opponent:[],unknown:[],tokens:[]}},
          statusTone:readError ? 'error' : 'neutral', statusLabel:readError ? '本機記錄讀取失敗' : '讀取本場記錄中…',
          statusDetail:readError || '小窗只會顯示本場已確認存入的資料。'};
      }
      view.update(model);
    }
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, debounce);
    }
    function savePreferences(value, token) {
      if (disposed || token !== generation || !view) return;
      const previous = prefs;
      prefs = preferences({...prefs,...value}); preferenceRevision += 1;
      const desired = {...prefs}, revision = preferenceRevision;
      const patch = Object.fromEntries(Object.keys(desired).filter(name => JSON.stringify(previous[name]) !== JSON.stringify(desired[name])).map(name => [name,desired[name]]));
      pendingPreferences += 1;
      view.setPreferences(desired);
      preferenceWrites = preferenceWrites.catch(() => {}).then(async () => {
        try {
          const stored = await storage.local.get(PREFERENCE_KEY);
          const merged = preferences({...stored?.[PREFERENCE_KEY],...patch});
          await storage.local.set({[PREFERENCE_KEY]:merged}); preferenceError = '';
          if (!disposed && revision === preferenceRevision) { prefs = merged; view?.setPreferences(prefs); }
        }
        catch (error) { preferenceError = `小窗顯示偏好未儲存：${String(error?.message || error)}`; }
        finally { pendingPreferences -= 1; if (!disposed) scheduleRender(); }
      });
    }
    function read(ctx, token) {
      if (loading) return;
      loading = true;
      const revision = preferenceRevision;
      const changes = changesDuringRead = new Map();
      Promise.resolve().then(() => storage.local.get(null)).then(values => {
        if (!matches(token, ctx)) return;
        cache = {};
        for (const [name, value] of Object.entries(values || {})) apply(name, value, ctx);
        for (const [name, value] of changes) apply(name, value, ctx);
        if (revision === preferenceRevision && !pendingPreferences) {
          prefs = preferences(changes.has(PREFERENCE_KEY) ? changes.get(PREFERENCE_KEY) : values?.[PREFERENCE_KEY]);
          view.setPreferences(prefs);
        }
        loaded = true; readError = ''; render();
      }).catch(error => {
        if (!matches(token, ctx)) return;
        loaded = false; cache = {}; readError = String(error?.message || error); render();
      }).finally(() => { if (matches(token, ctx)) { loading = false; changesDuringRead.clear(); } });
    }
    function actionContext(token) {
      const ctx = context();
      return ctx && matches(token, ctx) && contextKey(ctx) === key ? ctx : null;
    }
    function refresh(token) {
      const ctx = actionContext(token);
      if (!ctx) return Promise.resolve({ok:false,refreshed:false,reason:'對局已切換，請在目前小窗重新操作。'});
      if (refreshing?.token === token) return refreshing.promise;
      const operation = {token, promise:null};
      operation.promise = Promise.resolve().then(() => {
        if (!matches(token, ctx, true)) return {ok:false,refreshed:false,reason:'對局或玩家已切換。'};
        return options.onCapture(ctx);
      }).then(result => {
        if (!matches(token, ctx, true)) return {ok:false,refreshed:false,reason:'對局或玩家已切換，沒有套用舊更新結果。'};
        if (readError && !loading) read(ctx, token);
        render();
        return result;
      }).catch(error => ({ok:false,refreshed:false,reason:String(error?.message || error)}))
        .finally(() => { if (refreshing === operation) refreshing = null; });
      refreshing = operation;
      return operation.promise;
    }
    function review(token) {
      const ctx = actionContext(token);
      if (!ctx) return Promise.resolve({ok:false,reason:'對局已切換，請在目前小窗重新操作。'});
      const id = contextKey(ctx), session = cache[PREFIX + id];
      if (!session || session.gameId !== ctx.gameId) return Promise.resolve({ok:false,reason:'本段還沒有已存記錄。'});
      if (session.snapshots?.length && (!ctx.playerName || session.playerName !== ctx.playerName)) return Promise.resolve({ok:false,reason:'本段手牌玩家來源不符。'});
      return Promise.resolve().then(() => {
        if (!matches(token, ctx, true)) return {ok:false,reason:'對局或玩家已切換。'};
        return options.onReview({...ctx,sessionId:id});
      }).then(result => matches(token, ctx, true) ? result : {ok:false,reason:'對局已切換。'})
        .catch(error => ({ok:false,reason:String(error?.message || error)}));
    }
    function bookmark(token, payload) {
      const ctx = actionContext(token), source = ctx && cache[PREFIX + contextKey(ctx)];
      if (!ctx || !loaded || readError || !ctx.playerName || !source || source.playerName !== ctx.playerName) {
        return Promise.resolve({ok:false,reason:'目前沒有來源相符的已存本人快照。'});
      }
      const snapshot = source.snapshots?.find(item => item.id === payload?.snapshotId);
      if (!snapshot) return Promise.resolve({ok:false,reason:'快照不在目前記錄段落，未建立書籤。'});
      if (typeof options.onBookmark !== 'function') return Promise.resolve({ok:false,reason:'書籤服務尚未載入。'});
      const anchored = {snapshotId:snapshot.id,turn:snapshot.turn ?? null,turnSource:snapshot.turnSource || 'unknown',
        observedTurn:snapshot.observedTurn ?? null,note:String(payload.note || '').slice(0,500),tag:String(payload.tag || '').slice(0,40)};
      return Promise.resolve().then(() => {
        if (!matches(token, ctx, true)) return {ok:false,reason:'對局或玩家已切換，未建立書籤。'};
        return options.onBookmark({...ctx,sessionId:contextKey(ctx)}, anchored);
      }).then(result => matches(token,ctx,true) ? result : {ok:false,reason:'對局已切換，請到原對局回顧確認書籤結果。'})
        .catch(error => ({ok:false,reason:String(error?.message || error)}));
    }
    function bindDeck(token, payload) {
      const ctx = actionContext(token), source = ctx && cache[PREFIX + contextKey(ctx)];
      if (!ctx || !loaded || readError || !ctx.playerName || !source || source.playerName !== ctx.playerName || !source.snapshots?.length) {
        return Promise.resolve({ok:false,reason:'請先確認本段已有來源相符的本人手牌。'});
      }
      if (payload?.confirmed !== true || typeof payload.deckVersionId !== 'string' || !cache[DECK_PREFIX + payload.deckVersionId]) {
        return Promise.resolve({ok:false,reason:'請選擇已保存的牌組版本，再確認綁定。'});
      }
      if (typeof options.onBindDeck !== 'function') return Promise.resolve({ok:false,reason:'本場牌組綁定服務尚未載入。'});
      return Promise.resolve().then(() => matches(token,ctx,true) ? options.onBindDeck({...ctx,sessionId:contextKey(ctx)},
        {deckVersionId:payload.deckVersionId,confirmed:true}) : {ok:false,reason:'對局或玩家已切換。'})
        .then(result => matches(token,ctx,true) ? result : {ok:false,reason:'對局已切換，請到原對局確認綁定結果。'})
        .catch(error => ({ok:false,reason:String(error?.message || error)}));
    }
    function sync() {
      if (disposed) return;
      const ctx = context();
      if (!ctx) { if (view || key) unmount(); return; }
      const next = contextKey(ctx);
      if (key !== next || !view || scopePlayer !== (ctx.playerName || '')) {
        unmount(); key = next; scopePlayer = ctx.playerName || '';
        const token = generation;
        view = createUI({
          onPreferencesChange:value => savePreferences(value, token),
          onRefresh:() => refresh(token),
          onReview:() => review(token),
          onBookmark:payload => bookmark(token,payload),
          onBindDeck:payload => bindDeck(token,payload),
          onCardLookup:code => actionContext(token) && typeof options.onCardLookup === 'function' ? options.onCardLookup(code) : Promise.resolve({status:'error',cardCode:code,reason:'卡片查詢服務尚未載入，或對局已切換。'}),
          onDismissAlert:code => {
            const ctx = actionContext(token);
            if (!ctx || typeof options.onDismissAlert !== 'function') return Promise.resolve({ok:false,reason:'目前無法更新提醒狀態。'});
            return Promise.resolve().then(() => matches(token,ctx,true) ? options.onDismissAlert(ctx,code) : {ok:false,reason:'對局已切換。'});
          },
          onManage:() => {
            const ctx = actionContext(token);
            if (!ctx || typeof options.onManage !== 'function') return Promise.resolve({ok:false,reason:'資料管理服務尚未載入，或對局已切換。'});
            const id=contextKey(ctx), session=cache[PREFIX+id];
            const safe=Boolean(session && session.gameId===ctx.gameId && (!session.snapshots?.length || session.playerName===ctx.playerName));
            return Promise.resolve().then(() => matches(token,ctx,true) ? options.onManage({...ctx,sessionId:safe?id:null}) : {ok:false,reason:'對局已切換。'});
          }
        });
        view.setPreferences(prefs);
        render(); read(ctx, token);
      } else {
        render();
        if (readError && !loading) read(ctx, generation);
      }
    }
    function changed(changes, area) {
      if (area !== 'local' || disposed) return;
      const ctx = context();
      if (!ctx || contextKey(ctx) !== key) { sync(); return; }
      let relevant = false;
      for (const [name, change] of Object.entries(changes)) {
        if (name === PREFERENCE_KEY) {
          if (loading) changesDuringRead.set(name, change.newValue);
          if (!pendingPreferences) { prefs = preferences(change.newValue); view?.setPreferences(prefs); }
          relevant = true;
        } else if (name.startsWith(`${PREFIX}${ctx.gameId}.`) || name.startsWith(NOTE_PREFIX) ||
          name.startsWith(MATCH_PREFIX) || name.startsWith(DECK_PREFIX)) {
          if (loading) changesDuringRead.set(name, change.newValue);
          apply(name, change.newValue, ctx); relevant = true;
        }
      }
      if (relevant) scheduleRender();
    }
    storage.onChanged.addListener(changed);
    const unsubscribeEngine=options.tracker?.subscribe?.(()=>{if(!disposed)sync();});
    return {
      sync,
      show() {
        sync();
        if (!view) return {ok:false,reason:'請先開啟 MSA 對局頁面。'};
        savePreferences({...prefs,expanded:true}, generation);
        view.focusLauncher?.();
        return {ok:true,opened:true,gameId:context().gameId};
      },
      destroy() {
        if (disposed) return;
        unmount(); disposed = true;
        unsubscribeEngine?.();
        storage.onChanged.removeListener?.(changed);
      }
    };
  }
  return {create, PREFERENCE_KEY, normalizePreferences:preferences};
});
