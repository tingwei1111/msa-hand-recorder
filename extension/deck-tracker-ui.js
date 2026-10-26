(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSADeckTrackerUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const l10n = (source, ...values) => globalThis.MSAI18n ? globalThis.MSAI18n.t(source, ...values) : String(source ?? '').replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index] ?? '') : match);

  const text = value => typeof value === 'string' ? value : '';
  const amount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const countText = value => amount(value) === null ? '?' : String(value);
  const codePattern = /^(?:(?:GD|ST|EB|SC|SLB)\d{2,3}|EXB|EXR|PR|P|R|T)-\d{3}$/;
  function handText(row) {
    const count = amount(row.handCount);
    return count === null || !['exact', 'at-least'].includes(row.handCountKind) ? '?' :
      row.handCountKind === 'at-least' ? '≥' + count : String(count);
  }
  function create(options) {
    options = options || {};
    const doc = options.document;
    if (!doc || typeof doc.createElement !== 'function') throw new TypeError(l10n('牌組追蹤介面需要 document。'));
    let model = {}, contextKey = '', generation = 0, destroyed = false;
    let binding = false, managing = false, draft = '', previousState = '';
    const deckRows = new Map(), optionRows = new Map(), publicSections = new Map();
    function node(tag, value, className) {
      const item = doc.createElement(tag);
      if (value !== undefined) item.textContent = String(value);
      if (className) item.className = className;
      return item;
    }
    function setText(item, value) {
      const next = value === undefined || value === null ? '' : String(value);
      if (item.textContent !== next) item.textContent = next;
    }
    function button(label, role) {
      const item = node('button', label); item.type = 'button'; item.dataset.role = role; return item;
    }
    const element = node('section', undefined, 'msa-deck-tracker');
    element.dataset.role = 'deck-tracker'; element.setAttribute('aria-label', l10n('本場牌組與公開卡牌追蹤'));
    const style = node('style');
    style.textContent = `
      .msa-deck-tracker { min-width:0; color:#f0f0f0; font:inherit; }
      .msa-deck-tracker [hidden] { display:none!important; }
      .msa-deck-tracker *, .msa-deck-tracker *::before, .msa-deck-tracker *::after { box-sizing:border-box; }
      .msa-deck-tracker p, .msa-deck-tracker h3, .msa-deck-tracker h4 { margin:0; }
      .msa-deck-tracker button, .msa-deck-tracker select { font:inherit; color:inherit; }
      .msa-deck-tracker button { cursor:pointer; }
      .msa-deck-tracker button:disabled { cursor:default; opacity:.5; }
      .msa-deck-tracker button:focus-visible, .msa-deck-tracker select:focus-visible, .msa-deck-tracker summary:focus-visible { outline:3px solid #eee; outline-offset:2px; }
      .msa-deck-tracker .dt-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:7px; }
      .msa-deck-tracker .dt-identity { min-width:0; }
      .msa-deck-tracker .dt-name { font-size:1.0833em; line-height:1.4; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-meta { font-size:.8333em; color:#a0a0a0; margin-top:3px; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-manage { flex-shrink:0; padding:4px 7px; min-height:28px; border:1px solid #444; border-radius:4px; background:#191919; font-size:.8333em; }
      .msa-deck-tracker .dt-stats { display:flex; align-items:baseline; flex-wrap:wrap; gap:4px 9px; padding:8px 9px; margin-bottom:9px; background:#252525; border-radius:4px; }
      .msa-deck-tracker .dt-rate { font-size:1.4167em; font-weight:500; color:#ddd; line-height:1.2; }
      .msa-deck-tracker .dt-stat-detail { font-size:.8333em; line-height:1.6; color:#aaa; }
      .msa-deck-tracker .dt-state, .msa-deck-tracker .dt-status { font-size:.8333em; line-height:1.6; margin:7px 0; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-status { border-left:3px solid #ddd; padding:6px 8px; background:#252525; border-radius:4px; }
      .msa-deck-tracker .dt-status.error { border-left-color:#ffaaa0; color:#edc782; background:#352e23; }
      .msa-deck-tracker .dt-binding { margin:8px 0 11px; border:1px solid #333; border-radius:4px; padding:7px 9px; background:#191919; }
      .msa-deck-tracker .dt-binding summary { cursor:pointer; font-size:.8333em; font-weight:650; }
      .msa-deck-tracker .dt-bind-form { margin-top:8px; display:grid; gap:7px; }
      .msa-deck-tracker .dt-bind-form label { display:grid; gap:4px; font-size:.8333em; }
      .msa-deck-tracker .dt-bind-select { width:100%; min-width:0; min-height:33px; border:1px solid #444; border-radius:4px; background:#191919; padding:5px; }
      .msa-deck-tracker .dt-bind-confirm { width:100%; min-height:34px; padding:6px 8px; border:1px solid #ddd; border-radius:4px; color:#111; background:#ddd; font-weight:650; }
      .msa-deck-tracker .dt-bind-note { font-size:.8333em; line-height:1.6; color:#a0a0a0; }
      .msa-deck-tracker .dt-list-header, .msa-deck-tracker .dt-card-row { display:grid; grid-template-columns:minmax(0,1fr) 31px 37px 46px; gap:4px; align-items:center; }
      .msa-deck-tracker .dt-list-header { font-size:.8333em; color:#a0a0a0; padding:5px 5px 5px 8px; text-align:center; border-bottom:1px solid #333; }
      .msa-deck-tracker .dt-list-header > :first-child { text-align:left; }
      .msa-deck-tracker .dt-card-row { min-height:37px; padding:3px 5px 3px 7px; border-left:3px solid transparent; border-bottom:1px solid #303030; background:#191919; font-size:.9167em; }
      .msa-deck-tracker .dt-card-row.in-hand { border-left-color:#ddd; background:#292929; }
      .msa-deck-tracker .dt-card-row.outside { border-left-color:#bf914c; background:#332d23; }
      .msa-deck-tracker .dt-card-row.known-zero .dt-card-code { color:#999; }
      .msa-deck-tracker .dt-card-control { min-height:30px; min-width:0; padding:2px 0; border:0; border-radius:3px; text-align:left; background:transparent; display:flex; flex-direction:column; align-items:flex-start; gap:1px; }
      .msa-deck-tracker .dt-card-control:hover { background:#333; }
      .msa-deck-tracker .dt-unknown-card:hover { background:transparent; }
      .msa-deck-tracker .dt-card-code { font:.9167em/1.45 ui-monospace,monospace; text-decoration:underline dotted #aaa; text-underline-offset:3px; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-card-name { font-size:.9167em; line-height:1.4; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-number { text-align:center; font-variant-numeric:tabular-nums; }
      .msa-deck-tracker .dt-number.dt-hand-count { font-weight:700; color:#ddd; }
      .msa-deck-tracker .dt-number.uncertain { color:#e6c489; }
      .msa-deck-tracker .dt-empty { padding:13px 9px; color:#a0a0a0; font-size:.8333em; line-height:1.7; border:1px dashed #444; border-radius:4px; }
      .msa-deck-tracker .dt-public, .msa-deck-tracker .dt-audit { border-top:1px solid #333; margin-top:10px; padding-top:8px; }
      .msa-deck-tracker .dt-public summary, .msa-deck-tracker .dt-audit summary { cursor:pointer; font-size:.8333em; font-weight:650; }
      .msa-deck-tracker .dt-public-list { margin-top:5px; }
      .msa-deck-tracker .dt-public-row { display:grid; grid-template-columns:minmax(0,1fr) 40px; align-items:center; gap:7px; padding:3px 4px; border-bottom:1px solid #303030; }
      .msa-deck-tracker .dt-public-count { text-align:right; font-size:.8333em; font-variant-numeric:tabular-nums; }
      .msa-deck-tracker .dt-actor { font-size:.8333em; color:#a0a0a0; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-audit-body { margin-top:6px; font-size:.8333em; color:#a0a0a0; line-height:1.7; overflow-wrap:anywhere; }
      .msa-deck-tracker .dt-audit-body p + p { margin-top:6px; }
      .msa-deck-tracker .dt-warnings { padding-left:16px; margin:6px 0 0; }
    `;
    const heading = node('div', undefined, 'dt-heading'), identity = node('div', undefined, 'dt-identity');
    const title = node('h3', l10n('本場牌組'), 'dt-name'); title.dataset.role = 'tracker-deck-name';
    const meta = node('p', '', 'dt-meta'); meta.dataset.role = 'tracker-deck-meta';
    const manage = button(l10n('管理牌組'), 'tracker-manage'); manage.className = 'dt-manage';
    identity.append(title, meta); heading.append(identity, manage);
    const statistics = node('div', undefined, 'dt-stats'), rate = node('strong', '—', 'dt-rate'), statDetail = node('p', '', 'dt-stat-detail');
    statistics.dataset.role = 'tracker-stats'; rate.dataset.role = 'tracker-win-rate'; statistics.append(rate, statDetail);
    const stateLine = node('p', '', 'dt-state'); stateLine.dataset.role = 'tracker-state';
    const status = node('p', '', 'dt-status'); status.dataset.role = 'tracker-status'; status.hidden = true; status.setAttribute('role', 'status');
    const bindingDetails = node('details', undefined, 'dt-binding'), bindingSummary = node('summary', l10n('選擇本場牌組'));
    bindingDetails.dataset.role = 'tracker-binding';
    const form = node('form', undefined, 'dt-bind-form'), selectLabel = node('label', l10n('選擇已保存的牌組版本'));
    const select = node('select', undefined, 'dt-bind-select'); select.dataset.role = 'tracker-deck-select';
    const placeholder = node('option', l10n('請選擇本場使用的牌組')); placeholder.value = ''; select.append(placeholder); selectLabel.append(select);
    const bindIdentity = node('p', '', 'dt-bind-note'), confirm = button(l10n('確認綁定本場牌組'), 'tracker-bind');
    confirm.type = 'submit'; confirm.className = 'dt-bind-confirm';
    form.append(selectLabel, bindIdentity, confirm); bindingDetails.append(bindingSummary, form);
    const listHeading = node('div', undefined, 'dt-list-header'); listHeading.dataset.role = 'tracker-column-headings';
    for (const label of [l10n('完整牌組'), l10n('牌表'), l10n('手牌'), l10n('公開使用')]) listHeading.append(node('span', label));
    const list = node('div'); list.dataset.role = 'tracker-card-list'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', l10n('完整牌組卡號與已觀察數量'));
    const empty = node('p', '', 'dt-empty'); empty.dataset.role = 'tracker-empty';
    const audit = node('details', undefined, 'dt-audit'), auditSummary = node('summary', l10n('數量與來源說明'));
    audit.dataset.role = 'tracker-audit';
    const auditBody = node('div', undefined, 'dt-audit-body'), handNote = node('p'), publicNote = node('p');
    const fixedNote = node('p', l10n('「手牌」只取本段已存觀察；≥ 表示至少觀察到的張數，? 表示未知。公開使用為累計次數，可能超過牌表張數；不表示精確剩餘牌庫。'));
    const warnings = node('ul', undefined, 'dt-warnings'); warnings.dataset.role = 'tracker-warnings';
    auditBody.append(handNote, publicNote, fixedNote, warnings); audit.append(auditSummary, auditBody);
    element.append(style, heading, statistics, stateLine, status, bindingDetails, listHeading, list, empty);

    const groups = [['own', l10n('本人公開使用')], ['opponent', l10n('對手公開使用')], ['unknown', l10n('待核對的公開使用')], ['tokens', l10n('Token 生成（不計手牌出牌）')]];
    for (const [key, label] of groups) {
      const details = node('details', undefined, 'dt-public'), summary = node('summary', label), rows = node('div', undefined, 'dt-public-list');
      details.dataset.role = 'tracker-public-' + key; rows.setAttribute('role', 'list'); rows.setAttribute('aria-label', label);
      details.append(summary, rows); element.append(details);
      publicSections.set(key, {details, summary, rows, label, items:new Map()});
    }
    element.append(audit);

    function say(message, error) {
      setText(status, message); status.hidden = !message; status.classList.toggle('error', Boolean(error));
    }
    function selectionItems() { return Array.isArray(model.availableDecks) ? model.availableDecks.filter(item => text(item?.id)) : []; }
    function controls() {
      const valid = selectionItems().some(item => item.id === draft);
      select.disabled = destroyed || binding || model.canBind !== true || !selectionItems().length;
      confirm.disabled = destroyed || binding || model.canBind !== true || !valid;
      setText(confirm, binding ? l10n('正在綁定…') : l10n('確認綁定本場牌組'));
      form.setAttribute('aria-busy', String(binding));
      manage.disabled = destroyed || managing || typeof options.onManage !== 'function';
      setText(manage, managing ? l10n('開啟中…') : l10n('管理牌組'));
    }
    select.addEventListener('change', () => { if (!destroyed) { draft = select.value; controls(); } });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (destroyed || binding || model.canBind !== true || !selectionItems().some(item => item.id === draft)) return;
      if (typeof options.onBindDeck !== 'function') { say(l10n('本場牌組綁定服務尚未載入。'), true); return; }
      const token = generation, selected = draft;
      binding = true; say(l10n('正在保存本人本場使用的牌組版本…')); controls();
      try {
        const result = await options.onBindDeck({deckVersionId:selected, confirmed:true});
        if (destroyed || token !== generation) return;
        if (result?.ok !== true) throw new Error(result?.reason || result?.error || l10n('未收到牌組綁定成功的確認。'));
        say(l10n('本場牌組已綁定；結果可於賽後管理確認。'));
      } catch (error) { if (!destroyed && token === generation) say(l10n('牌組尚未確認綁定：') + String(error?.message || error), true); }
      finally { if (!destroyed && token === generation) { binding = false; controls(); } }
    });
    manage.addEventListener('click', async () => {
      if (destroyed || managing || typeof options.onManage !== 'function') return;
      const token = generation; managing = true; controls();
      try {
        const result = await options.onManage();
        if (!destroyed && token === generation && result?.ok !== true) throw new Error(result?.reason || result?.error || l10n('未收到資料管理頁開啟確認。'));
      } catch (error) { if (!destroyed && token === generation) say(l10n('未能開啟牌組管理：') + String(error?.message || error), true); }
      finally { if (!destroyed && token === generation) { managing = false; controls(); } }
    });
    function cardControl(code) {
      const control = button('', 'tracker-card-control'); control.className = 'dt-card-control'; control.dataset.cardCode = code;
      const codeNode = node('span', code, 'dt-card-code'), name = node('span', '', 'dt-card-name'); control.append(codeNode, name);
      if (typeof options.onCardControl === 'function') options.onCardControl(control, code);
      return {control, codeNode, name};
    }
    function publicControl(code) {
      if (code) return cardControl(code);
      const control = node('div', undefined, 'dt-card-control dt-unknown-card'); control.dataset.role = 'tracker-unknown-card';
      const codeNode = node('span', l10n('卡號未辨識'), 'dt-card-code'), name = node('span', '', 'dt-card-name'); control.append(codeNode, name);
      return {control, codeNode, name};
    }
    function reorder(parent, item, index) { if (parent.children[index] !== item) parent.insertBefore(item, parent.children[index] || null); }
    function updateOptions() {
      const entries = selectionItems(), present = new Set();
      entries.forEach((deck, index) => {
        present.add(deck.id); let item = optionRows.get(deck.id);
        if (!item) { item = node('option'); item.value = deck.id; optionRows.set(deck.id, item); }
        setText(item, (text(deck.name) || l10n('未命名牌組')) + ' · ' + deck.id.slice(-12)); reorder(select, item, index + 1);
      });
      for (const [id, item] of optionRows) if (!present.has(id)) { item.remove(); optionRows.delete(id); }
      if (draft && !present.has(draft)) { draft = ''; if (!binding) say(l10n('原選牌組版本已不在可選清單；請重新選擇。'), true); }
      if (select.value !== draft) select.value = draft;
    }
    function updateRows() {
      const entries = Array.isArray(model.rows) ? model.rows.filter(row => codePattern.test(text(row?.cardCode))) : [], present = new Set();
      entries.forEach((row, index) => {
        const key = row.cardCode; if (present.has(key)) return; present.add(key);
        let item = deckRows.get(key);
        if (!item) {
          const root = node('div', undefined, 'dt-card-row'), control = cardControl(key);
          root.dataset.role = 'tracker-card-row'; root.dataset.cardCode = key; root.setAttribute('role', 'listitem');
          const deck = node('span', '', 'dt-number'), hand = node('span', '', 'dt-number dt-hand-count'), used = node('span', '', 'dt-number');
          deck.dataset.column = 'deck'; hand.dataset.column = 'hand'; used.dataset.column = 'public';
          root.append(control.control, deck, hand, used); item = {root, ...control, deck, hand, used}; deckRows.set(key, item);
        }
        setText(item.name, text(row.name)); item.name.hidden = !text(row.name);
        item.control.setAttribute('aria-label', key + (text(row.name) ? ' ' + row.name : '') + l10n('，查看官方卡片資料'));
        setText(item.deck, row.outsideDeck ? '—' : countText(row.deckCount));
        setText(item.hand, handText(row)); setText(item.used, countText(row.publicUseCount));
        item.root.classList.toggle('outside', row.outsideDeck === true);
        item.root.classList.toggle('in-hand', amount(row.handCount) > 0);
        item.root.classList.toggle('known-zero', row.handCountKind === 'exact' && row.handCount === 0);
        item.hand.classList.toggle('uncertain', row.handCountKind !== 'exact');
        item.root.dataset.handKind = text(row.handCountKind);
        item.root.title = row.outsideDeck ? l10n('牌表外的已觀察卡號，不計入主牌張數。') : l10n('牌表張數／最近已存手牌／累計公開使用次數。');
        reorder(list, item.root, index);
      });
      for (const [key, item] of deckRows) if (!present.has(key)) { item.root.remove(); deckRows.delete(key); }
      listHeading.hidden = !entries.length; list.hidden = !entries.length; empty.hidden = entries.length > 0;
      setText(empty, model.state === 'loading' ? l10n('牌組資料載入中，手牌與公開事件仍可切換查看。') : model.state === 'error' ? l10n('請重新載入擴充功能後重整 MSA；不會改寫已有對局資料。') : model.state === 'identity-unknown' ? l10n('尚未確認本人玩家，請先核對自己的手牌身分。') :
        model.state === 'invalid' ? l10n('目前綁定或來源待核對；請到牌組管理檢查。') : l10n('選擇並確認本場牌組後，這裡會顯示完整牌表。'));
    }
    function updatePublic() {
      for (const [key, group] of publicSections) {
        const entries = Array.isArray(model.publicCards?.[key]) ? model.publicCards[key].filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
        const present = new Set(); let total = 0, valid = true;
        entries.forEach((row, index) => {
          const code = codePattern.test(text(row.cardCode)) ? row.cardCode : null;
          const id = JSON.stringify([code, text(row.actor), code ? '' : text(row.name)]); if (present.has(id)) return; present.add(id);
          const count = amount(row.count); if (count === null) valid = false; else total += count;
          let item = group.items.get(id);
          if (!item) {
            const root = node('div', undefined, 'dt-public-row'), card = publicControl(code), label = node('div'), actor = node('p', '', 'dt-actor'), count = node('span', '', 'dt-public-count');
            root.dataset.role = 'tracker-public-row'; root.dataset.cardCode = code || ''; root.setAttribute('role', 'listitem'); label.append(card.control, actor); root.append(label, count);
            item = {root, ...card, actor, count}; group.items.set(id, item);
          }
          setText(item.name, text(row.name)); item.name.hidden = !text(row.name);
          setText(item.actor, text(row.actor)); item.actor.hidden = !text(row.actor);
          setText(item.count, '× ' + countText(row.count));
          if (code) item.control.setAttribute('aria-label', code + (text(row.name) ? ' ' + row.name : '') + l10n('，查看官方卡片資料'));
          reorder(group.rows, item.root, index);
        });
        for (const [id, item] of group.items) if (!present.has(id)) { item.root.remove(); group.items.delete(id); }
        setText(group.summary, (globalThis.MSAI18n?.message(group.label)||group.label) + ' · ' + (valid && Number.isSafeInteger(total) ? total : '?') + (key === 'tokens' ? l10n(' 次生成') : l10n(' 次')));
        group.details.hidden = !entries.length;
      }
    }
    function update(next) {
      if (destroyed) return;
      const focusRoot = element.getRootNode?.(), focused = focusRoot?.activeElement || doc.activeElement;
      const focusInside = Boolean(focused && element.contains?.(focused));
      const scrollTop = element.scrollTop;
      model = next && typeof next === 'object' ? next : {};
      const nextKey = JSON.stringify([text(model.contextKey) || text(model.sessionId),text(model.gameId),text(model.playerName)]);
      if (nextKey !== contextKey) { contextKey = nextKey; generation += 1; draft = ''; binding = false; managing = false; previousState = ''; say(''); }
      const bound = model.state === 'bound' && model.deck && text(model.deck.id);
      element.dataset.state = text(model.state);
      setText(title, bound ? text(model.deck.name) || l10n('未命名牌組') : model.state === 'loading' ? l10n('牌組核心載入中') : model.state === 'error' ? l10n('牌組核心無法使用') : l10n('本場尚未選擇牌組'));
      setText(meta, (text(model.playerName) ? l10n('玩家 ') + model.playerName : l10n('本人身分待確認')) + (bound ? l10n(' · 主牌 ') + countText(model.deck.mainCount) + l10n(' 張 · 版本 ') + model.deck.id.slice(-12) : ''));
      const stats = model.stats || {}, wins = amount(stats.wins), losses = amount(stats.losses), concedes = amount(stats.concedes), confirmed = amount(stats.confirmed);
      setText(rate, typeof stats.winRate === 'number' && Number.isFinite(stats.winRate) && stats.winRate >= 0 && stats.winRate <= 1 ? (stats.winRate * 100).toFixed(1) + '%' : '—');
      setText(statDetail, confirmed > 0 ? l10n("本版本人工戰績 {0} 場 · {1} 勝／{2} 負／{3} 和{4}", confirmed, countText(wins), losses !== null && concedes !== null ? losses + concedes : '?', countText(stats.draws), concedes ? l10n(' · 本人投降 ') + concedes : '') : l10n('本版本尚無人工確認戰績'));
      statistics.hidden = !bound;
      setText(stateLine, (globalThis.MSAI18n?.message(text(model.stateDetail))||text(model.stateDetail))); stateLine.hidden = !(globalThis.MSAI18n?.message(text(model.stateDetail))||text(model.stateDetail)) || bound;
      setText(bindingSummary, bound ? l10n('重新選擇本場牌組') : l10n('選擇本場牌組'));
      bindingDetails.hidden = model.canBind !== true;
      if (previousState !== model.state && !bound) bindingDetails.open = true;
      else if (previousState !== model.state && bound) bindingDetails.open = false;
      previousState = model.state;
      setText(bindIdentity, l10n('本場玩家：') + (text(model.playerName) || l10n('尚未確認')) + l10n('。按確認代表這是本人本場使用的牌組；不會自動確認勝負。'));
      updateOptions(); updateRows(); updatePublic(); controls();
      setText(handNote, (globalThis.MSAI18n?.message(text(model.handNote))||text(model.handNote))); handNote.hidden = !(globalThis.MSAI18n?.message(text(model.handNote))||text(model.handNote));
      setText(publicNote, text(model.publicNote).split(/(?<=[。])/).map(value=>globalThis.MSAI18n?.message(value)||value).join('')); publicNote.hidden = !text(model.publicNote).split(/(?<=[。])/).map(value=>globalThis.MSAI18n?.message(value)||value).join('');
      const warningRows = (Array.isArray(model.warnings) ? model.warnings : []).filter(value => typeof value === 'string' && value);
      warnings.replaceChildren(...warningRows.map(value => node('li', globalThis.MSAI18n?.message(value)||value))); warnings.hidden = !warningRows.length;
      setText(auditSummary, l10n('數量與來源說明') + (warningRows.length ? ' · ' + warningRows.length + l10n(' 項待核對') : ''));
      element.scrollTop = scrollTop;
      if (focusInside && focused.isConnected && !focused.disabled && (focusRoot?.activeElement || doc.activeElement) !== focused) focused.focus({preventScroll:true});
    }
    const unbindLanguage=globalThis.MSAI18n?.captureStatic(element);
    const unsubscribeLanguage=globalThis.MSAI18n?.subscribe(()=>update(model));
    update({});
    return {element, update, destroy() { if (destroyed) return; destroyed = true; generation += 1; unbindLanguage?.();unsubscribeLanguage?.();element.remove(); }};
  }
  return Object.freeze({create});
});
