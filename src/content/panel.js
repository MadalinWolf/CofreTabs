/**
 * CofreTabs in-page slide-over panel.
 *
 * Injected on demand by the service worker via chrome.scripting (activeTab
 * only). The UI lives in a Shadow DOM so page styles cannot leak in
 * and panel styles cannot leak out. All data is rendered with textContent.
 *
 * This file runs as a classic content script and therefore cannot use ES
 * module imports. Message names mirror src/lib/messages.js.
 */
(() => {
  'use strict';

  const HOST_ID = 'cofretabs-panel-host';
  const MSG = {
    PANEL_INIT: 'cofre:panel-init',
    PANEL_PING: 'cofre:panel-ping',
    PANEL_CLOSE: 'cofre:panel-close',
    SAVE_TAB: 'cofre:save-tab',
    PANEL_SNAPSHOT: 'cofre:panel-snapshot',
    SEARCH: 'cofre:search',
    TRASH_TAB: 'cofre:trash-tab',
    OPEN_URL: 'cofre:open-url',
    OPEN_LIBRARY: 'cofre:open-library',
  };
  const SAVE_MIN_ANIMATION_MS = 360;

  if (window.__cofreTabsPanel && window.__cofreTabsPanel.open) return;

  const state = {
    open: false,
    busy: false,
    page: null,
    existing: null,
    snapshot: null,
    results: null,
    query: '',
    version: '1.0.0',
    host: null,
    shadow: null,
    panel: null,
    els: {},
    previouslyFocused: null,
    searchTimer: 0,
    searchSeq: 0,
    closeTimer: 0,
    messageListener: null,
  };

  // ---------------------------------------------------------------- utilities

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.append(child);
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function brandMark() {
    const svg = svgEl('svg', {
      viewBox: '0 0 24 24',
      width: '22',
      height: '22',
      'aria-hidden': 'true',
      focusable: 'false',
      class: 'ct-mark',
    });
    svg.append(
      svgEl('path', {
        d: 'M4 2.75h12.2L20 6.55V21.25H4z',
        fill: '#101610',
        stroke: '#39FF72',
        'stroke-width': '1.4',
        'stroke-linejoin': 'round',
      }),
      svgEl('path', { d: 'M14.1 2.9v4.2h4.1', fill: 'none', stroke: '#20C85A', 'stroke-width': '1.2' }),
      svgEl('rect', { x: '6.4', y: '10.4', width: '11.2', height: '8.4', fill: 'none', stroke: '#20C85A', 'stroke-width': '1' }),
      svgEl('path', { d: 'M8.2 12.7l2.2 1.9-2.2 1.9', fill: 'none', stroke: '#39FF72', 'stroke-width': '1.5' }),
      svgEl('path', { d: 'M12.4 16.5h3.5', stroke: '#39FF72', 'stroke-width': '1.5' }),
    );
    return svg;
  }

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function send(message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };
      try {
        const maybePromise = chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) finish(reject, new Error(error.message || 'The extension did not respond.'));
          else finish(resolve, response);
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(
            (value) => finish(resolve, value),
            (error) => finish(reject, error),
          );
        }
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function prettyUrl(value) {
    const text = String(value || '');
    const stripped = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    return stripped.length > 96 ? `${stripped.slice(0, 95)}\u2026` : stripped;
  }

  function monogram(hostname) {
    const cleaned = String(hostname || '').replace(/^www\./i, '');
    const match = cleaned.match(/[a-z0-9]/i);
    return match ? match[0].toUpperCase() : '>';
  }

  function timeAgo(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return 'just now';
    const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
    if (seconds < 45) return 'just now';
    if (seconds < 90) return '1 min ago';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} d ago`;
    try {
      return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return 'saved earlier';
    }
  }

  function announce(message, assertive = false) {
    const node = assertive ? state.els.srAlert : state.els.srStatus;
    if (!node) return;
    node.textContent = '';
    // A tick allows repeated identical announcements to be read again.
    setTimeout(() => {
      node.textContent = message;
    }, 20);
  }

  // ------------------------------------------------------------------- styles

  async function loadStyles() {
    const url = chrome.runtime.getURL('src/styles/panel.css');
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { css: await response.text(), link: null };
    } catch {
      // Fall back to a stylesheet link; still works in most browsers.
      return { css: '', link: url };
    }
  }

  // --------------------------------------------------------------------- view

  function build(data, styles) {
    state.page = data.page;
    state.existing = data.existing;
    state.snapshot = data.snapshot;
    state.version = data.version || '1.0.0';
    state.previouslyFocused = document.activeElement;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-cofretabs-panel', '');
    const shadow = host.attachShadow({ mode: 'open' });

    if (styles.css) shadow.append(el('style', { text: styles.css }));
    if (styles.link) shadow.append(el('link', { rel: 'stylesheet', href: styles.link }));

    const closeBtn = el('button', {
      class: 'ct-close',
      type: 'button',
      'aria-label': 'Close CofreTabs panel',
      title: 'Close (Esc)',
    }, [document.createTextNode('\u00d7')]);

    const brandTitle = el('span', { class: 'ct-title', id: 'ct-panel-title', text: 'COFRETABS' });
    const versionChip = el('span', { class: 'ct-version', text: `v${state.version}` });

    const header = el('header', { class: 'ct-header' }, [
      el('div', { class: 'ct-brand' }, [brandMark(), brandTitle, versionChip]),
      closeBtn,
    ]);

    const faviconWrap = el('div', { class: 'ct-favicon', 'aria-hidden': 'true' });
    const pageTitle = el('div', { class: 'ct-page-title' });
    const pageUrl = el('div', { class: 'ct-page-url' });
    const pageCard = el('div', { class: 'ct-page-card' }, [
      faviconWrap,
      el('div', { class: 'ct-page-text' }, [pageTitle, pageUrl]),
    ]);

    const saveBtn = el('button', { class: 'ct-save-btn', type: 'button', id: 'ct-save-btn' });
    const terminal = el('div', {
      class: 'ct-terminal',
      id: 'ct-terminal',
      role: 'status',
      'aria-live': 'polite',
      'aria-relevant': 'additions text',
    });

    const existingBanner = el('div', { class: 'ct-existing', hidden: true });

    const saveSection = el('section', { class: 'ct-section ct-save-section', 'aria-labelledby': 'ct-save-heading' }, [
      el('h2', { class: 'ct-label', id: 'ct-save-heading', text: 'Save' }),
      saveBtn,
      terminal,
      existingBanner,
    ]);

    const pageSection = el(
      'section',
      { class: 'ct-section ct-page-section', 'aria-labelledby': 'ct-page-heading' },
      [el('h2', { class: 'ct-label', id: 'ct-page-heading', text: 'Detected page' }), pageCard],
    );

    const vaultCount = el('span', { class: 'ct-count', text: '0' });
    const vaultHead = el('div', { class: 'ct-vault-head' }, [
      el('h2', { class: 'ct-label', text: 'Vault' }),
      el('span', { class: 'ct-vault-meta' }, [vaultCount, document.createTextNode(' TABS')]),
      el('button', { class: 'ct-link', type: 'button', 'data-action': 'open-library' }, [
        document.createTextNode('OPEN LIBRARY \u2192'),
      ]),
    ]);

    const searchInput = el('input', {
      class: 'ct-search-input',
      type: 'search',
      placeholder: 'search title, url, folder...',
      'aria-label': 'Search your vault',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const folderChips = el('div', { class: 'ct-folders', 'aria-label': 'Vault folders' });
    const results = el('div', { class: 'ct-results' });

    const vaultSection = el('section', { class: 'ct-section ct-vault-section', 'aria-labelledby': 'ct-vault-heading' }, [
      vaultHead,
      el('div', { class: 'ct-search' }, [el('span', { class: 'ct-search-prompt', 'aria-hidden': 'true', text: '>' }), searchInput]),
      folderChips,
      results,
    ]);
    vaultHead.querySelector('.ct-label').id = 'ct-vault-heading';

    const body = el('div', { class: 'ct-body' }, [pageSection, saveSection, vaultSection]);
    const footer = el('footer', { class: 'ct-footer' }, [
      el('span', { text: 'LOCAL ONLY \u00b7 NO CLOUD' }),
      el('span', { text: `v${state.version}` }),
    ]);

    const srStatus = el('p', { class: 'ct-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const srAlert = el('p', { class: 'ct-sr-only', role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' });

    const panel = el(
      'aside',
      {
        class: 'ct-panel',
        role: 'dialog',
        'aria-modal': 'false',
        'aria-labelledby': 'ct-panel-title',
        'aria-describedby': 'ct-panel-desc',
      },
      [header, body, footer, srStatus, srAlert],
    );

    const description = el('p', {
      id: 'ct-panel-desc',
      class: 'ct-sr-only',
      text: 'CofreTabs panel. Review the detected page and choose Save This Tab to store it in your local vault. Press Escape to close.',
    });
    panel.insertBefore(description, body);

    shadow.append(panel);
    document.documentElement.append(host);

    state.host = host;
    state.shadow = shadow;
    state.panel = panel;
    state.els = {
      closeBtn,
      saveBtn,
      terminal,
      existingBanner,
      pageTitle,
      pageUrl,
      faviconWrap,
      vaultCount,
      searchInput,
      folderChips,
      results,
      srStatus,
      srAlert,
      saveSection,
    };

    renderPage();
    renderSaveState();
    renderVault();
    addTerminalLine('> local vault online. nothing leaves this device.', 'muted');

    closeBtn.addEventListener('click', () => closePanel());
    saveBtn.addEventListener('click', handleSaveClick);
    panel.addEventListener('click', handlePanelClick);
    searchInput.addEventListener('input', handleSearchInput);
    shadow.addEventListener('keydown', handleKeydown);

    try {
      const listener = (message, _sender, sendResponse) => {
        if (!message || typeof message.type !== 'string') return false;
        if (message.type === MSG.PANEL_PING) {
          sendResponse({ open: Boolean(state.open) });
          return false;
        }
        if (message.type === MSG.PANEL_CLOSE) {
          closePanel();
          sendResponse({ closed: true });
          return false;
        }
        return false;
      };
      state.messageListener = listener;
      chrome.runtime.onMessage.addListener(listener);
    } catch {
      // Non-fatal: toolbar toggling just falls back to injecting again.
    }

    state.open = true;
    window.__cofreTabsPanel = {
      open: true,
      close: () => closePanel(),
    };

    const focusTarget = state.existing ? closeBtn : saveBtn;
    const raf = window.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
    raf(() => {
      try {
        focusTarget.focus({ preventScroll: true });
      } catch {
        focusTarget.focus();
      }
    });
  }

  function renderPage() {
    const { pageTitle, pageUrl, faviconWrap } = state.els;
    const page = state.page || {};
    const title = String(page.title || '').trim();
    const hostname = String(page.hostname || '').replace(/^www\./i, '');

    pageTitle.textContent = title || hostname || 'Untitled page';
    pageTitle.title = pageTitle.textContent;
    pageUrl.textContent = prettyUrl(page.url);
    pageUrl.title = String(page.url || '');

    faviconWrap.replaceChildren();
    const favicon = typeof page.faviconUrl === 'string' && page.faviconUrl.startsWith('data:image/') ? page.faviconUrl : '';
    if (favicon) {
      const img = el('img', { src: favicon, alt: '', width: '18', height: '18' });
      img.addEventListener('error', () => {
        faviconWrap.replaceChildren(el('span', { class: 'ct-monogram', text: monogram(hostname || page.url) }));
      });
      faviconWrap.append(img);
    } else {
      faviconWrap.append(el('span', { class: 'ct-monogram', text: monogram(hostname || page.url) }));
    }
  }

  function renderSaveState() {
    const { saveBtn, existingBanner, saveSection } = state.els;
    if (!saveBtn) return;

    saveBtn.replaceChildren();
    existingBanner.replaceChildren();
    saveBtn.classList.toggle('is-busy', state.busy);
    saveBtn.classList.toggle('is-saved', Boolean(state.existing) && !state.busy);
    saveSection.setAttribute('aria-busy', state.busy ? 'true' : 'false');

    const prompt = el('span', { class: 'ct-prompt', 'aria-hidden': 'true', text: '>' });
    const label = el('span', { class: 'ct-save-label' });
    const cursor = el('span', { class: 'ct-save-cursor', 'aria-hidden': 'true', text: '_' });

    if (state.busy) {
      label.textContent = 'SAVING...';
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-label', 'Saving tab');
      saveBtn.append(prompt, label, cursor);
      return;
    }

    if (state.existing) {
      label.textContent = 'SAVED';
      const tick = el('span', { class: 'ct-tick', 'aria-hidden': 'true', text: '\u2713' });
      saveBtn.disabled = true;
      saveBtn.setAttribute('aria-label', 'This tab is already saved in your vault');
      saveBtn.append(prompt, label, tick);

      existingBanner.hidden = false;
      const meta = el('div', { class: 'ct-existing-meta' }, [
        document.createTextNode('Filed under '),
        el('strong', { text: state.existing.folderName || 'Unsorted' }),
        document.createTextNode(` \u00b7 ${timeAgo(state.existing.createdAt)}`),
      ]);
      existingBanner.append(
        el('div', { class: 'ct-existing-title', text: '[ ALREADY IN VAULT ]' }),
        meta,
        el('button', { class: 'ct-link', type: 'button', 'data-action': 'open-library-current' }, [
          document.createTextNode('OPEN IN LIBRARY \u2192'),
        ]),
      );
      return;
    }

    label.textContent = 'SAVE THIS TAB';
    saveBtn.disabled = false;
    saveBtn.setAttribute('aria-label', 'Save this tab to your local vault');
    saveBtn.append(prompt, label, cursor);
    existingBanner.hidden = true;
    existingBanner.replaceChildren();
  }

  function renderVault() {
    const { vaultCount, folderChips, results } = state.els;
    if (!vaultCount) return;

    const snapshot = state.snapshot || { stats: { active: 0, folders: 0, trashed: 0 }, folders: [], recent: [] };
    vaultCount.textContent = String(snapshot.stats?.active ?? 0);

    folderChips.replaceChildren();
    const folders = Array.isArray(snapshot.folders) ? snapshot.folders : [];
    for (const folder of folders) {
      folderChips.append(
        el(
          'button',
          {
            class: 'ct-chip',
            type: 'button',
            'data-action': 'open-folder',
            'data-folder-id': folder.id,
            title: `Open ${folder.name} in the library`,
          },
          [
            el('span', { class: 'ct-chip-name', text: folder.name }),
            el('span', { class: 'ct-chip-count', text: String(folder.count) }),
          ],
        ),
      );
    }
    if (!folders.length) {
      folderChips.append(el('span', { class: 'ct-hint', text: 'no folders yet \u2014 save your first page.' }));
    }

    if (state.query) {
      renderResults(state.results || []);
    } else if ((snapshot.stats?.active ?? 0) === 0 && !folders.length) {
      results.replaceChildren(
        el('div', { class: 'ct-empty' }, [
          el('div', { class: 'ct-empty-title', text: '[ VAULT EMPTY ]' }),
          el('p', { text: 'Click SAVE THIS TAB to start your local collection.' }),
        ]),
      );
    } else {
      renderItems(snapshot.recent || []);
    }
  }

  function renderResults(items) {
    const { results } = state.els;
    results.replaceChildren();
    if (!state.query) {
      renderItems(state.snapshot?.recent || []);
      return;
    }
    if (!items.length) {
      results.append(
        el('div', { class: 'ct-empty' }, [
          el('div', { class: 'ct-empty-title', text: '[ NO MATCHES ]' }),
          el('p', { text: 'Nothing in your vault matches that search.' }),
        ]),
      );
      return;
    }
    renderItems(items, true);
  }

  function renderItems(items, showFolder = false) {
    const { results } = state.els;
    results.replaceChildren();
    if (!Array.isArray(items) || !items.length) {
      if (state.query) return;
      results.append(el('div', { class: 'ct-hint ct-empty-recent', text: 'recent saves will appear here.' }));
      return;
    }

    for (const item of items) {
      const title = String(item.title || 'Untitled page');
      const main = el('button', {
        class: 'ct-item-main',
        type: 'button',
        'data-action': 'open-item',
        'data-url': item.url,
        title: `${title}\n${item.url}`,
      }, [
        el('span', { class: 'ct-item-title', text: title }),
        el('span', { class: 'ct-item-meta' }, [
          el('span', { text: showFolder ? item.folderName || 'Unsorted' : timeAgo(item.createdAt) }),
          document.createTextNode(' \u00b7 '),
          el('span', { text: prettyUrl(item.url) }),
        ]),
      ]);

      const trash = el('button', {
        class: 'ct-item-del',
        type: 'button',
        'data-action': 'trash-item',
        'data-id': item.id,
        title: 'Move to trash',
        'aria-label': `Move ${title} to trash`,
        text: 'DEL',
      });

      results.append(el('div', { class: 'ct-item' }, [main, trash]));
    }
  }

  // -------------------------------------------------------------------- save

  function addTerminalLine(text, kind = '') {
    const { terminal } = state.els;
    if (!terminal) return null;
    const line = el('div', { class: `ct-line${kind ? ` ct-line-${kind}` : ''}`, text });
    terminal.append(line);
    while (terminal.childElementCount > 5) terminal.firstElementChild.remove();
    terminal.scrollTop = terminal.scrollHeight;
    return line;
  }

  function clearTerminal() {
    state.els.terminal?.replaceChildren();
  }

  async function handleSaveClick() {
    if (state.busy || state.existing || !state.page) return;
    const started = Date.now();
    state.busy = true;
    renderSaveState();
    clearTerminal();
    addTerminalLine('> INITIALIZING STORAGE...');
    const writingLine = addTerminalLine('[ WRITING TO DISK... ]', 'write');
    announce('Saving tab to your local vault.');

    let response;
    try {
      response = await send({
        type: MSG.SAVE_TAB,
        payload: {
          url: state.page.url,
          title: state.page.title,
          faviconUrl: state.page.faviconUrl,
        },
      });
    } catch {
      finishFailure('The extension did not respond. Nothing was saved.');
      return;
    }

    if (!response || response.ok !== true) {
      const message = response?.error?.message || 'The local vault could not save this tab.';
      finishFailure(message);
      return;
    }

    const data = response.data || {};
    if (writingLine && writingLine.isConnected) {
      writingLine.textContent = '[ WRITE ACKNOWLEDGED ]';
      writingLine.className = 'ct-line ct-line-muted';
    }

    if (data.duplicate) {
      state.busy = false;
      state.existing = data.entry
        ? {
            id: data.entry.id,
            title: data.entry.title,
            folderName: data.folderName || data.entry.folderName || 'Unsorted',
            createdAt: data.entry.createdAt,
          }
        : state.existing;
      renderSaveState();
      addTerminalLine('[ ALREADY IN VAULT ]', 'warn');
      announce('This tab is already saved in your vault.');
      refreshSnapshot();
      return;
    }

    const elapsed = Date.now() - started;
    if (!reducedMotion() && elapsed < SAVE_MIN_ANIMATION_MS) {
      await delay(SAVE_MIN_ANIMATION_MS - elapsed);
    }

    state.busy = false;
    state.existing = {
      id: data.entry?.id || '',
      title: data.entry?.title || state.page.title,
      folderName: data.folder?.name || data.entry?.folderName || 'Unsorted',
      createdAt: data.entry?.createdAt || Date.now(),
    };
    renderSaveState();
    addTerminalLine(`[ SAVE COMPLETE \u2713 ] \u2192 ${state.existing.folderName}`, 'success');
    announce(`Saved. Filed under ${state.existing.folderName}.`);
    refreshSnapshot();
  }

  function finishFailure(message) {
    state.busy = false;
    renderSaveState();
    addTerminalLine('[ SAVE FAILED ]', 'error');
    addTerminalLine(String(message || 'Unknown storage error.'), 'error');
    announce(`Save failed. ${message}`, true);
  }

  async function refreshSnapshot() {
    try {
      const response = await send({ type: MSG.PANEL_SNAPSHOT });
      if (response?.ok && response.data) {
        state.snapshot = response.data;
        renderVault();
      }
    } catch {
      // The local list will refresh next time the panel opens.
    }
  }

  // ------------------------------------------------------------------- search

  function handleSearchInput(event) {
    const query = String(event.target.value || '').trim();
    state.query = query;
    state.results = null;
    clearTimeout(state.searchTimer);

    if (!query) {
      renderVault();
      return;
    }

    renderLoadingResults();
    const seq = ++state.searchSeq;
    state.searchTimer = setTimeout(async () => {
      try {
        const response = await send({ type: MSG.SEARCH, query });
        if (seq !== state.searchSeq) return;
        if (response?.ok) {
          state.results = Array.isArray(response.data) ? response.data : [];
          renderResults(state.results);
        } else {
          state.results = [];
          renderResults([]);
        }
      } catch {
        if (seq !== state.searchSeq) return;
        state.results = [];
        renderResults([]);
      }
    }, 170);
  }

  function renderLoadingResults() {
    state.els.results.replaceChildren(el('div', { class: 'ct-hint', text: 'searching local vault...' }));
  }

  // ------------------------------------------------------------------- events

  function handlePanelClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.getAttribute('data-action');

    if (action === 'open-library') {
      void send({ type: MSG.OPEN_LIBRARY, payload: { view: 'all' } });
      return;
    }
    if (action === 'open-library-current') {
      void send({ type: MSG.OPEN_LIBRARY, payload: { q: state.page?.url || '' } });
      return;
    }
    if (action === 'open-folder') {
      const folderId = target.getAttribute('data-folder-id') || '';
      void send({ type: MSG.OPEN_LIBRARY, payload: { folderId, view: 'folder' } });
      return;
    }
    if (action === 'open-item') {
      const url = target.getAttribute('data-url') || '';
      void send({ type: MSG.OPEN_URL, payload: { url } });
      return;
    }
    if (action === 'trash-item') {
      void handleTrashItem(target.getAttribute('data-id') || '');
    }
  }

  async function handleTrashItem(id) {
    if (!id) return;
    try {
      const response = await send({ type: MSG.TRASH_TAB, id });
      if (!response?.ok) throw new Error(response?.error?.message || 'Trash failed');
      if (state.existing && state.existing.id === id) {
        state.existing = null;
        renderSaveState();
      }
      announce('Moved to trash. You can restore it from the library.');
      if (state.query) {
        state.results = (state.results || []).filter((item) => item.id !== id);
        renderResults(state.results);
      }
      await refreshSnapshot();
    } catch {
      announce('Could not move that tab to the trash. Nothing was changed.', true);
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== 'Tab' || !state.shadow) return;

    const nodes = Array.from(
      state.shadow.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => !node.hasAttribute('hidden') && node.getClientRects().length > 0);

    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = state.shadow.activeElement;

    if (event.shiftKey && (active === first || !state.shadow.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function closePanel() {
    if (!state.open) return;
    state.open = false;
    clearTimeout(state.searchTimer);
    clearTimeout(state.closeTimer);

    const panel = state.panel;
    const host = state.host;
    const previous = state.previouslyFocused;
    if (panel) panel.classList.add('ct-closing');

    const finish = () => {
      host?.remove();
      if (state.messageListener) {
        try {
          chrome.runtime.onMessage.removeListener(state.messageListener);
        } catch {
          // Ignore: the context may be gone during navigation.
        }
        state.messageListener = null;
      }
      try {
        delete window.__cofreTabsPanel;
      } catch {
        window.__cofreTabsPanel = undefined;
      }
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          previous.focus();
        }
      }
    };

    if (reducedMotion()) finish();
    else state.closeTimer = setTimeout(finish, 220);
  }

  // --------------------------------------------------------------------- boot

  async function start() {
    document.getElementById(HOST_ID)?.remove();

    const styles = await loadStyles();
    let response;
    try {
      response = await send({ type: MSG.PANEL_INIT });
    } catch {
      await send({ type: MSG.OPEN_LIBRARY, payload: { notice: 'panel-unavailable' } }).catch(() => {});
      return;
    }

    if (!response || response.ok !== true || !response.data?.page) {
      await send({ type: MSG.OPEN_LIBRARY, payload: { notice: 'panel-unavailable' } }).catch(() => {});
      return;
    }

    build(response.data, styles);
  }

  start().catch(() => {
    document.getElementById(HOST_ID)?.remove();
  });
})();
