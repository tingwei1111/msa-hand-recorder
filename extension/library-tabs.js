(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSALibraryTabs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SECTIONS = Object.freeze(['matches', 'decks', 'statistics', 'restore']);

  function sectionFromHash(hash) {
    let id;
    try { id = decodeURIComponent(String(hash || '').replace(/^#/, '')); }
    catch (_) { return 'matches'; }
    return SECTIONS.includes(id) ? id : 'matches';
  }

  function mount({document: doc, window: win}) {
    if (!doc || !win) throw new TypeError('Library tabs need a document and window');
    const entries = SECTIONS.map(id => ({id, tab:doc.getElementById('tab-' + id), panel:doc.getElementById(id)}));
    if (entries.some(({tab, panel}) => !tab || !panel)) throw new Error('Library tab markup is incomplete');
    let selected = '', disposed = false;
    const removers = [];

    function activate(id, {focus = false, navigate = false} = {}) {
      if (disposed || !SECTIONS.includes(id)) return;
      const previous = entries.find(entry => entry.id === selected);
      // Moving through browser history must not leave focus in a hidden form.
      const hiddenFocus = previous && previous.id !== id && previous.panel.contains(doc.activeElement);
      selected = id;
      for (const entry of entries) {
        const active = entry.id === id;
        entry.tab.setAttribute('aria-selected', String(active));
        entry.tab.tabIndex = active ? 0 : -1;
        entry.panel.hidden = !active;
      }
      if (navigate && win.location.hash !== '#' + id) {
        win.history.pushState(null, '', win.location.pathname + win.location.search + '#' + id);
      }
      if (focus || hiddenFocus) entries.find(entry => entry.id === id).tab.focus({preventScroll:true});
    }

    function listen(target, type, listener) {
      target.addEventListener(type, listener);
      removers.push(() => target.removeEventListener(type, listener));
    }
    for (const {id, tab} of entries) {
      listen(tab, 'click', () => activate(id, {navigate:true}));
      listen(tab, 'keydown', event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const index = SECTIONS.indexOf(id);
        let target;
        if (event.key === 'ArrowRight') target = SECTIONS[(index + 1) % SECTIONS.length];
        else if (event.key === 'ArrowLeft') target = SECTIONS[(index + SECTIONS.length - 1) % SECTIONS.length];
        else if (event.key === 'Home') target = SECTIONS[0];
        else if (event.key === 'End') target = SECTIONS.at(-1);
        if (!target) return;
        event.preventDefault();
        activate(target, {focus:true, navigate:true});
      });
    }
    const followLocation = () => activate(sectionFromHash(win.location.hash));
    listen(win, 'hashchange', followLocation);
    listen(win, 'popstate', followLocation);
    followLocation();
    return Object.freeze({
      activate,
      get selected() { return selected; },
      destroy() { disposed = true; removers.forEach(remove => remove()); }
    });
  }
  return Object.freeze({SECTIONS, sectionFromHash, mount});
});
