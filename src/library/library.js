/**
 * CofreTabs library page.
 *
 * Runs as an extension page, talks to IndexedDB directly, and opens saved
 * pages through chrome.tabs. All user-controlled strings are rendered with
 * textContent. No network requests are made.
 */
import { getVault } from '../storage/vault.js';
import { normalizeBackupData } from '../lib/backup.js';
import { compactUrl, parsePageUrl, safeHttpUrlForOpening } from '../lib/url.js';
import { formatDateTime, formatNumber, monogram, plural, relativeTime, fileTimestamp } from '../lib/format.js';
import { MSG } from '../lib/messages.js';

const PAGE_SIZE = 200;
const ALLOWED_VIEWS = new Set(['all', 'recent', 'folders', 'trash', 'folder']);
const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

const vault = getVault();

const state = {
  view: 'all',
  folderId: null,
  query: '',
  sort: 'newest',
  limit: PAGE_SIZE,
  data: null,
  folders: [],
  stats: { active: 0, trashed: 0, folders: 0 },
  editingId: null,
  folderEditingId: null,
  importRaw: null,
  importParsed: null,
  loading: false,
  loadSeq: 0,
  confirmResolve: null,
  toastTimer: 0,
  toastAction: null,
  searchTimer: 0,
  notice: null,
  prefill: null,
  version: '1.0.0',
};

const dom = {};
const NOTICE_TEXT = {
  'restricted-page':
    'CofreTabs cannot inject its panel into browser-internal pages. Open a normal http(s) page and use the toolbar icon. Existing tabs are still available below.',
  'injection-failed':
    'The panel could not open on that page. You can add the page manually below; nothing has been saved automatically.',
  'panel-unavailable':
    'The local vault could not start the panel. Your library is still available below.',
  'panel-init-failed':
    'The panel could not read the current page. Nothing was saved. You can add the page manually.',
  'no-active-tab': 'No active tab was available when the toolbar icon was clicked.',
};

// ------------------------------------------------------------------- boot

cacheDom();
void init();

function cacheDom() {
  const ids = [
    'main',
    'view-kicker',
    'view-title',
    'search-input',
    'sort-select',
    'context-actions',
    'btn-add',
    'notice',
    'notice-text',
    'notice-actions',
    'notice-close',
    'result-count',
    'content',
    'load-more-wrap',
    'btn-load-more',
    'nav-count-all',
    'nav-count-folders',
    'nav-count-trash',
    'folder-count',
    'folder-list',
    'storage-line',
    'version-label',
    'btn-export',
    'btn-import',
    'dialog-add',
    'form-add',
    'add-url',
    'add-title',
    'add-error',
    'add-submit',
    'dialog-edit',
    'form-edit',
    'edit-url',
    'edit-title',
    'edit-folder',
    'edit-note',
    'edit-error',
    'edit-submit',
    'dialog-folder',
    'form-folder',
    'folder-name',
    'folder-error',
    'folder-submit',
    'dialog-confirm',
    'confirm-title',
    'confirm-message',
    'confirm-ok',
    'confirm-cancel',
    'confirm-cancel-x',
    'dialog-import',
    'import-file',
    'import-preview',
    'import-mode-fieldset',
    'import-confirm-replace',
    'import-replace-check',
    'import-error',
    'import-submit',
    'toast',
    'toast-text',
    'toast-action',
  ];
  for (const id of ids) {
    dom[toCamel(id)] = document.getElementById(id);
  }
}

function toCamel(id) {
  return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

async function init() {
  try {
    state.version = chrome.runtime.getManifest().version;
    dom.versionLabel.textContent = `v${state.version}`;
  } catch {
    /* version label keeps its default */
  }

  hydrateFromUrl();
  wireStaticEvents();

  dom.content.setAttribute('aria-busy', 'true');
  renderLoading();

  try {
    await vault.init();
    await load({ resetLimit: true });
  } catch (error) {
    renderFatal(error);
  }
  renderNotice();
}

function hydrateFromUrl() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    params = new URLSearchParams();
  }

  const view = params.get('view');
  if (view && ALLOWED_VIEWS.has(view)) state.view = view;
  const folder = params.get('folder');
  if (folder) {
    state.folderId = folder;
    state.view = 'folder';
  }
  const query = params.get('q');
  if (query) state.query = query.slice(0, 200);

  try {
    const savedSort = localStorage.getItem('cofretabs.sort');
    if (['newest', 'oldest', 'title', 'folder'].includes(savedSort)) state.sort = savedSort;
  } catch {
    /* storage may be unavailable in private contexts */
  }

  state.notice = params.get('notice');
  const prefillUrl = parsePageUrl(params.get('prefillUrl') || '');
  if (prefillUrl) {
    state.prefill = {
      url: prefillUrl.href,
      title: (params.get('prefillTitle') || '').slice(0, 200),
    };
  }

  dom.searchInput.value = state.query;
  dom.sortSelect.value = state.sort;
}

