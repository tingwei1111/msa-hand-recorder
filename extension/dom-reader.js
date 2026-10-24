(function (root) {
  'use strict';
  const core = root.MSARecorderCore;
  const SELECTORS = Object.freeze({
    hand: '[class*="_handContainer_"]',
    player: '[class*="_playerInfoContainer_"]',
    name: '[class*="_playerInfoBadge_"]',
    phase: '[class*="_playerInfoPhase_"]',
    grid: '[class*="_gridContainer_"]',
    battle: '[class*="_battleAreaBox_"]'
  });
  function rendered(element) {
    if (!element || !element.isConnected) return false;
    const view = element.ownerDocument.defaultView;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const css = view.getComputedStyle(node);
      if (node.hidden || css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) === 0) return false;
    }
    return true;
  }
  function faceUp(element) {
    const flip = element.closest('[data-flippable-card]');
    if (!flip) return true;
    const view = element.ownerDocument.defaultView;
    try {
      const transform = view.getComputedStyle(flip).transform;
      if (transform && transform !== 'none') return new view.DOMMatrixReadOnly(transform).m33 > 0.01;
    } catch (_) { return false; }
    return true;
  }
  function readHand(container) {
    const counter = container.querySelector('button.info-counter-button');
    const countText = (counter?.textContent || '').trim();
    const reportedCount = /^\d{1,2}$/.test(countText) ? Number(countText) : null;
    const slots = [...container.querySelectorAll('[data-layout-id]')]
      .filter(node => node.querySelector('img') && !node.parentElement?.closest('[data-layout-id]'));
    const refs = new Map();
    let animating = Boolean(container.querySelector('.is-animating'));
    try { animating ||= container.getAnimations({subtree:true}).some(animation => animation.playState === 'running'); }
    catch (_) { /* Some Chromium builds do not expose subtree animation queries. */ }
    const motionSignature = slots.map(slot => [slot.style.transform,slot.style.opacity,
      slot.querySelector('[data-flippable-card]')?.style.transform || ''].join(':')).join('|');
    for (const slot of slots) {
      const ref = slot.getAttribute('data-layout-id');
      const codes = new Set();
      for (const img of slot.querySelectorAll('img')) {
        if (img.closest('.card-back') || !rendered(img) || !faceUp(img)) continue;
        const code = core.normalizeCardCode(img.getAttribute('src') || '');
        if (code) codes.add(code);
      }
      if (!refs.has(ref)) refs.set(ref, new Set());
      for (const code of codes) refs.get(ref).add(code);
    }
    const cardCodes = [];
    let unknownSlots = 0;
    for (const codes of refs.values()) {
      if (codes.size === 1) cardCodes.push([...codes][0]);
      else unknownSlots += 1;
    }
    const hand = core.countCards(cardCodes);
    const knownCount = cardCodes.length;
    // MSA only renders the lower hand counter for spectators. A participating
    // player's hand is counted by its unique card wrappers, including unknowns.
    const expectedCount = reportedCount ?? refs.size;
    const unknownCount = Math.max(unknownSlots, expectedCount - knownCount, 0);
    const coherent = refs.size === expectedCount && knownCount === expectedCount;
    const quality = coherent ? 'complete' : knownCount ? 'partial' : 'unavailable';
    return {hand, knownCount, expectedCount, unknownCount, quality, slotCount: refs.size,
      hasCounter: reportedCount !== null, animating, motionSignature,
      reason: coherent ? (reportedCount === null ? 'visible-hand-dom-slots' : 'visible-hand-counter') :
        refs.size !== expectedCount ? 'layout-transition' : 'card-back-or-unreadable'};
  }
  function readDocument(doc) {
    const hands = [...doc.querySelectorAll(SELECTORS.hand)];
    const players = [...doc.querySelectorAll(SELECTORS.player)].slice(0, 2);
    const grids = [...doc.querySelectorAll(SELECTORS.grid)];
    const names = players.map(el => (el.querySelector(SELECTORS.name)?.textContent || '').trim());
    const ended = [...doc.querySelectorAll('h1,h2')].some(el => /Game\s+Ended|Winner:/i.test(el.textContent || ''));
    const activeGrids = grids.filter(grid => grid.querySelector(SELECTORS.battle)?.style.zIndex === '10');
    const activeIndex = activeGrids.length === 1 ? (activeGrids[0].classList.contains('top') ? 0 : 1) : -1;
    const phaseEl = activeIndex >= 0 ? players[activeIndex]?.querySelector(SELECTORS.phase) : null;
    const phase = phaseEl && rendered(phaseEl) ? (phaseEl.textContent || '').trim().replace(/\s+/g, ' ') : '';
    const logHeading = [...doc.querySelectorAll('h1,h2,h3')].find(el => /Mobile Suit Arena\s*-\s*Battle logs/i.test(el.textContent || ''));
    const logBox = logHeading?.closest('[role="dialog"],section,[class*="Modal-content"],[class*="Drawer-content"]');
    const logText = logBox && rendered(logBox) ? logBox.innerText || '' : '';
    const turns = [...logText.matchAll(/Turn\s+(\d+)\s+started!/g)].map(match => Number(match[1]));
    const logTurn = turns.length ? Math.max(...turns) : null;
    const candidates = hands.slice(0, 2).map((container, index) => {
      const side = index === 0 ? 'top' : 'bottom';
      const grid = grids.find(el => el.classList.contains('top') === (side === 'top'));
      const resourceText = [...(grid?.querySelectorAll('button') || [])].map(el => el.textContent || '').find(text => /Lv\.\s*\d+/.test(text));
      return {side, playerName: names[index] || '', ...readHand(container),
        resources: core.parseResources(resourceText)};
    });
    return {candidates, ended, phase, logTurn, activePlayer: activeIndex < 0 ? null : names[activeIndex] || null,
      activeSide: activeIndex < 0 ? null : activeIndex === 0 ? 'top' : 'bottom'};
  }
  // These selectors were verified against MSA v1.9.1's rendered controls.
  // Never substitute another button or a keyboard shortcut if the layout changes.
  function getBattleLogControls(doc) {
    const heading = [...doc.querySelectorAll('h1,h2,h3')].find(el => /Mobile Suit Arena\s*-\s*Battle logs/i.test(el.textContent || ''));
    const box = heading?.closest('[role="dialog"],section,[class*="Modal-content"],[class*="Drawer-content"]');
    const isOpen = Boolean(box && rendered(box));
    const otherDialog = [...doc.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(el => el !== box && rendered(el));
    const buttons = [...doc.querySelectorAll('button[class*="_logButton_"]')].filter(el => rendered(el) && !el.disabled);
    const closeButtons = isOpen ? [...box.querySelectorAll('button.mantine-Drawer-close, button.mantine-Modal-close')].filter(el => rendered(el) && !el.disabled) : [];
    return {isOpen, openButton: buttons.length === 1 ? buttons[0] : null,
      closeButton: closeButtons.length === 1 ? closeButtons[0] : null,
      blockedReason: otherDialog ? 'another-dialog-open' : !isOpen && buttons.length !== 1 ? 'log-control-unavailable' : ''};
  }
  // Only the rendered public drawer is a data source. The capture controller
  // may open its verified UI; it never calls the backend or inspects React state.
  function readBattleLog(doc) {
    const heading = [...doc.querySelectorAll('h1,h2,h3')].find(el => /Mobile Suit Arena\s*-\s*Battle logs/i.test(el.textContent || ''));
    const box = heading?.closest('[role="dialog"],section,[class*="Modal-content"],[class*="Drawer-content"]');
    if (!box || !rendered(box)) return null;
    const body = box.querySelector('.mantine-Drawer-body, .mantine-Modal-body');
    const list = body?.firstElementChild;
    const blocks = list ? [...list.children].filter(el => el.querySelector('p')) : [];
    const sideNames = new Map();
    // Consecutive rows from one player omit their name. Use the displayed
    // alignment of the speech bubbles, not the last system/actor paragraph.
    for (const block of blocks) {
      const label = [...block.children].find(el => el.tagName === 'P');
      if (label && rendered(label)) sideNames.set(block.style.alignItems, (label.textContent || '').trim());
    }
    const rows = blocks.length ? blocks.map((block, sourceIndex) => {
      const label = [...block.children].find(el => el.tagName === 'P');
      const text = [...block.querySelectorAll('p')].filter(el => el !== label && rendered(el)).map(el => el.innerText).join('\n').trim();
      const side = block.style.alignItems;
      return {sourceIndex, text,
        actor: ['flex-start','flex-end'].includes(side) ? sideNames.get(side) || '' : '',
        cards: [...block.querySelectorAll('a[href^="#"]')].filter(rendered).map(a => ({
          cardCode: core.normalizeCardCode(a.getAttribute('href')), name: (a.textContent || '').trim()
        }))};
    }) : [...box.querySelectorAll('p')].filter(rendered).map((p, sourceIndex) => ({
      sourceIndex, text: p.innerText.trim(), actor: '', cards: [...p.querySelectorAll('a[href^="#"]')].map(a => ({
        cardCode: core.normalizeCardCode(a.getAttribute('href')), name: (a.textContent || '').trim()
      }))
    }));
    const filtered = rows.filter(row => row.text);
    return {observedAt: new Date().toISOString(), rows: filtered, order: 'oldest-first',
      players: [...new Set(sideNames.values())].filter(Boolean),
      completeFromStart: blocks.length > 0 && filtered[0]?.text === 'Game started!',
      ended: filtered.at(-1)?.text === 'Game ended!',
      structure: blocks.length ? 'msa-drawer-v1' : 'paragraph-fallback'};
  }
  function selectHand(observation, settings, lockedSide) {
    let candidates = observation.candidates;
    if (settings.playerName?.trim()) candidates = candidates.filter(item => item.playerName === settings.playerName.trim());
    const side = settings.handSide !== 'auto' ? settings.handSide : lockedSide;
    if (side) return candidates.find(item => item.side === side) || null;
    // The participating player is rendered in the lower hand without a counter.
    // Opponent return-to-hand animations can briefly show faces: never auto-lock
    // that upper hand, and never treat spectator counters as player identity.
    const own = candidates.find(item => item.side === 'bottom' && !item.hasCounter);
    return own && own.knownCount > 0 ? own : null;
  }
  root.MSARecorderDOM = Object.freeze({SELECTORS, readHand, readDocument, readBattleLog, getBattleLogControls, selectHand});
})(globalThis);
