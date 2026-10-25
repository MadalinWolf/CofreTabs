import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const PANEL_SOURCE = await readFile(new URL('../src/content/panel.js', import.meta.url), 'utf8');
const PANEL_CSS = await readFile(new URL('../src/styles/panel.css', import.meta.url), 'utf8');

function baseInit(overrides = {}) {
  return {
    page: {
      title: 'A Very Long Page Title That Should Still Render Safely',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share&t=120',
      hostname: 'www.youtube.com',
      displayHost: 'youtube.com',
      folderName: 'YouTube',
      faviconUrl: '',
    },
    existing: null,
    snapshot: {
      stats: { active: 3, trashed: 1, folders: 2 },
      folders: [
        { id: 'folder-yt', key: 'youtube.com', name: 'YouTube', count: 2 },
        { id: 'folder-gh', key: 'github.com', name: 'GitHub', count: 1 },
      ],
      recent: [
        {
          id: 'tab-1',
          title: 'A recent saved page',
          url: 'https://github.com/MadalinWolf',
          hostname: 'github.com',
          folderId: 'folder-gh',
          folderName: 'GitHub',
          createdAt: Date.now() - 60_000,
          deletedAt: null,
        },
      ],
    },
    version: '1.0.0',
    ...overrides,
  };
}

function snapshotAfterSave() {
  return {
    stats: { active: 4, trashed: 1, folders: 2 },
    folders: [
      { id: 'folder-yt', key: 'youtube.com', name: 'YouTube', count: 3 },
      { id: 'folder-gh', key: 'github.com', name: 'GitHub', count: 1 },
    ],
    recent: [
      {
        id: 'tab-new',
        title: 'A Very Long Page Title That Should Still Render Safely',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        hostname: 'www.youtube.com',
        folderId: 'folder-yt',
        folderName: 'YouTube',
        createdAt: Date.now(),
        deletedAt: null,
      },
    ],
  };
}

async function waitFor(predicate, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the panel');
}

function createPanel({ initData, saveResponse, saveDeferred = false, searchResults = [] }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="page-focus">page</button></body></html>', {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });

  const calls = [];
  const listeners = [];
  let pendingSave = null;
  let pendingSaveResolve = null;

  window.chrome = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const index = listeners.indexOf(fn);
          if (index !== -1) listeners.splice(index, 1);
        },
      },
      sendMessage: (message, callback) => {
        calls.push(message);
        const respond = (payload) => {
          queueMicrotask(() => callback(payload));
        };
        switch (message.type) {
          case 'cofre:panel-init':
            respond({ ok: true, data: initData });
            break;
          case 'cofre:panel-snapshot':
            respond({ ok: true, data: snapshotAfterSave() });
            break;
          case 'cofre:save-tab':
            if (saveDeferred) {
              pendingSave = { message, callback };
              pendingSaveResolve = (payload) => pendingSave.callback(payload);
            } else {
              respond(saveResponse);
            }
            break;
          case 'cofre:search':
            respond({ ok: true, data: searchResults });
            break;
          case 'cofre:trash-tab':
            respond({ ok: true, data: { entry: { id: message.id } } });
            break;
          default:
            respond({ ok: true, data: {} });
        }
        return undefined;
      },
    },
  };

  window.fetch = async () => ({ ok: true, text: async () => PANEL_CSS });
  window.eval(PANEL_SOURCE);

  return {
    dom,
    window,
    calls,
    listeners,
    resolveSave: (payload) => pendingSaveResolve?.(payload),
    hasPendingSave: () => Boolean(pendingSave),
    get host() {
      return window.document.getElementById('cofretabs-panel-host');
    },
    get shadow() {
      return this.host?.shadowRoot;
    },
    close: () => dom.window.close(),
  };
}

test('opens with the detected page, saves only after a click, and confirms after the write', async () => {
  const panel = createPanel({
    initData: baseInit(),
    saveDeferred: true,
  });

  await waitFor(() => panel.shadow?.querySelector('#ct-save-btn'));
  const saveBtn = panel.shadow.querySelector('#ct-save-btn');
  const dialog = panel.shadow.querySelector('[role="dialog"]');

  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'false');
  assert.equal(panel.shadow.querySelector('.ct-page-title').textContent, baseInit().page.title);
  assert.match(panel.shadow.querySelector('.ct-page-url').textContent, /youtube\.com\/watch/);
  assert.equal(saveBtn.disabled, false);
  assert.equal(saveBtn.textContent.includes('SAVE THIS TAB'), true);
  assert.equal(saveBtn.getAttribute('aria-label'), 'Save this tab to your local vault');

  // Opening the panel must never auto-save.
  assert.equal(panel.calls.filter((call) => call.type === 'cofre:save-tab').length, 0);

  saveBtn.click();
  saveBtn.click();
  saveBtn.click();

  assert.equal(panel.calls.filter((call) => call.type === 'cofre:save-tab').length, 1);
  assert.equal(saveBtn.disabled, true);
  assert.match(panel.shadow.querySelector('#ct-terminal').textContent, /WRITING TO DISK/);
  assert.doesNotMatch(panel.shadow.querySelector('#ct-terminal').textContent, /SAVE COMPLETE/);

  // The write is still pending: no success may be visible yet.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.doesNotMatch(panel.shadow.querySelector('#ct-terminal').textContent, /SAVE COMPLETE/);

  panel.resolveSave({
    ok: true,
    data: {
      created: true,
      duplicate: false,
      entry: {
        id: 'tab-new',
        title: baseInit().page.title,
        url: baseInit().page.url,
        folderId: 'folder-yt',
        folderName: 'YouTube',
        createdAt: Date.now(),
      },
      folder: { id: 'folder-yt', name: 'YouTube' },
    },
  });

  await waitFor(() => /SAVE COMPLETE/.test(panel.shadow.querySelector('#ct-terminal').textContent));
  assert.equal(saveBtn.disabled, true);
  assert.match(saveBtn.textContent, /SAVED/);
  assert.equal(panel.shadow.querySelector('.ct-existing').hidden, false);
  assert.match(panel.shadow.querySelector('.ct-existing').textContent, /ALREADY IN VAULT/);
  assert.match(panel.shadow.querySelector('.ct-existing').textContent, /YouTube/);
  assert.match(panel.shadow.querySelector('#ct-terminal').textContent, /SAVE COMPLETE/);

  panel.close();
});