function wireStaticEvents() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      if (!view) return;
      navigate(view);
    });
  });

  dom.searchInput.addEventListener('input', onSearchInput);
  dom.sortSelect.addEventListener('change', () => {
    state.sort = dom.sortSelect.value;
    try {
      localStorage.setItem('cofretabs.sort', state.sort);
    } catch {
      /* non-fatal */
    }
    void load({ resetLimit: true });
  });

  dom.btnAdd.addEventListener('click', () => openAddDialog(state.prefill));
  dom.btnLoadMore.addEventListener('click', () => {
    state.limit += PAGE_SIZE;
    void load({ resetLimit: false });
  });

  dom.btnExport.addEventListener('click', () => void exportBackup());
  dom.btnImport.addEventListener('click', openImportDialog);
  dom.importFile.addEventListener('change', () => void readImportFile());
  dom.importSubmit.addEventListener('click', () => void runImport());
  dom.importReplaceCheck.addEventListener('change', updateImportSubmitState);
  document.querySelectorAll('input[name="import-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const replace = getImportMode() === 'replace';
      dom.importConfirmReplace.hidden = !replace;
      if (!replace) dom.importReplaceCheck.checked = false;
      updateImportSubmitState();
    });
  });

  dom.content.addEventListener('click', onContentClick);
  dom.folderList.addEventListener('click', onSidebarFolderClick);
  dom.noticeClose.addEventListener('click', dismissNotice);

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  dom.formAdd.addEventListener('submit', onAddSubmit);
  dom.formEdit.addEventListener('submit', onEditSubmit);
  dom.formFolder.addEventListener('submit', onFolderSubmit);
  dom.dialogEdit.addEventListener('close', () => {
    hideError(dom.editError);
    state.editingId = null;
  });
  dom.dialogFolder.addEventListener('close', () => {
    hideError(dom.folderError);
    state.folderEditingId = null;
  });

  dom.confirmOk.addEventListener('click', () => resolveConfirm(true));
  dom.confirmCancel.addEventListener('click', () => resolveConfirm(false));
  dom.confirmCancelX.addEventListener('click', () => resolveConfirm(false));
  dom.dialogConfirm.addEventListener('close', () => resolveConfirm(false, true));
  dom.dialogImport.addEventListener('close', resetImportDialog);

  dom.toastAction.addEventListener('click', async () => {
    const action = state.toastAction;
    hideToast();
    if (typeof action === 'function') {
      try {
        await action();
      } catch {
        showToast('That action could not be completed.', { tone: 'error' });
      }
    }
  });
}

// ------------------------------------------------------------------ loading

async function load({ resetLimit = false } = {}) {
  if (resetLimit) state.limit = PAGE_SIZE;
  const seq = ++state.loadSeq;
  state.loading = true;
  dom.content.setAttribute('aria-busy', 'true');

  try {
    const data = await vault.getLibrary({
      view: state.view === 'folder' ? 'folder' : state.view,
      folderId: state.folderId,
      query: state.query,
      sort: state.sort,
      limit: state.limit,
    });
    if (seq !== state.loadSeq) return;

    if (state.view === 'folder' && !data.folders.some((folder) => folder.id === state.folderId)) {
      state.view = 'all';
      state.folderId = null;
      await load({ resetLimit: true });
      return;
    }

    state.data = data;
    state.folders = data.folders;
    state.stats = data.stats;
    renderAll();
  } catch (error) {
    if (seq !== state.loadSeq) return;
    renderFatal(error);
  } finally {
    if (seq === state.loadSeq) {
      state.loading = false;
      dom.content.setAttribute('aria-busy', 'false');
    }
  }
}

function navigate(view, folderId = null) {
  state.view = ALLOWED_VIEWS.has(view) ? view : 'all';
  state.folderId = state.view === 'folder' ? folderId : null;
  state.limit = PAGE_SIZE;
  if (state.view === 'folders' && state.query) {
    state.query = '';
    dom.searchInput.value = '';
  }
  void load({ resetLimit: true });
}

function renderLoading() {
  const wrap = h('div', { class: 'empty', id: 'loading-state' }, [
    h('div', { class: 'empty-mark', text: '>_' }),
    h('h2', { text: 'READING LOCAL VAULT...' }),
    h('p', { text: 'Opening your IndexedDB vault. Nothing leaves this device.' }),
  ]);
  dom.content.replaceChildren(wrap);
}

