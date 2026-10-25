/**
 * CofreTabs service worker (Manifest V3).
 *
 * Responsibilities:
 *  - Toolbar click: inject the slide-over panel into the active tab, or open
 *    the library page when injection is not allowed.
 *  - Own the IndexedDB connection for content-script requests.
 *  - Open saved pages and the library; keep the toolbar badge in sync.
 *
 * The worker holds no authoritative in-memory state. IndexedDB is the source
 * of truth, so Chrome suspending the worker cannot lose data.
 */
import { getVault, VaultError } from '../storage/vault.js';
import { classifyUrl } from '../lib/domain.js';
import { isRestrictedPage, parsePageUrl, safeHttpUrlForOpening } from '../lib/url.js';
import { normalizeTheme } from '../lib/theme.js';
import { MSG } from '../lib/messages.js';

const PANEL_SCRIPT = 'src/content/panel.js';
const LIBRARY_PAGE = 'src/library/library.html';
const THEME_META_KEY = 'theme';
const inFlightSaves = new Set();

function logError(context, error) {
  // Never log page URLs, titles or notes. Codes and generic messages only.
  const code = typeof error?.code === 'string' ? error.code : 'unexpected';
  console.warn(`[CofreTabs] ${context} failed (${code}).`);
}

async function refreshBadge() {
  try {
    const vault = getVault();
    const stats = await vault.getStats();
    const text = stats.active > 0 ? (stats.active > 999 ? '999+' : String(stats.active)) : '';
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color: '#39FF72' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#080B08' });
    }
  } catch (error) {
    logError('badge', error);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function libraryUrl(params = {}) {
  const url = new URL(chrome.runtime.getURL(LIBRARY_PAGE));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function openLibrary(params = {}) {
  try {
    await chrome.tabs.create({ url: libraryUrl(params), active: true });
  } catch (error) {
    logError('open-library', error);
  }
}

function injectionFallbackParams(tab, reason) {
  const params = { notice: reason };
  const raw = tab?.url || tab?.pendingUrl || '';
  const parsed = parsePageUrl(raw);
  // Only pre-fill http(s) pages; restricted pages cannot be saved anyway.
  if (parsed) {
    params.prefillUrl = parsed.href;
    if (typeof tab.title === 'string' && tab.title.trim()) params.prefillTitle = tab.title.trim().slice(0, 200);
  }
  return params;
}

async function toggleOrInjectPanel(tab) {
  if (!tab || typeof tab.id !== 'number') {
    await openLibrary({ notice: 'no-active-tab' });
    return;
  }

  const tabUrl = tab.url || tab.pendingUrl || '';
  if (!tabUrl || isRestrictedPage(tabUrl)) {
    await openLibrary({ notice: 'restricted-page' });
    return;
  }

  // If the panel is already open in this tab, a second toolbar click closes it.
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: MSG.PANEL_PING });
    if (pong?.open) {
      await chrome.tabs.sendMessage(tab.id, { type: MSG.PANEL_CLOSE });
      return;
    }
  } catch {
    // No panel yet: this is the normal path.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [PANEL_SCRIPT],
    });
  } catch (error) {
    logError('inject-panel', error);
    await openLibrary(injectionFallbackParams(tab, 'injection-failed'));
  }
}

chrome.action.onClicked.addListener((tab) => {
  toggleOrInjectPanel(tab).catch((error) => logError('toolbar', error));
});

chrome.runtime.onInstalled.addListener(() => {
  getVault()
    .init()
    .then(refreshBadge)
    .catch((error) => logError('install-init', error));
});

chrome.runtime.onStartup.addListener(() => {
  getVault()
    .init()
    .then(refreshBadge)
    .catch((error) => logError('startup-init', error));
});

// ------------------------------------------------------------------ messages

function errorPayload(error) {
  if (error && typeof error.code === 'string') {
    return { code: error.code, message: error.message || 'The local vault reported an error.' };
  }
  return {
    code: 'UNEXPECTED',
    message: 'Something went wrong while talking to the local vault. Nothing was changed.',
  };
}

