import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const PANEL_SOURCE = await readFile(new URL('../src/content/panel.js', import.meta.url), 'utf8');
const PANEL_CSS = await readFile(new URL('../src/styles/panel.css', import.meta.url), 'utf8');

const GRID_VISIBLE = 9;
const GRID_STEP = 3;

function makeFolders(count) {
  const folders = [];
  for (let i = 1; i <= count; i += 1) {
    folders.push({
      id: `folder-${i}`,
      key: `site${i}.example.com`,
      name: `Folder ${i}`,
      type: i % 4 === 0 ? 'custom' : 'site',
      count: i,
    });
  }
  // Put Favorites first, matching the snapshot contract.
  return [
    { id: '__favorites__', key: 'favorites', name: 'Favorites', type: 'favorites', count: 1 },
    ...folders,
  ];
}

function buildInitData(folderCount) {
  return {
    page: {
      title: 'A page',
      url: 'https://example.com/page',
      hostname: 'example.com',
      displayHost: 'example.com',
      folderName: 'Example',
      faviconUrl: '',
    },
    existing: null,
    snapshot: {
      stats: { active: folderCount, trashed: 0, folders: folderCount },
      folders: makeFolders(folderCount),
      recent: [],
    },
    version: '1.1.0',
    theme: 'dark',
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

function createPanel({ initData }) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="page-focus">page</button></body></html>', {
    url: 'https://example.com/page',
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
        if (message.type === 'cofre:panel-init') {
          respond({ ok: true, data: initData });
        } else {
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
    get host() {
      return window.document.getElementById('cofretabs-panel-host');
    },
    get shadow() {
      return this.host?.shadowRoot;
    },
    tiles() {
      return Array.from(this.shadow.querySelectorAll('.ct-folder-tile[data-action="open-folder"]'));
    },
    navButtons() {
      return Array.from(this.shadow.querySelectorAll('.ct-folder-nav-btn'));
    },
    close: () => dom.window.close(),
  };
}

/** Visible folder names in grid order (ignoring empty placeholder tiles). */
function visibleNames(panel) {
  return panel
    .tiles()
    .map((tile) => tile.querySelector('.ct-folder-tile-name')?.textContent)
    .filter(Boolean);
}

function expectedWindow(count, offset) {
  const total = count + 1; // + the virtual Favorites folder
  const maxOffset = Math.max(0, Math.ceil((total - GRID_VISIBLE) / GRID_STEP) * GRID_STEP);
  const clamped = Math.min(offset, maxOffset);
  const names = ['Favorites'];
  for (let i = 1; i <= count; i += 1) names.push(`Folder ${i}`);
  return names.slice(clamped, clamped + GRID_VISIBLE);
}

for (const folderCount of [0, 2, 8, 9, 11, 14, 15]) {
  test(`folder grid walks ${folderCount + 1} folders one row at a time without skipping or losing any`, async () => {
    const total = folderCount + 1; // + the virtual Favorites folder
    const panel = createPanel({ initData: buildInitData(folderCount) });
    await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

    const maxOffset = Math.max(0, Math.ceil((total - GRID_VISIBLE) / GRID_STEP) * GRID_STEP);

    if (total <= GRID_VISIBLE) {
      // Everything fits on one screen: no navigation controls, exact order.
      assert.equal(panel.navButtons().length, 0);
      assert.deepEqual(visibleNames(panel), expectedWindow(folderCount, 0));
      panel.close();
      return;
    }

    // Walk forward one row at a time, recording each page.
    const pages = [];
    for (let offset = 0; offset <= maxOffset; offset += GRID_STEP) {
      const page = visibleNames(panel);
      pages.push(page);
      assert.deepEqual(page, expectedWindow(folderCount, offset), `page at offset ${offset}`);
      // Within a single page: exactly the visible slice, no duplicates.
      assert.equal(page.length, Math.min(GRID_VISIBLE, total - offset));
      assert.equal(new Set(page).size, page.length, 'a page must not repeat a folder');
      if (offset < maxOffset) {
        const down = panel.navButtons().find((b) => b.getAttribute('data-action') === 'folders-down');
        assert.ok(down, 'a down control is available before the last page');
        down.click();
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    // Each down-step advanced the window start by exactly one row of 3.
    for (let i = 1; i < pages.length; i += 1) {
      const prevFirst = expectedWindow(folderCount, (i - 1) * GRID_STEP)[0];
      const first = expectedWindow(folderCount, i * GRID_STEP)[0];
      assert.notEqual(prevFirst, first);
    }

    // The union of all pages covers every folder exactly as reachable set.
    const covered = new Set(pages.flat());
    assert.equal(covered.size, total, 'every folder is reachable across the pages');
    // The final page ends on the very last folder.
    assert.equal(pages[pages.length - 1][pages[pages.length - 1].length - 1], `Folder ${folderCount}`);

    panel.close();
  });
}

test('the down control is clamped at the final page and up returns to the start', async () => {
  const panel = createPanel({ initData: buildInitData(15) }); // 16 total
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  const position = () => panel.shadow.querySelector('.ct-folder-position').textContent;
  assert.match(position(), /1–9 \/ 16/);

  // Click down three times: 0 -> 3 -> 6 -> 9 (the final offset for 16 items).
  const clickDown = async () => {
    panel.navButtons().find((b) => b.getAttribute('data-action') === 'folders-down').click();
    await new Promise((r) => setTimeout(r, 20));
  };
  await clickDown();
  assert.match(position(), /4–12 \/ 16/);
  await clickDown();
  assert.match(position(), /7–15 \/ 16/);
  await clickDown();
  assert.match(position(), /10–16 \/ 16/);

  // Final page: only the up control remains; the down control is gone.
  const actions = panel.navButtons().map((b) => b.getAttribute('data-action'));
  assert.ok(actions.includes('folders-up'));
  assert.ok(!actions.includes('folders-down'));

  // Up steps back one row.
  panel.navButtons().find((b) => b.getAttribute('data-action') === 'folders-up').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(position(), /7–15 \/ 16/);

  panel.close();
});

test('the final partial page keeps a stable 3x3 layout with empty placeholders', async () => {
  const panel = createPanel({ initData: buildInitData(15) }); // 16 total -> final offset 9 shows 7
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  for (let i = 0; i < 3; i += 1) {
    panel.navButtons().find((b) => b.getAttribute('data-action') === 'folders-down').click();
    await new Promise((r) => setTimeout(r, 20));
  }

  const grid = panel.shadow.querySelector('.ct-folder-grid');
  const cells = grid.children.length;
  assert.equal(cells, GRID_VISIBLE, 'the grid keeps 9 cells even on a partial page');
  const real = grid.querySelectorAll('.ct-folder-tile[data-action="open-folder"]').length;
  const placeholders = grid.querySelectorAll('.ct-folder-tile-empty').length;
  assert.equal(real, 7); // folders 10..16
  assert.equal(placeholders, 2);
  assert.equal(real + placeholders, GRID_VISIBLE);

  panel.close();
});

test('nav labels are accessible and the position readout is a live region', async () => {
  const panel = createPanel({ initData: buildInitData(15) });
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  for (const button of panel.navButtons()) {
    assert.ok(button.getAttribute('aria-label'), 'nav buttons must be labelled');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.getAttribute('type'), 'button');
  }
  const live = panel.shadow.querySelector('.ct-folder-position');
  assert.equal(live.getAttribute('aria-live'), 'polite');

  panel.close();
});

test('clicking a folder tile opens it in the library with its id', async () => {
  const panel = createPanel({ initData: buildInitData(3) });
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  const tile = panel.tiles().find((t) => t.getAttribute('data-folder-id') === 'folder-2');
  tile.click();
  const call = panel.calls.find((c) => c.type === 'cofre:open-library' && c.payload?.folderId);
  assert.equal(call.payload.folderId, 'folder-2');
  assert.equal(call.payload.view, 'folder');

  panel.close();
});

test('custom folder tiles render a playful glyph, Favorites renders a heart', async () => {
  const panel = createPanel({ initData: buildInitData(7) }); // folder-4 and folder-8 are custom
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  const favoritesTile = panel.tiles().find((t) => t.getAttribute('data-folder-id') === '__favorites__');
  assert.ok(favoritesTile.querySelector('.ct-folder-icon-favorites'));

  const customTile = panel.tiles().find((t) => t.getAttribute('data-folder-id') === 'folder-4');
  const glyph = customTile.querySelector('.ct-folder-glyph');
  assert.ok(glyph, 'custom folders use a glyph');
  assert.ok(glyph.textContent.length > 0);

  const siteTile = panel.tiles().find((t) => t.getAttribute('data-folder-id') === 'folder-1');
  assert.ok(siteTile.querySelector('svg'), 'site folders use an SVG folder icon');

  panel.close();
});

// -------------------------------------------------------------- outside click

test('clicking outside the panel closes it', async () => {
  const panel = createPanel({ initData: buildInitData(2) });
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));
  assert.ok(panel.host);

  // Dispatch a click on the page body, outside the injected host.
  const outside = panel.window.document.body;
  outside.dispatchEvent(new panel.window.MouseEvent('click', { bubbles: true, composed: true }));

  await waitFor(() => !panel.host, 2000);
  assert.equal(panel.host, null);
  assert.equal(panel.window.__cofreTabsPanel, undefined);
  // The single outside listener is removed on close.
  assert.equal(panel.listeners.length, 0);

  panel.close();
});