function renderFatal(error) {
  const message =
    error && typeof error.message === 'string' && error.message
      ? error.message
      : 'The local vault could not be opened.';
  const wrap = h('div', { class: 'empty' }, [
    h('div', { class: 'empty-mark', text: '[ ! ]' }),
    h('h2', { text: 'VAULT UNAVAILABLE' }),
    h('p', { text: message }),
    h('p', {
      class: 'empty-hint',
      text: 'IndexedDB may be disabled by your browser policy. Nothing has been sent anywhere.',
    }),
    h('div', { class: 'empty-actions' }, [
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => location.reload(),
      }, [document.createTextNode('> RETRY')]),
    ]),
  ]);
  dom.content.replaceChildren(wrap);
  dom.content.setAttribute('aria-busy', 'false');
  dom.btnAdd.disabled = true;
  dom.btnExport.disabled = true;
  dom.btnImport.disabled = true;
}

function renderNotice() {
  if (!state.notice) {
    dom.notice.hidden = true;
    return;
  }
  const message = NOTICE_TEXT[state.notice] || 'CofreTabs opened the library as a fallback.';
  dom.noticeText.textContent = message;
  dom.noticeActions.replaceChildren();

  if (state.prefill) {
    dom.noticeActions.append(
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => openAddDialog(state.prefill),
      }, [document.createTextNode('> ADD THIS PAGE')]),
    );
  }
  dom.noticeActions.append(
    h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: () => navigate('all'),
    }, [document.createTextNode('OPEN ALL TABS')]),
  );
  dom.notice.hidden = false;
}

function dismissNotice() {
  state.notice = null;
  state.prefill = null;
  dom.notice.hidden = true;
  syncUrl();
}

// --------------------------------------------------------------- rendering

function renderAll() {
  renderNav();
  renderSidebarFolders();
  renderHeader();
  renderContent();
  renderCounts();
  syncUrl();
}

function renderNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    const view = button.getAttribute('data-view');
    const active = view === state.view || (view === 'folders' && state.view === 'folder');
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  dom.navCountAll.textContent = formatNumber(state.stats.active);
  dom.navCountFolders.textContent = formatNumber(state.stats.folders);
  dom.navCountTrash.textContent = formatNumber(state.stats.trashed);
  dom.folderCount.textContent = formatNumber(state.folders.length);
}

function renderSidebarFolders() {
  dom.folderList.replaceChildren();
  if (!state.folders.length) {
    dom.folderList.append(h('span', { class: 'folder-empty', text: 'folders appear when you save a page.' }));
    return;
  }
  for (const folder of state.folders) {
    const active = state.view === 'folder' && state.folderId === folder.id;
    const button = h('button', {
      class: 'folder-link',
      type: 'button',
      'data-folder-id': folder.id,
      title: `${folder.name} — ${folder.count} ${plural(folder.count, 'tab')}`,
    }, [
      h('span', { class: 'folder-link-name', text: folder.name }),
      h('span', { class: 'folder-link-count', text: formatNumber(folder.count) }),
    ]);
    if (active) button.setAttribute('data-active', 'true');
    dom.folderList.append(button);
  }
}

function renderHeader() {
  const folder = currentFolder();
  let title = 'ALL TABS';
  let kicker = 'VAULT / ALL';
  if (state.query) {
    title = 'SEARCH RESULTS';
    kicker = `VAULT / SEARCH`;
  } else if (state.view === 'recent') {
    title = 'RECENTLY SAVED';
    kicker = 'VAULT / RECENT';
  } else if (state.view === 'folders') {
    title = 'WEBSITE FOLDERS';
    kicker = 'VAULT / FOLDERS';
  } else if (state.view === 'trash') {
    title = 'TRASH';
    kicker = 'VAULT / TRASH';
  } else if (state.view === 'folder') {
    title = folder?.name || 'FOLDER';
    kicker = 'VAULT / FOLDER';
  }

  dom.viewKicker.textContent = kicker;
  dom.viewTitle.textContent = title;
  document.title = `CofreTabs — ${title}`;
  dom.viewKicker.title = kicker;

  const sortWrap = dom.sortSelect.closest('.sort-wrap');
  if (sortWrap) sortWrap.hidden = state.view === 'folders';

  dom.contextActions.replaceChildren();
  if (state.view === 'trash' && state.stats.trashed > 0) {
    dom.contextActions.append(
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        id: 'btn-empty-trash',
        onclick: () => void emptyTrash(),
      }, [document.createTextNode('EMPTY TRASH')]),
    );
  }
  if (state.view === 'folder' && folder) {
    dom.contextActions.append(
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        onclick: () => openFolderRename(folder),
      }, [document.createTextNode('RENAME FOLDER')]),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onclick: () => void deleteFolder(folder),
      }, [document.createTextNode('DELETE FOLDER')]),
    );
  }
}

function renderCounts() {
  const total = state.data?.total ?? 0;
  let label = `${formatNumber(total)} ${plural(total, 'TAB').toUpperCase()}`;
  if (state.query) label = `${formatNumber(total)} ${plural(total, 'MATCH', 'MATCHES').toUpperCase()}`;
  else if (state.view === 'trash') label = `${formatNumber(total)} IN TRASH`;
  else if (state.view === 'recent') label = `${formatNumber(total)} RECENT`;
  dom.resultCount.textContent = label;

  dom.storageLine.textContent = `${formatNumber(state.stats.active)} saved · ${formatNumber(
    state.stats.folders,
  )} folders · ${formatNumber(state.stats.trashed)} trashed`;
}