async function handlePanelInit(sender) {
  const tab = sender.tab ?? (await getActiveTab());
  const rawUrl = tab?.url || tab?.pendingUrl || '';
  const parsed = parsePageUrl(rawUrl);
  if (!parsed) {
    throw new VaultError('UNSUPPORTED_PAGE', 'This page cannot be saved.');
  }

  const classification = classifyUrl(parsed.href);
  if (!classification.ok) {
    throw new VaultError('UNSUPPORTED_PAGE', classification.error);
  }

  const vault = getVault();
  await vault.init();
  const [existing, snapshot, storedTheme] = await Promise.all([
    vault.findByUrl(parsed.href),
    vault.getPanelSnapshot(),
    vault.getMeta(THEME_META_KEY).catch(() => null),
  ]);
  const favicon =
    typeof tab?.favIconUrl === 'string' &&
    tab.favIconUrl.startsWith('data:image/') &&
    tab.favIconUrl.length <= 100_000
      ? tab.favIconUrl
      : '';

  return {
    page: {
      title: typeof tab?.title === 'string' ? tab.title : '',
      url: parsed.href,
      hostname: classification.hostname,
      displayHost: classification.displayHost,
      folderName: classification.folderName,
      faviconUrl: favicon,
    },
    existing: existing
      ? {
          id: existing.id,
          title: existing.title,
          folderName: existing.folderName,
          favorite: existing.favorite === true,
          createdAt: existing.createdAt,
        }
      : null,
    snapshot,
    theme: normalizeTheme(storedTheme) ?? 'dark',
    version: chrome.runtime.getManifest().version,
  };
}

async function handleSaveTab(sender, payload) {
  const tab = sender.tab;
  if (!tab || typeof tab.id !== 'number') {
    throw new VaultError('NO_TAB', 'No active tab is available.');
  }

  const current = parsePageUrl(tab.url || tab.pendingUrl || '');
  const requested = parsePageUrl(payload?.url);
  if (!current || !requested) {
    throw new VaultError('UNSUPPORTED_PAGE', 'This page cannot be saved.');
  }
  if (current.href !== requested.href) {
    throw new VaultError('STALE_PAGE', 'The page changed since the panel opened. Close the panel and open it again.');
  }

  if (inFlightSaves.has(current.href)) {
    throw new VaultError('IN_PROGRESS', 'A save for this page is already in progress.');
  }
  inFlightSaves.add(current.href);

  try {
    const vault = getVault();
    const result = await vault.saveTab({
      url: requested.href,
      title: payload?.title ?? tab.title ?? '',
      faviconUrl: payload?.faviconUrl ?? '',
      note: '',
    });
    await refreshBadge();
    return result;
  } finally {
    inFlightSaves.delete(current.href);
  }
}

async function handleOpenUrl(payload) {
  const url = safeHttpUrlForOpening(payload?.url);
  if (!url) throw new VaultError('INVALID_URL', 'That saved page has an invalid URL.');
  await chrome.tabs.create({ url, active: true });
  return { opened: true };
}

async function handleOpenLibrary(payload) {
  const params = {};
  if (typeof payload?.folderId === 'string' && payload.folderId) params.folder = payload.folderId;
  if (typeof payload?.view === 'string' && /^[a-z]+$/.test(payload.view)) params.view = payload.view;
  if (typeof payload?.q === 'string' && payload.q.trim()) params.q = payload.q.trim().slice(0, 200);
  await openLibrary(params);
  return { opened: true };
}

async function routeMessage(message, sender) {
  if (!sender || sender.id !== chrome.runtime.id) return null;

  switch (message.type) {
    case MSG.PANEL_PING:
      return { open: true };

    case MSG.PANEL_INIT:
      return handlePanelInit(sender);

    case MSG.SAVE_TAB:
      return handleSaveTab(sender, message.payload);

    case MSG.PANEL_SNAPSHOT:
      return getVault().getPanelSnapshot();

    case MSG.SEARCH: {
      const query = typeof message.query === 'string' ? message.query.slice(0, 200) : '';
      return getVault().search(query, { limit: 8 });
    }

    case MSG.TRASH_TAB: {
      const result = await getVault().moveToTrash(message.id);
      await refreshBadge();
      return result;
    }

    case MSG.TOGGLE_FAVORITE: {
      const forced = typeof message.forced === 'boolean' ? message.forced : undefined;
      return getVault().toggleFavorite(message.id, forced);
    }

    case MSG.RESTORE_TAB: {
      const result = await getVault().restoreTab(message.id);
      await refreshBadge();
      return result;
    }

    case MSG.OPEN_URL:
      return handleOpenUrl(message.payload);

    case MSG.OPEN_LIBRARY:
      return handleOpenLibrary(message.payload);

    case MSG.REFRESH_BADGE:
      await refreshBadge();
      return { refreshed: true };

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  routeMessage(message, sender)
    .then((data) => {
      sendResponse({ ok: true, data });
    })
    .catch((error) => {
      logError(message.type, error);
      sendResponse({ ok: false, error: errorPayload(error) });
    });

  return true;
});
