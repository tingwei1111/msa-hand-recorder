(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSALivePanelController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFERENCE_KEY = 'msa.livePanel';
  const PREFIX = 'msa.session.';
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const preferences = value => ({
    expanded: value?.expanded === true,
    left: typeof value?.left === 'number' && Number.isFinite(value.left) ? Math.max(0, Math.min(100000, Math.round(value.left))) : null,
    top: typeof value?.top === 'number' && Number.isFinite(value.top) ? Math.max(0, Math.min(100000, Math.round(value.top))) : null
  });

  function create(options) {
    const {storage, getContext, project, createUI} = options;
    let disposed = false, generation = 0, key = '', view = null, cache = {};
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
      view?.destroy(); view = null; key = ''; cache = {};
      loading = false; loaded = false; readError = ''; refreshing = null;
      changesDuringRead = new Map();
    }
    function isSessionKey(name) { return name.startsWith(PREFIX); }
    function retain(name, value, ctx) {
      return isSessionKey(name) && name.startsWith(`${PREFIX}${ctx.gameId}.`) && value && value.gameId === ctx.gameId;
    }
    function apply(name, value, ctx) {
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
      model.preferenceError = preferenceError;
      if (readError || !loaded) {
        model = {...model, latestSnapshot:null, handCards:[], recentPlays:[], snapshotCount:0,
          publicEventCount:0, publicPlayCount:0, canReview:false,
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
      prefs = preferences(value); preferenceRevision += 1;
      const desired = {...prefs}; pendingPreferences += 1;
      view.setPreferences(desired);
      preferenceWrites = preferenceWrites.catch(() => {}).then(async () => {
        try { await storage.local.set({[PREFERENCE_KEY]:desired}); preferenceError = ''; }
        catch (error) { preferenceError = `小窗位置或展開狀態未儲存：${String(error?.message || error)}`; }
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
      return Promise.resolve().then(() => {
        if (!matches(token, ctx, true)) return {ok:false,reason:'對局或玩家已切換。'};
        return options.onReview({...ctx,sessionId:id});
      }).then(result => matches(token, ctx, true) ? result : {ok:false,reason:'對局已切換。'})
        .catch(error => ({ok:false,reason:String(error?.message || error)}));
    }
    function sync() {
      if (disposed) return;
      const ctx = context();
      if (!ctx) { if (view || key) unmount(); return; }
      const next = contextKey(ctx);
      if (key !== next || !view) {
        unmount(); key = next;
        const token = generation;
        view = createUI({
          onPreferencesChange:value => savePreferences(value, token),
          onRefresh:() => refresh(token),
          onReview:() => review(token)
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
        } else if (name.startsWith(`${PREFIX}${ctx.gameId}.`)) {
          if (loading) changesDuringRead.set(name, change.newValue);
          apply(name, change.newValue, ctx); relevant = true;
        }
      }
      if (relevant) scheduleRender();
    }
    storage.onChanged.addListener(changed);
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
        storage.onChanged.removeListener?.(changed);
      }
    };
  }
  return {create, PREFERENCE_KEY};
});