function renderContent() {
  const items = state.data?.items || [];

  if (state.view === 'folders') {
    renderFolderGrid();
    dom.loadMoreWrap.hidden = true;
    return;
  }

  dom.loadMoreWrap.hidden = !(state.data && state.data.total > items.length);

  if (!items.length) {
    dom.content.replaceChildren(emptyState());
    return;
  }

  const list = h('div', { class: 'tab-list', role: 'list' });
  for (const entry of items) {
    list.append(tabRow(entry));
  }
  dom.content.replaceChildren(list);
}

function renderFolderGrid() {
  if (!state.folders.length) {
    dom.content.replaceChildren(
      emptyState({
        mark: '[ FOLDERS ]',
        title: 'NO WEBSITE FOLDERS YET',
        text: 'Save a page and CofreTabs files it by website automatically. youtube.com goes to YouTube, github.com to GitHub, and so on.',
        actions: [actionButton('> ADD A TAB', () => openAddDialog(state.prefill), 'btn-primary')],
      }),
    );
    return;
  }

  const grid = h('div', { class: 'folder-grid' });
  for (const folder of state.folders) {
    const openButton = h('button', {
      class: 'folder-open',
      type: 'button',
      'data-action': 'open-folder',
      'data-folder-id': folder.id,
      'aria-label': `Open folder ${folder.name}, ${folder.count} ${plural(folder.count, 'tab')}`,
    }, [
      h('span', { class: 'folder-mark', text: 'DIR //' }),
      h('span', { class: 'folder-name', text: folder.name }),
      h('span', { class: 'folder-count' }, [
        h('strong', { text: formatNumber(folder.count) }),
        document.createTextNode(` ${plural(folder.count, 'TAB').toUpperCase()}`),
      ]),
    ]);

    const footer = h('div', { class: 'folder-footer' }, [
      h('span', { text: folder.lastSavedAt ? `saved ${relativeTime(folder.lastSavedAt)}` : 'no saved tabs' }),
      h('div', { class: 'folder-actions' }, [
        h('button', {
          type: 'button',
          'data-action': 'rename-folder',
          'data-folder-id': folder.id,
          text: 'RENAME',
        }),
        h('button', {
          type: 'button',
          'data-action': 'delete-folder',
          'data-folder-id': folder.id,
          text: 'DELETE',
        }),
      ]),
    ]);

    grid.append(h('article', { class: 'folder-card' }, [openButton, footer]));
  }
  dom.content.replaceChildren(grid);
}

function tabRow(entry) {
  const isTrash = state.view === 'trash';
  const favicon = h('div', { class: 'tab-favicon', 'aria-hidden': 'true' });

  if (typeof entry.faviconUrl === 'string' && entry.faviconUrl.startsWith('data:image/')) {
    const img = h('img', { src: entry.faviconUrl, alt: '', width: '18', height: '18' });
    img.addEventListener('error', () => {
      favicon.replaceChildren(h('span', { class: 'tab-monogram', text: monogram(entry.hostname) }));
    });
    favicon.append(img);
  } else {
    favicon.append(h('span', { class: 'tab-monogram', text: monogram(entry.hostname) }));
  }

  const title = h('button', {
    class: 'tab-title',
    type: 'button',
    title: `Open ${entry.title}`,
    'data-action': 'open-tab',
    'data-url': entry.url,
    text: entry.title || 'Untitled page',
  });

  const meta = h('div', { class: 'tab-meta' }, [
    h('button', {
      class: 'folder-tag',
      type: 'button',
      'data-action': 'open-folder',
      'data-folder-id': entry.folderId,
      title: `Show all tabs in ${entry.folderName || 'this folder'}`,
      text: entry.folderName || 'Unsorted',
    }),
    h('time', {
      datetime: new Date(entry.createdAt).toISOString(),
      title: formatDateTime(entry.createdAt),
      text: isTrash ? `trashed ${relativeTime(entry.deletedAt)}` : `saved ${relativeTime(entry.createdAt)}`,
    }),
    entry.note ? h('span', { class: 'note-flag', text: 'NOTE' }) : null,
  ]);

  const mainParts = [
    title,
    h('div', { class: 'tab-url', title: entry.url, text: compactUrl(entry.url, 110) }),
    meta,
  ];
  if (entry.note) {
    mainParts.push(h('div', { class: 'tab-note', title: entry.note, text: entry.note }));
  }

  const actions = h('div', { class: 'tab-actions' });
  if (isTrash) {
    actions.append(
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        'data-action': 'restore-tab',
        'data-id': entry.id,
        'aria-label': `Restore ${entry.title}`,
        text: 'RESTORE',
      }),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        'data-action': 'delete-forever',
        'data-id': entry.id,
        'aria-label': `Delete ${entry.title} permanently`,
        text: 'DELETE',
      }),
    );
  } else {
    actions.append(
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        'data-action': 'edit-tab',
        'data-id': entry.id,
        'aria-label': `Edit ${entry.title}`,
        text: 'EDIT',
      }),
      h('button', {
        class: 'btn btn-ghost',
        type: 'button',
        'data-action': 'trash-tab',
        'data-id': entry.id,
        'aria-label': `Move ${entry.title} to trash`,
        text: 'TRASH',
      }),
    );
  }

  const row = h('div', { class: 'tab-row', role: 'listitem' }, [favicon, h('div', { class: 'tab-main' }, mainParts), actions]);
  row.dataset.id = entry.id;
  return row;
}

