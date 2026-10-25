/**
 * Update discovery for CofreTabs.
 *
 * CofreTabs is distributed as a ZIP from the official GitHub repository (it is
 * not on the Chrome Web Store, and it must not ship a self-updater that
 * installs code). The supported flow is therefore: the library page asks the
 * official GitHub releases API whether a newer version exists, at most once
 * every 12 hours, and shows a dismissible notification linking to the release
 * page where the user installs the update themselves.
 *
 * Privacy notes:
 *  - Only the public releases endpoint is contacted; no vault data is sent.
 *  - Failures (offline, rate limit, invalid metadata) are silent no-ops.
 *  - The endpoint URL is a constant, never user input; the response is parsed
 *    as data and never executed or injected.
 */

export const RELEASE_API_URL = 'https://api.github.com/repos/MadalinWolf/CofreTabs/releases/latest';
export const RELEASES_PAGE_URL = 'https://github.com/MadalinWolf/CofreTabs/releases';
export const UPDATE_CHECK_STORAGE_KEY = 'cofretabs.updateCheck';
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 8000;

/** Parses "v1.2.3", "1.2.3" or "1.2" into numeric parts. Returns null if invalid. */
export function parseVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

export function isValidVersion(value) {
  return parseVersion(value) !== null;
}

/** True when `candidate` is a strictly newer version than `current`. */
export function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  if (next.major !== installed.major) return next.major > installed.major;
  if (next.minor !== installed.minor) return next.minor > installed.minor;
  return next.patch > installed.patch;
}

/**
 * Pure evaluation of a release payload. Returns null when the metadata is not
 * usable, otherwise { updateAvailable, version, url }.
 */
export function evaluateRelease(payload, currentVersion) {
  if (!payload || typeof payload !== 'object') return null;
  const version = parseVersion(payload.tag_name ?? payload.name ?? '');
  if (!version) return null;
  const versionText = `${version.major}.${version.minor}.${version.patch}`;
  const url =
    typeof payload.html_url === 'string' && /^https:\/\/github\.com\//.test(payload.html_url)
      ? payload.html_url
      : RELEASES_PAGE_URL;
  return { updateAvailable: isNewerVersion(versionText, currentVersion), version: versionText, url };
}

export function readUpdateState(storage) {
  try {
    const raw = storage?.getItem(UPDATE_CHECK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      lastCheckAt: Number.isFinite(parsed?.lastCheckAt) ? parsed.lastCheckAt : 0,
      dismissedVersion: typeof parsed?.dismissedVersion === 'string' ? parsed.dismissedVersion : '',
    };
  } catch {
    return { lastCheckAt: 0, dismissedVersion: '' };
  }
}

export function writeUpdateState(state, storage) {
  try {
    storage?.setItem(UPDATE_CHECK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal: the check simply runs again next time */
  }
}

/**
 * Checks the official GitHub releases feed for a newer version.
 *
 * @returns {Promise<{checked: boolean, updateAvailable: boolean, version?: string, url?: string, reason?: string}>}
 */
export async function checkForUpdate(options = {}) {
  const {
    currentVersion,
    fetchImpl = globalThis.fetch,
    storage = null,
    now = Date.now,
    intervalMs = UPDATE_CHECK_INTERVAL_MS,
    timeoutMs = UPDATE_CHECK_TIMEOUT_MS,
    force = false,
  } = options;

  const state = readUpdateState(storage);
  if (!force && state.lastCheckAt && now() - state.lastCheckAt < intervalMs) {
    return { checked: false, updateAvailable: false, reason: 'throttled' };
  }

  const finish = (result) => {
    writeUpdateState({ ...state, lastCheckAt: now() }, storage);
    return result;
  };

  if (typeof fetchImpl !== 'function') {
    return finish({ checked: false, updateAvailable: false, reason: 'unsupported' });
  }

  let response;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    response = await fetchImpl(RELEASE_API_URL, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller?.signal,
      cache: 'no-store',
    });
  } catch {
    if (timer) clearTimeout(timer);
    return finish({ checked: false, updateAvailable: false, reason: 'offline' });
  }
  if (timer) clearTimeout(timer);

  if (!response || !response.ok) {
    return finish({ checked: false, updateAvailable: false, reason: `http-${response?.status ?? 0}` });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return finish({ checked: false, updateAvailable: false, reason: 'invalid-json' });
  }

  const evaluated = evaluateRelease(payload, currentVersion);
  if (!evaluated) return finish({ checked: false, updateAvailable: false, reason: 'invalid-metadata' });

  if (!evaluated.updateAvailable) {
    return finish({ checked: true, updateAvailable: false, version: evaluated.version });
  }
  if (state.dismissedVersion === evaluated.version) {
    return finish({ checked: true, updateAvailable: false, version: evaluated.version, reason: 'dismissed' });
  }
  return finish({ checked: true, updateAvailable: true, version: evaluated.version, url: evaluated.url });
}
