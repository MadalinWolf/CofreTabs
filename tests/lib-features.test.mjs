import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THEMES,
  THEME_STORAGE_KEY,
  normalizeTheme,
  resolveTheme,
  readStoredTheme,
  persistTheme,
  toggleTheme,
  applyTheme,
  systemPrefersLight,
} from '../src/lib/theme.js';

import {
  parseVersion,
  isValidVersion,
  isNewerVersion,
  evaluateRelease,
  readUpdateState,
  writeUpdateState,
  checkForUpdate,
  RELEASE_API_URL,
} from '../src/lib/update-check.js';

import {
  FAVORITES_FOLDER_ID,
  folderType,
  isFavoritesFolder,
  hashString,
  folderGlyph,
  PLAYFUL_GLYPHS,
} from '../src/lib/folders.js';

// --------------------------------------------------------------------- theme

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('normalizeTheme only accepts dark or light', () => {
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('LIGHT'), 'light');
  assert.equal(normalizeTheme('  dark  '), 'dark');
  assert.equal(normalizeTheme('blue'), null);
  assert.equal(normalizeTheme(''), null);
  assert.equal(normalizeTheme(null), null);
  assert.equal(normalizeTheme(undefined), null);
  assert.deepEqual(THEMES, ['dark', 'light']);
});

test('resolveTheme prefers an explicit choice over the system preference', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  // No stored choice: fall back to the system preference, defaulting to dark.
  assert.equal(resolveTheme(null, true), 'light');
  assert.equal(resolveTheme(null, false), 'dark');
  assert.equal(resolveTheme('nonsense', true), 'light');
});

test('toggleTheme flips between the two themes', () => {
  assert.equal(toggleTheme('dark'), 'light');
  assert.equal(toggleTheme('light'), 'dark');
  assert.equal(toggleTheme('unknown'), 'light');
});

test('persistTheme writes and readStoredTheme reads a normalised value', () => {
  const storage = memoryStorage();
  assert.equal(persistTheme('light', storage), 'light');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'light');
  assert.equal(readStoredTheme(storage), 'light');

  storage.setItem(THEME_STORAGE_KEY, 'SUNNY');
  assert.equal(readStoredTheme(storage), null);
});

test('readStoredTheme and persistTheme survive unavailable storage', () => {
  const broken = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readStoredTheme(broken), null);
  assert.equal(persistTheme('light', broken), 'light'); // returns the value, but does not throw
  assert.equal(readStoredTheme(null), null);
});

test('applyTheme sets data-theme on the document root', () => {
  const root = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  assert.equal(applyTheme('light', root), 'light');
  assert.equal(root.attrs['data-theme'], 'light');
  assert.equal(applyTheme('bogus', root), 'dark');
  assert.equal(root.attrs['data-theme'], 'dark');
  // A missing root must not throw.
  assert.equal(applyTheme('light', null), 'light');
});

test('systemPrefersLight reads the media query defensively', () => {
  assert.equal(systemPrefersLight(() => ({ matches: true })), true);
  assert.equal(systemPrefersLight(() => ({ matches: false })), false);
  assert.equal(systemPrefersLight(() => { throw new Error('no mq'); }), false);
  assert.equal(systemPrefersLight(undefined), false);
});

// -------------------------------------------------------------- update-check

test('parseVersion accepts v-prefixed and short versions', () => {
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion('1.2'), { major: 1, minor: 2, patch: 0 });
  assert.deepEqual(parseVersion('10.0.7'), { major: 10, minor: 0, patch: 7 });
  assert.equal(parseVersion('1.2.3.4'), null);
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion(null), null);
  assert.equal(isValidVersion('v2.0.0'), true);
  assert.equal(isValidVersion('2.0'), true);
  assert.equal(isValidVersion('nope'), false);
});