function emptyState(options = {}) {
  const view = state.view;
  let defaults;

  if (state.query) {
    defaults = {
      mark: '[ NO MATCHES ]',
      title: 'NOTHING FOUND',
      text: `No saved tabs match “${state.query}”. Search covers titles, URLs, hostnames, folder names and notes.`,
      actions: [actionButton('CLEAR SEARCH', clearSearch, 'btn-ghost')],
    };
  } else if (view === 'trash') {
    defaults = {
      mark: '[ TRASH EMPTY ]',
      title: 'NOTHING IN THE TRASH',
      text: 'Tabs you move to the trash wait here until you restore or permanently delete them.',
      actions: [actionButton('OPEN ALL TABS', () => navigate('all'), 'btn-ghost')],
    };
  } else if (view === 'folder') {
    defaults = {
      mark: '[ EMPTY FOLDER ]',
      title: 'THIS FOLDER IS EMPTY',
      text: 'Saved pages from this website will appear here. You can also move tabs into this folder from the edit dialog.',
      actions: [actionButton('OPEN ALL TABS', () => navigate('all'), 'btn-ghost')],
    };
  } else {
    defaults = {
      mark: '>_',
      title: 'YOUR VAULT IS EMPTY',
      text: 'Click the CofreTabs icon while browsing to slide open the panel, review the page, then press SAVE THIS TAB. Everything stays in this browser.',
      actions: [actionButton('> ADD A TAB', () => openAddDialog(state.prefill), 'btn-primary')],
    };
  }

  const merged = { ...defaults, ...options };
  return h('div', { class: 'empty' }, [
    h('div', { class: 'empty-mark', text: merged.mark }),
    h('h2', { text: merged.title }),
    h('p', { text: merged.text }),
    merged.actions?.length ? h('div', { class: 'empty-actions' }, merged.actions) : null,
    h('p', { class: 'empty-hint', text: 'LOCAL ONLY · NO ACCOUNTS · NO ANALYTICS' }),
  ]);
}

function actionButton(label, handler, className = 'btn') {
  return h('button', { class: className, type: 'button', onclick: handler }, [document.createTextNode(label)]);
}

function currentFolder() {
  if (state.view !== 'folder') return null;
  return state.folders.find((folder) => folder.id === state.folderId) || null;
}

// ---------------------------------------------------------------- interaction

function onContentClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!target) return;
  const action = target.getAttribute('data-action');

  if (action === 'open-tab') {
    void openSavedUrl(target.getAttribute('data-url') || '');
  } else if (action === 'open-folder') {
    const folderId = target.getAttribute('data-folder-id') || '';
    if (!folderId) return;
    navigate('folder', folderId);
  } else if (action === 'edit-tab') {
    const entry = findEntry(target.getAttribute('data-id'));
    if (entry) openEditDialog(entry);
  } else if (action === 'trash-tab') {
    void trashEntry(target.getAttribute('data-id'));
  } else if (action === 'restore-tab') {
    void restoreEntry(target.getAttribute('data-id'));
  } else if (action === 'delete-forever') {
    void deleteForever(target.getAttribute('data-id'));
  } else if (action === 'rename-folder') {
    const folder = state.folders.find((candidate) => candidate.id === target.getAttribute('data-folder-id'));
    if (folder) openFolderRename(folder);
  } else if (action === 'delete-folder') {
    const folder = state.folders.find((candidate) => candidate.id === target.getAttribute('data-folder-id'));
    if (folder) void deleteFolder(folder);
  }
}

function onSidebarFolderClick(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-folder-id]') : null;
  if (!target) return;
  const folderId = target.getAttribute('data-folder-id');
  if (folderId) navigate('folder', folderId);
}

function onSearchInput() {
  const query = dom.searchInput.value.trim();
  state.query = query;
  state.limit = PAGE_SIZE;
  if (state.view === 'folders' && query) state.view = 'all';
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    void load({ resetLimit: true });
  }, 160);
}

function clearSearch() {
  dom.searchInput.value = '';
  state.query = '';
  void load({ resetLimit: true });
  dom.searchInput.focus();
}