test('a failed write shows a truthful error and re-enables the button', async () => {
  const panel = createPanel({
    initData: baseInit(),
    saveResponse: { ok: false, error: { code: 'QUOTA', message: 'Local storage is full.' } },
  });

  await waitFor(() => panel.shadow?.querySelector('#ct-save-btn'));
  const saveBtn = panel.shadow.querySelector('#ct-save-btn');
  saveBtn.click();

  await waitFor(() => /SAVE FAILED/.test(panel.shadow.querySelector('#ct-terminal').textContent));
  const text = panel.shadow.querySelector('#ct-terminal').textContent;
  assert.match(text, /SAVE FAILED/);
  assert.match(text, /Local storage is full/);
  assert.doesNotMatch(text, /SAVE COMPLETE/);
  assert.equal(saveBtn.disabled, false);
  assert.match(saveBtn.textContent, /SAVE THIS TAB/);
  assert.equal(panel.shadow.querySelector('.ct-existing').hidden, true);
  panel.close();
});

test('an already-saved page is disabled on open and never auto-saves', async () => {
  const existing = {
    id: 'tab-existing',
    title: 'Already saved',
    folderName: 'YouTube',
    createdAt: Date.now() - 3600_000,
  };
  const panel = createPanel({ initData: baseInit({ existing }) });

  await waitFor(() => panel.shadow?.querySelector('#ct-save-btn'));
  const saveBtn = panel.shadow.querySelector('#ct-save-btn');
  assert.equal(saveBtn.disabled, true);
  assert.match(saveBtn.textContent, /SAVED/);
  assert.match(panel.shadow.querySelector('.ct-existing').textContent, /ALREADY IN VAULT/);
  assert.equal(panel.calls.filter((call) => call.type === 'cofre:save-tab').length, 0);

  saveBtn.click();
  assert.equal(panel.calls.filter((call) => call.type === 'cofre:save-tab').length, 0);
  panel.close();
});

test('renders untrusted titles as text, not markup', async () => {
  const init = baseInit();
  init.page.title = '<img src=x onerror="window.__pwned = true">';
  const panel = createPanel({ initData: init });

  await waitFor(() => panel.shadow?.querySelector('.ct-page-title'));
  assert.equal(panel.window.__pwned, undefined);
  const titleNode = panel.shadow.querySelector('.ct-page-title');
  assert.equal(titleNode.querySelector('img'), null);
  assert.equal(titleNode.textContent, init.page.title);
  panel.close();
});

test('filters the vault locally and opens a folder in the library', async () => {
  const searchResults = [
    {
      id: 'tab-search',
      title: 'Found page',
      url: 'https://example.com/found',
      hostname: 'example.com',
      folderId: 'folder-gh',
      folderName: 'GitHub',
      createdAt: Date.now(),
      deletedAt: null,
    },
  ];
  const panel = createPanel({ initData: baseInit(), searchResults });

  await waitFor(() => panel.shadow?.querySelector('.ct-search-input'));
  const tiles = panel.shadow.querySelectorAll('.ct-folder-tile[data-action="open-folder"]');
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].getAttribute('data-folder-id'), 'folder-yt');
  tiles[0].click();
  const folderCall = panel.calls.find((call) => call.type === 'cofre:open-library' && call.payload?.folderId);
  assert.equal(folderCall?.payload.folderId, 'folder-yt');

  const input = panel.shadow.querySelector('.ct-search-input');
  input.value = 'found';
  input.dispatchEvent(new panel.window.Event('input', { bubbles: true }));
  await waitFor(() =>
    panel.calls.some((call) => call.type === 'cofre:search' && call.query === 'found'),
  );
  await waitFor(() => panel.shadow.querySelector('.ct-item-title')?.textContent === 'Found page');
  assert.equal(panel.shadow.querySelector('.ct-item-title').textContent, 'Found page');
  panel.close();
});

test('supports Escape to close and announces save status', async () => {
  const panel = createPanel({ initData: baseInit() });
  await waitFor(() => panel.shadow?.querySelector('#ct-save-btn'));

  const status = panel.shadow.querySelector('[role="status"]');
  assert.ok(status);
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.ok(panel.shadow.querySelector('[role="alert"]'));

  assert.equal(panel.listeners.length, 1);
  let pingResponse = null;
  panel.listeners[0]({ type: 'cofre:panel-ping' }, {}, (response) => {
    pingResponse = response;
  });
  assert.equal(pingResponse.open, true);

  panel.shadow.querySelector('.ct-panel').dispatchEvent(
    new panel.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await waitFor(() => !panel.host, 2000);
  assert.equal(panel.host, null);
  assert.equal(panel.listeners.length, 0);
  assert.equal(panel.window.__cofreTabsPanel, undefined);
  panel.close();
});
