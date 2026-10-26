(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSAI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const KEY = 'msa.language', LANGUAGES = ['zh-TW', 'zh-CN', 'en'];
  const listeners = new Set(), bindings = new Set(), staticValues = new WeakMap();
  let language = detect(root.navigator?.languages || [root.navigator?.language]), initialized = false, storage;
  let pending = Promise.resolve();
  const catalog = () => root.MSAI18nCatalog || {};
  function detect(languages) {
    for (const value of languages || []) {
      const code = String(value || '').replace(/_/g, '-').toLowerCase();
      if (/^zh(?:-|$)/.test(code)) return /(?:hans|cn|sg)/.test(code) ? 'zh-CN' : 'zh-TW';
      if (/^en(?:-|$)/.test(code)) return 'en';
    }
    return root.navigator ? 'en' : 'zh-TW';
  }
  function format(message, values) {
    return message.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);
  }
  function t(source, ...values) {
    if (typeof source !== 'string') return source == null ? '' : String(source);
    const entry = catalog()[source];
    return format(entry && Object.hasOwn(entry, language) ? entry[language] : source, values);
  }
  // Only use for recorder-authored messages (for example diagnostics/errors).
  // User names, notes, card text and raw Battle Log must bypass this function.
  let patterns, reverse;
  function message(source) {
    if (typeof source !== 'string' || !source) return source || '';
    if (Object.hasOwn(catalog(), source)) return t(source);
    if (!reverse) { reverse=new Map(); for(const[key,translations]of Object.entries(catalog()))for(const value of Object.values(translations))if(!reverse.has(value))reverse.set(value,key); }
    if (reverse.has(source)) return t(reverse.get(source));
    if ((language === 'en' && !/[\u3400-\u9fff]/.test(source)) || source.length > 4000) return source;
    if (!patterns) patterns = Object.entries(catalog()).filter(([key]) => /\{\d+\}/.test(key)).flatMap(([key, translations]) => [...new Set([key,...Object.values(translations)])].map(template => {
      const indices = [], escaped = template.split(/(\{\d+\})/).map(part => {
        if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1, -1))); return '([\\s\\S]*?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      return {key, indices, regex: new RegExp('^' + escaped + '$'), weight:template.replace(/\{\d+\}/g,'').length};
    })).sort((a,b) => b.weight-a.weight);
    for (const item of patterns) {
      const match = item.regex.exec(source);
      if (match) { const values = []; item.indices.forEach((index, i) => { values[index] = match[i + 1]; }); return t(item.key, ...values); }
    }
    return source;
  }
  // Structured recorder messages translate only authored templates. Parameters
  // remain literal, including player text and original browser errors.
  function status(value) {
    if (!Array.isArray(value?.messageParts) || !value.messageParts.length) return message(value?.message || '');
    return value.messageParts.filter(part => part && typeof part.source === 'string')
      .map(part => t(part.source, ...(Array.isArray(part.params) ? part.params : []))).join(' · ');
  }
  function notify() {
    for (const binding of bindings) binding();
    for (const listener of [...listeners]) { try { listener(language); } catch (error) { root.console?.error('Language render failed', error); } }
  }
  function change(next) { if (!LANGUAGES.includes(next) || next === language) return; language = next; notify(); }
  function init() {
    if (initialized) return pending;
    storage = root.chrome?.storage;
    if (!storage?.local?.get) return Promise.resolve(language);
    initialized = true;
    let revision = 0;
    storage.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !Object.hasOwn(changes, KEY)) return;
      revision += 1;
      change(LANGUAGES.includes(changes[KEY].newValue) ? changes[KEY].newValue : detect(root.navigator?.languages || [root.navigator?.language]));
    });
    const current = revision;
    pending = Promise.resolve().then(() => storage.local.get(KEY)).then(values => {
      if (revision === current && LANGUAGES.includes(values?.[KEY])) change(values[KEY]);
      return language;
    }).catch(() => language);
    return pending;
  }
  async function setLanguage(next) {
    if (!LANGUAGES.includes(next)) throw new RangeError('Unsupported interface language');
    await init();
    if (storage?.local?.set) await storage.local.set({[KEY]:next});
    change(next);
    return language;
  }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function applyStatic(scope) {
    const nodes = [scope, ...scope.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-placeholder], [data-i18n-aria-label]')];
    for (const node of nodes) {
      if (!node?.getAttribute) continue;
      const source = node.getAttribute('data-i18n');
      if (source !== null) {
        const previous = staticValues.get(node);
        // A busy/status renderer may have replaced this initial HTML label.
        if (node.textContent === source || node.textContent === previous) {
          node.textContent = t(source); staticValues.set(node,node.textContent);
        }
      }
      for (const name of ['title','placeholder','aria-label']) {
        const value = node.getAttribute('data-i18n-' + name);
        if (value !== null) node.setAttribute(name, t(value));
      }
    }
    if (scope.nodeType === 9) scope.documentElement.lang = language === 'en' ? 'en' : language === 'zh-CN' ? 'zh-Hans' : 'zh-Hant';
  }
  // Capture only the authored, initial UI before any match/user data is rendered.
  // Later dynamic fields are left to their own render function.
  function captureStatic(scope) {
    const records = [], data = catalog(), reverse = new Map();
    for (const [source, translations] of Object.entries(data)) {
      reverse.set(source, source);
      for (const value of Object.values(translations)) if (!reverse.has(value)) reverse.set(value, source);
    }
    function visit(node) {
      if (node.nodeType === 3) {
        const value = node.nodeValue, trimmed = value.trim(), source = reverse.get(trimmed);
        if (source) records.push({node, source, prefix:value.slice(0,value.indexOf(trimmed)), suffix:value.slice(value.indexOf(trimmed)+trimmed.length), last:value});
      } else if (node.nodeType === 1) {
        if (['STYLE','SCRIPT','TEXTAREA'].includes(node.tagName) || node.getAttribute('translate') === 'no') return;
        for (const name of ['title','placeholder','aria-label']) {
          const value = node.getAttribute(name), source = reverse.get(value);
          if (source) records.push({node, source, name, last:value});
        }
      }
      for (const child of node.childNodes || []) visit(child);
    }
    visit(scope);
    const render = () => {
      for (const record of records) {
        const current = record.name ? record.node.getAttribute(record.name) : record.node.nodeValue;
        if (current !== record.last) continue;
        const next = (record.prefix || '') + t(record.source) + (record.suffix || '');
        if (record.name) record.node.setAttribute(record.name, next); else record.node.nodeValue = next;
        record.last = next;
      }
    };
    bindings.add(render);
    return () => bindings.delete(render);
  }
  async function mount(scope, render) {
    await init();
    applyStatic(scope);
    const selects = [...scope.querySelectorAll('[data-language-select]')];
    const update = () => { applyStatic(scope); for (const select of selects) select.value = language; render?.(); };
    for (const select of selects) {
      select.value = language;
      select.addEventListener('change', async () => {
        select.disabled = true;
        try { await setLanguage(select.value); }
        catch (_) { select.value = language; root.alert?.(t('語言設定未能儲存，請再試一次。')); }
        finally { select.disabled = false; }
      });
    }
    return subscribe(update);
  }
  init();
  return Object.freeze({KEY, languages:Object.freeze(LANGUAGES), t, message, status, detect, ready:init, setLanguage, subscribe, applyStatic, captureStatic, mount,
    get language(){return language;}, get htmlLanguage(){return language==='en'?'en':language==='zh-CN'?'zh-Hans':'zh-Hant';},
    get cardLocale(){return language==='en'?'en':'zh-tw';}});
});