function findEntry(id) {
  if (!id || !state.data) return null;
  return state.data.items.find((entry) => entry.id === id) || null;
}

async function openSavedUrl(url) {
  const safe = safeHttpUrlForOpening(url);
  if (!safe) {
    showToast('This saved entry does not have a valid http(s) URL.', { tone: 'error' });
    return;
  }
  try {
    await chrome.tabs.create({ url: safe, active: true });
  } catch {
    showToast('The browser could not open that page.', { tone: 'error' });
  }
}

async function trashEntry(id) {
  if (!id) return;
  try {
    const entry = findEntry(id);
    await vault.moveToTrash(id);
    await load({ resetLimit: false });
    refreshBadge();
    showToast('Moved to Trash. Nothing was permanently deleted.', {
      actionLabel: 'UNDO',
      action: async () => {
        await vault.restoreTab(id);
        await load({ resetLimit: false });
        refreshBadge();
        showToast(`Restored${entry ? ` “${entry.title}”` : ''}.`);
      },
    });
  } catch (error) {
    showToast(error?.message || 'Could not move that tab to the trash.', { tone: 'error' });
  }
}

async function restoreEntry(id) {
  if (!id) return;
  try {
    await vault.restoreTab(id);
    await load({ resetLimit: false });
    refreshBadge();
    showToast('Tab restored to its website folder.');
  } catch (error) {
    showToast(error?.message || 'Could not restore that tab.', { tone: 'error' });
  }
}