test('isNewerVersion compares numerically, not lexically', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.0'), true);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), false);
  assert.equal(isNewerVersion('0.9.0', '1.0.0'), false);
  // "1.10.0" is newer than "1.9.0" even though "1.1" < "1.9" as text.
  assert.equal(isNewerVersion('1.10.0', '1.9.0'), true);
  // Invalid inputs never report an update.
  assert.equal(isNewerVersion('garbage', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', 'garbage'), false);
});

test('evaluateRelease returns null for unusable metadata', () => {
  assert.equal(evaluateRelease(null, '1.0.0'), null);
  assert.equal(evaluateRelease({}, '1.0.0'), null);
  assert.equal(evaluateRelease({ tag_name: 'not-a-version' }, '1.0.0'), null);
});

test('evaluateRelease validates the release URL and detects updates', () => {
  const base = { tag_name: 'v1.2.0', html_url: 'https://github.com/MadalinWolf/CofreTabs/releases/tag/v1.2.0' };
  const newer = evaluateRelease(base, '1.0.0');
  assert.equal(newer.updateAvailable, true);
  assert.equal(newer.version, '1.2.0');
  assert.equal(newer.url, base.html_url);

  const current = evaluateRelease({ ...base, tag_name: 'v1.0.0' }, '1.0.0');
  assert.equal(current.updateAvailable, false);
  assert.equal(current.version, '1.0.0');

  // A non-GitHub html_url falls back to the official releases page.
  const unsafe = evaluateRelease({ tag_name: 'v9.9.9', html_url: 'https://evil.example.com/payload' }, '1.0.0');
  assert.equal(unsafe.updateAvailable, true);
  assert.equal(unsafe.url, 'https://github.com/MadalinWolf/CofreTabs/releases');
});

test('update state round-trips through storage and tolerates bad data', () => {
  const storage = memoryStorage();
  assert.deepEqual(readUpdateState(storage), { lastCheckAt: 0, dismissedVersion: '' });

  writeUpdateState({ lastCheckAt: 1234, dismissedVersion: '1.1.0' }, storage);
  assert.deepEqual(readUpdateState(storage), { lastCheckAt: 1234, dismissedVersion: '1.1.0' });

  storage.setItem('cofretabs.updateCheck', '{not json');
  assert.deepEqual(readUpdateState(storage), { lastCheckAt: 0, dismissedVersion: '' });
  assert.deepEqual(readUpdateState(null), { lastCheckAt: 0, dismissedVersion: '' });
});

function githubPayload(tag, url = 'https://github.com/MadalinWolf/CofreTabs/releases/tag/x') {
  return { ok: true, json: async () => ({ tag_name: tag, html_url: url }) };
}

test('checkForUpdate is throttled inside the interval window', async () => {
  const storage = memoryStorage({ 'cofretabs.updateCheck': JSON.stringify({ lastCheckAt: 1000 }) });
  const result = await checkForUpdate({
    currentVersion: '1.0.0',
    storage,
    now: () => 1000 + 60_000, // one minute later, well inside 12h
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  assert.equal(result.checked, false);
  assert.equal(result.reason, 'throttled');
});

test('checkForUpdate reports a newer release and honours dismissal', async () => {
  const storage = memoryStorage();
  const nowValue = 5_000_000;
  const first = await checkForUpdate({
    currentVersion: '1.0.0',
    storage,
    now: () => nowValue,
    fetchImpl: async () => githubPayload('v1.1.0'),
  });
  assert.equal(first.checked, true);
  assert.equal(first.updateAvailable, true);
  assert.equal(first.version, '1.1.0');
  assert.match(first.url, /^https:\/\/github\.com\//);

  // Dismissing the same version keeps it hidden on the next check.
  writeUpdateState({ lastCheckAt: 0, dismissedVersion: '1.1.0' }, storage);
  const second = await checkForUpdate({
    currentVersion: '1.0.0',
    storage,
    now: () => nowValue,
    force: true,
    fetchImpl: async () => githubPayload('v1.1.0'),
  });
  assert.equal(second.checked, true);
  assert.equal(second.updateAvailable, false);
  assert.equal(second.reason, 'dismissed');
});

test('checkForUpdate stays silent when already current', async () => {
  const result = await checkForUpdate({
    currentVersion: '2.0.0',
    storage: memoryStorage(),
    fetchImpl: async () => githubPayload('v1.1.0'),
  });
  assert.equal(result.checked, true);
  assert.equal(result.updateAvailable, false);
  assert.equal(result.version, '1.1.0');
});

test('checkForUpdate handles offline, HTTP and malformed responses without throwing', async () => {
  const offline = await checkForUpdate({
    currentVersion: '1.0.0',
    storage: memoryStorage(),
    fetchImpl: async () => { throw new Error('network down'); },
  });
  assert.equal(offline.checked, false);
  assert.equal(offline.reason, 'offline');

  const http500 = await checkForUpdate({
    currentVersion: '1.0.0',
    storage: memoryStorage(),
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  assert.equal(http500.checked, false);
  assert.match(http500.reason, /^http-/);

  const badJson = await checkForUpdate({
    currentVersion: '1.0.0',
    storage: memoryStorage(),
    fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('nope'); } }),
  });
  assert.equal(badJson.reason, 'invalid-json');

  const badMeta = await checkForUpdate({
    currentVersion: '1.0.0',
    storage: memoryStorage(),
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'latest' }) }),
  });
  assert.equal(badMeta.reason, 'invalid-metadata');

  const noFetch = await checkForUpdate({ currentVersion: '1.0.0', storage: memoryStorage(), fetchImpl: null });
  assert.equal(noFetch.reason, 'unsupported');
});

test('the update endpoint is the constant GitHub releases API', () => {
  assert.equal(RELEASE_API_URL, 'https://api.github.com/repos/MadalinWolf/CofreTabs/releases/latest');
});

// -------------------------------------------------------------------- folders

test('isFavoritesFolder and folderType classify the virtual collection', () => {
  assert.equal(isFavoritesFolder({ id: FAVORITES_FOLDER_ID }), true);
  assert.equal(isFavoritesFolder({ type: 'favorites' }), true);
  assert.equal(isFavoritesFolder({ id: 'folder-x', type: 'site' }), false);
  assert.equal(isFavoritesFolder(null), false);

  assert.equal(folderType({ id: FAVORITES_FOLDER_ID }), 'favorites');
  assert.equal(folderType({ type: 'custom' }), 'custom');
  assert.equal(folderType({ type: 'site' }), 'site');
  assert.equal(folderType({}), 'site');
});

test('hashString is stable and spreads distinct inputs', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.equal(hashString('abc') >>> 0, hashString('abc') >>> 0);
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.equal(hashString(''), hashString(''));
  assert.equal(hashString(null), hashString(''));
});

test('folderGlyph is stable per folder and always a known glyph', () => {
  const first = folderGlyph('folder-123');
  assert.equal(folderGlyph('folder-123'), first);
  assert.ok(PLAYFUL_GLYPHS.includes(first));
  // Different seeds stay inside the curated set (no random junk).
  for (const seed of ['a', 'b', 'folder-1', 'YouTube', 'x']) {
    assert.ok(PLAYFUL_GLYPHS.includes(folderGlyph(seed)));
  }
});
