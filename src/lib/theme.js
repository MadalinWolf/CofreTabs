/**
 * Theme handling for CofreTabs.
 *
 * Two themes only: dark (the classic retro terminal look) and light. The
 * choice is persisted in localStorage for the library page and mirrored to
 * the vault meta store so the injected panel can follow it.
 */

export const THEME_STORAGE_KEY = 'cofretabs.theme';
export const THEMES = Object.freeze(['dark', 'light']);

export function normalizeTheme(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return THEMES.includes(text) ? text : null;
}

/** Resolves the effective theme: explicit choice wins over system preference. */
export function resolveTheme(storedValue, prefersLight = false) {
  return normalizeTheme(storedValue) ?? (prefersLight ? 'light' : 'dark');
}

export function readStoredTheme(storage = safeLocalStorage()) {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistTheme(theme, storage = safeLocalStorage()) {
  const value = normalizeTheme(theme);
  if (!value) return null;
  try {
    storage?.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* storage may be unavailable; the page still uses the theme for this session */
  }
  return value;
}

export function systemPrefersLight(matchMediaFn = globalThis.matchMedia) {
  try {
    return Boolean(matchMediaFn && matchMediaFn('(prefers-color-scheme: light)').matches);
  } catch {
    return false;
  }
}

/** Applies the theme to a document root by setting `data-theme`. */
export function applyTheme(theme, root = globalThis.document?.documentElement) {
  const value = resolveTheme(theme);
  if (root) root.setAttribute('data-theme', value);
  return value;
}

export function toggleTheme(theme) {
  return resolveTheme(theme) === 'dark' ? 'light' : 'dark';
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