async function deleteForever(id) {
  if (!id) return;
  const entry = findEntry(id);
  const confirmed = await confirmDialog({
    title: 'DELETE PERMANENTLY?',
    message: `“${entry?.title || 'This saved tab'}” will be removed from the vault and cannot be recovered. Export a backup first if you are unsure.`,
    confirmLabel: 'DELETE FOREVER',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await vault.deleteForever(id);
    await load({ resetLimit: false });
    refreshBadge();
    showToast('Permanently deleted.');
  } catch (error) {
    showToast(error?.message || 'Could not delete that tab.', { tone: 'error' });
  }
}

async function emptyTrash() {
  const count = state.stats.trashed;
  if (!count) return;
  const confirmed = await confirmDialog({
    title: 'EMPTY THE TRASH?',
    message: `This permanently deletes ${formatNumber(count)} trashed ${plural(
      count,
      'tab',
    )}. It cannot be undone. Consider exporting a backup first.`,
    confirmLabel: 'EMPTY TRASH',
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await vault.emptyTrash();
    await load({ resetLimit: true });
    refreshBadge();
    showToast(`Trash emptied. ${result.deleted} ${plural(result.deleted, 'tab')} permanently deleted.`);
  } catch (error) {
    showToast(error?.message || 'Could not empty the trash.', { tone: 'error' });
  }
}

async function deleteFolder(folder) {
  const confirmed = await confirmDialog({
    title: 'DELETE FOLDER?',
    message: `Deleting “${folder.name}” moves its ${formatNumber(folder.count)} active ${plural(
      folder.count,
      'tab',
    )} to Trash. Nothing is permanently deleted, and trashed tabs can be restored.`,
    confirmLabel: 'DELETE FOLDER',
    danger: true,
  });
  if (!confirmed) return;

  try {
    const result = await vault.deleteFolder(folder.id);
    if (state.view === 'folder' && state.folderId === folder.id) {
      state.view = 'all';
      state.folderId = null;
    }
    await load({ resetLimit: true });
    refreshBadge();
    showToast(`“${result.deletedFolder}” deleted. ${result.movedToTrash} ${plural(result.movedToTrash, 'tab')} moved to Trash.`);
  } catch (error) {
    showToast(error?.message || 'Could not delete that folder.', { tone: 'error' });
  }
}

// -------------------------------------------------------------------- dialogs

function openAddDialog(prefill = null) {
  hideError(dom.addError);
  dom.addUrl.value = prefill?.url || '';
  dom.addTitle.value = prefill?.title || '';
  dom.addSubmit.disabled = false;
  dom.dialogAdd.showModal();
  setTimeout(() => dom.addUrl.focus(), 0);
}

async function onAddSubmit(event) {
  event.preventDefault();
  hideError(dom.addError);
  const url = dom.addUrl.value.trim();
  if (!parsePageUrl(url)) {
    showError(dom.addError, 'Enter a complete http(s) URL, for example https://example.com/page.');
    return;
  }

  dom.addSubmit.disabled = true;
  try {
    const result = await vault.saveTab({
      url,
      title: dom.addTitle.value,
      faviconUrl: '',
      note: '',
    });

    if (result.duplicate) {
      showError(
        dom.addError,
        `That page is already in your vault${result.folder?.name ? ` under ${result.folder.name}` : ''}.`,
      );
      dom.addSubmit.disabled = false;
      return;
    }

    dom.dialogAdd.close();
    dom.formAdd.reset();
    await load({ resetLimit: true });
    refreshBadge();
    showToast(`Saved to ${result.folder?.name || 'your vault'}.`);
  } catch (error) {
    showError(dom.addError, error?.message || 'The local vault could not save that page.');
    dom.addSubmit.disabled = false;
  }
}

function openEditDialog(entry) {
  hideError(dom.editError);
  state.editingId = entry.id;
  dom.editUrl.textContent = entry.url;
  dom.editTitle.value = entry.title;
  dom.editNote.value = entry.note || '';

  dom.editFolder.replaceChildren();
  const seen = new Set();
  for (const folder of state.folders) {
    seen.add(folder.id);
    dom.editFolder.append(h('option', { value: folder.id, text: folder.name }));
  }
  if (entry.folderId && !seen.has(entry.folderId)) {
    dom.editFolder.append(h('option', { value: entry.folderId, text: entry.folderName || 'Current folder' }));
  }
  dom.editFolder.value = entry.folderId || dom.editFolder.options[0]?.value || '';
  dom.editFolder.disabled = dom.editFolder.options.length === 0;
  dom.editSubmit.disabled = false;
  dom.dialogEdit.showModal();
  setTimeout(() => {
    dom.editTitle.focus();
    dom.editTitle.select();
  }, 0);
}

async function onEditSubmit(event) {
  event.preventDefault();
  if (!state.editingId) return;
  hideError(dom.editError);
  const title = dom.editTitle.value.trim();
  if (!title) {
    showError(dom.editError, 'A saved tab needs a title. Use the page title or a short label.');
    return;
  }

  dom.editSubmit.disabled = true;
  try {
    const changes = { title, note: dom.editNote.value };
    if (!dom.editFolder.disabled && dom.editFolder.value) changes.folderId = dom.editFolder.value;
    await vault.updateTab(state.editingId, changes);
    dom.dialogEdit.close();
    await load({ resetLimit: false });
    refreshBadge();
    showToast('Saved tab updated.');
  } catch (error) {
    showError(dom.editError, error?.message || 'Could not update that saved tab.');
    dom.editSubmit.disabled = false;
  }
}

function openFolderRename(folder) {
  hideError(dom.folderError);
  state.folderEditingId = folder.id;
  dom.folderName.value = folder.name;
  dom.folderSubmit.disabled = false;
  dom.dialogFolder.showModal();
  setTimeout(() => {
    dom.folderName.focus();
    dom.folderName.select();
  }, 0);
}

async function onFolderSubmit(event) {
  event.preventDefault();
  if (!state.folderEditingId) return;
  hideError(dom.folderError);
  const name = dom.folderName.value.trim();
  if (!name) {
    showError(dom.folderError, 'Folder names cannot be empty.');
    return;
  }
  dom.folderSubmit.disabled = true;
  try {
    await vault.renameFolder(state.folderEditingId, name);
    dom.dialogFolder.close();
    await load({ resetLimit: false });
    refreshBadge();
    showToast('Folder renamed.');
  } catch (error) {
    showError(dom.folderError, error?.message || 'Could not rename that folder.');
    dom.folderSubmit.disabled = false;
  }
}

function confirmDialog({ title, message, confirmLabel = 'CONFIRM', danger = true }) {
  return new Promise((resolve) => {
    state.confirmResolve = resolve;
    dom.confirmTitle.textContent = title;
    dom.confirmMessage.textContent = message;
    dom.confirmOk.textContent = confirmLabel;
    dom.confirmOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    dom.dialogConfirm.showModal();
  });
}

function resolveConfirm(value, fromClose = false) {
  const resolve = state.confirmResolve;
  state.confirmResolve = null;
  if (!fromClose && dom.dialogConfirm.open) dom.dialogConfirm.close();
  if (typeof resolve === 'function') resolve(value);
}

// --------------------------------------------------------------------- backup

async function exportBackup() {
  dom.btnExport.disabled = true;
  try {
    const backup = await vault.exportBackup(state.version);
    if (!backup.counts.tabs) {
      showToast('Your vault is empty — nothing to export yet.', { tone: 'error' });
      return;
    }
    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cofretabs-backup-${fileTimestamp()}.json`;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    showToast(
      `Exported ${formatNumber(backup.counts.tabs)} ${plural(backup.counts.tabs, 'tab')}. The file stays on your device.`,
    );
  } catch (error) {
    showToast(error?.message || 'Could not create the backup.', { tone: 'error' });
  } finally {
    dom.btnExport.disabled = false;
  }
}

function openImportDialog() {
  resetImportDialog();
  dom.dialogImport.showModal();
  setTimeout(() => dom.importFile.focus(), 0);
}

function resetImportDialog() {
  state.importRaw = null;
  state.importParsed = null;
  dom.importFile.value = '';
  dom.importPreview.hidden = true;
  dom.importPreview.replaceChildren();
  hideError(dom.importError);
  dom.importConfirmReplace.hidden = true;
  dom.importReplaceCheck.checked = false;
  const merge = document.querySelector('input[name="import-mode"][value="merge"]');
  if (merge) merge.checked = true;
  dom.importSubmit.disabled = true;
}

async function readImportFile() {
  hideError(dom.importError);
  dom.importPreview.hidden = true;
  dom.importPreview.replaceChildren();
  state.importRaw = null;
  state.importParsed = null;
  updateImportSubmitState();

  const file = dom.importFile.files?.[0];
  if (!file) return;

  if (file.size > MAX_IMPORT_BYTES) {
    showError(dom.importError, 'That backup file is too large to import safely.');
    return;
  }

  try {
    const text = await file.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      showError(dom.importError, 'That file is not valid JSON. Choose a CofreTabs backup file.');
      return;
    }
    const normalized = normalizeBackupData(raw);
    state.importRaw = raw;
    state.importParsed = normalized;
    renderImportPreview(file, normalized);
    updateImportSubmitState();
  } catch (error) {
    showError(dom.importError, error?.message || 'This backup could not be read.');
    updateImportSubmitState();
  }
}

function renderImportPreview(file, normalized) {
  const trashed = normalized.tabs.filter((entry) => Boolean(entry.deletedAt)).length;
  dom.importPreview.replaceChildren(
    h('div', {}, [
      h('strong', { text: 'READY TO IMPORT' }),
      document.createTextNode(` — ${formatNumber(normalized.tabs.length)} ${plural(normalized.tabs.length, 'tab')}, `),
      document.createTextNode(`${formatNumber(normalized.folders.length)} ${plural(normalized.folders.length, 'folder')}`),
      document.createTextNode(trashed ? ` (${trashed} in trash)` : ''),
    ]),
    h('div', { text: `file: ${file.name}` }),
    h('div', {
      text: normalized.meta.exportedAt ? `exported: ${normalized.meta.exportedAt}` : 'export date not recorded',
    }),
  );
  dom.importPreview.hidden = false;
}

function getImportMode() {
  const checked = document.querySelector('input[name="import-mode"]:checked');
  return checked?.value === 'replace' ? 'replace' : 'merge';
}

function updateImportSubmitState() {
  const ready = Boolean(state.importParsed);
  const mode = getImportMode();
  const replaceConfirmed = mode !== 'replace' || dom.importReplaceCheck.checked;
  dom.importSubmit.disabled = !ready || !replaceConfirmed;
}

async function runImport() {
  if (!state.importRaw || !state.importParsed) return;
  const mode = getImportMode();
  if (mode === 'replace' && !dom.importReplaceCheck.checked) return;

  hideError(dom.importError);
  dom.importSubmit.disabled = true;

  try {
    const result = await vault.importBackup(state.importRaw, mode);
    dom.dialogImport.close();
    await load({ resetLimit: true });
    refreshBadge();
    const skipped = result.skipped ? `, ${result.skipped} ${plural(result.skipped, 'duplicate')} skipped` : '';
    showToast(
      `Imported ${formatNumber(result.imported)} ${plural(result.imported, 'tab')}${skipped} using ${mode}.`,
    );
  } catch (error) {
    showError(dom.importError, error?.message || 'The backup could not be imported.');
    updateImportSubmitState();
  }
}

// ------------------------------------------------------------------- feedback

function showToast(message, options = {}) {
  const { tone = 'info', actionLabel = '', action = null, duration = 4800 } = options;
  clearTimeout(state.toastTimer);
  dom.toastText.textContent = message;
  dom.toast.classList.toggle('is-error', tone === 'error');
  dom.toast.hidden = false;
  state.toastAction = action;
  if (actionLabel && typeof action === 'function') {
    dom.toastAction.hidden = false;
    dom.toastAction.textContent = actionLabel;
  } else {
    dom.toastAction.hidden = true;
    state.toastAction = null;
  }
  state.toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(state.toastTimer);
  dom.toast.hidden = true;
  state.toastAction = null;
}

function showError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function hideError(node) {
  node.textContent = '';
  node.hidden = true;
}

function refreshBadge() {
  try {
    const maybe = chrome.runtime.sendMessage({ type: MSG.REFRESH_BADGE });
    if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
  } catch {
    /* The badge is cosmetic; ignore failures. */
  }
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.view === 'folder' && state.folderId) {
    params.set('view', 'folder');
    params.set('folder', state.folderId);
  } else if (state.view !== 'all') {
    params.set('view', state.view);
  }
  if (state.query) params.set('q', state.query);
  const next = params.toString();
  try {
    history.replaceState(null, '', `${location.pathname}${next ? `?${next}` : ''}`);
  } catch {
    /* history can be restricted; not important */
  }
}

// --------------------------------------------------------------------- DOM

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'onclick') node.addEventListener('click', value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