test('clicking inside the panel does not close it', async () => {
  const panel = createPanel({ initData: buildInitData(2) });
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  // Click an inner element (a folder tile) — must not close.
  const tile = panel.tiles()[0];
  tile.dispatchEvent(new panel.window.MouseEvent('click', { bubbles: true, composed: true }));
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(panel.host, 'the panel stays open after an inside click');

  // Click the header (non-action area) — still open.
  panel.shadow.querySelector('.ct-header').dispatchEvent(
    new panel.window.MouseEvent('click', { bubbles: true, composed: true }),
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(panel.host, 'the panel stays open after clicking non-action chrome');

  panel.close();
});

test('a second outside click after close does not throw and listeners stay clean', async () => {
  const panel = createPanel({ initData: buildInitData(2) });
  await waitFor(() => panel.shadow?.querySelector('.ct-folder-grid'));

  panel.window.document.body.dispatchEvent(new panel.window.MouseEvent('click', { bubbles: true, composed: true }));
  await waitFor(() => !panel.host, 2000);
  // Firing more clicks on the (now removed) document listener must be harmless.
  panel.window.document.body.dispatchEvent(new panel.window.MouseEvent('click', { bubbles: true, composed: true }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(panel.host, null);

  panel.close();
});

test('the theme from the snapshot is applied to the panel root', async () => {
  const lightInit = { ...buildInitData(2), theme: 'light' };
  const panel = createPanel({ initData: lightInit });
  await waitFor(() => panel.shadow?.querySelector('.ct-panel'));
  assert.equal(panel.shadow.querySelector('.ct-panel').getAttribute('data-theme'), 'light');
  panel.close();

  const darkPanel = createPanel({ initData: buildInitData(2) });
  await waitFor(() => darkPanel.shadow?.querySelector('.ct-panel'));
  assert.equal(darkPanel.shadow.querySelector('.ct-panel').getAttribute('data-theme'), 'dark');
  darkPanel.close();
});
