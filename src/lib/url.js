/**
 * URL helpers shared by the service worker, the library page and tests.
 *
 * Saved URLs are treated as untrusted input: only http(s) URLs without
 * embedded credentials are accepted, length is bounded, and callers are
 * expected to render the result with textContent - never as HTML.
 */

export const MAX_URL_LENGTH = 8000;

const RESTRICTED_PROTOCOLS = new Set([
  'about:',
  'brave:',
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'data:',
  'devtools:',
  'edge:',
  'file:',
  'ftp:',
  'javascript:',
  'moz-extension:',
  'view-source:',
]);

/**
 * Parse a candidate page URL. Returns null for anything that is not a
 * safe, savable http(s) URL.
 */
export function parsePageUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // Credentials embedded in a URL could leak secrets into a backup file.
  if (url.username || url.password) return null;

  return url;
}

export function isValidPageUrl(value) {
  return parsePageUrl(value) !== null;
}

/**
 * Canonical form used both for storage and duplicate detection.
 * Default ports and empty paths are normalised by the URL parser; the URL
 * fragment is kept on purpose (anchors can identify a particular document
 * section, and silently treating two distinct URLs as one would be worse).
 */
export function normalizePageUrl(value) {
  const url = parsePageUrl(value);
  if (!url) return null;
  return url.href;
}

export function urlKeyFor(value) {
  return normalizePageUrl(value);
}

export function isRestrictedPage(value) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return true;
  }
  if (RESTRICTED_PROTOCOLS.has(parsed.protocol)) return true;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  // The Chrome Web Store refuses script injection even over https.
  if (
    parsed.hostname === 'chromewebstore.google.com' ||
    (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
  ) {
    return true;
  }
  return false;
}

/**
 * A short, human-readable line for cards and lists. Never used as HTML.
 */
export function compactUrl(value, maxLength = 72) {
  const url = parsePageUrl(value);
  if (!url) return typeof value === 'string' ? value.slice(0, maxLength) : '';

  const withoutProtocol = `${url.hostname.replace(/^www\./, '')}${url.pathname}${url.search}${url.hash}`;
  const cleaned = withoutProtocol === '/' ? url.hostname : withoutProtocol;
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

export function safeHttpUrlForOpening(value) {
  const url = parsePageUrl(value);
  return url ? url.href : null;
}
