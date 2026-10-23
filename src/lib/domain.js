/**
 * Domain classification for automatic website folders.
 *
 * Strategy:
 *  - Normalise the hostname (lowercase, ASCII/punycode, no trailing dot).
 *  - Find the registrable domain ("example.co.uk") using the ICANN section of
 *    the Public Suffix List.
 *  - Group by that registrable domain, so `www.youtube.com` and
 *    `m.youtube.com` land in the same folder.
 *  - Use a curated display-name map for well-known sites and fall back to a
 *    readable label derived from the domain.
 */
import { PSL_TEXT, PSL_SNAPSHOT } from './psl-data.js';
import { parsePageUrl } from './url.js';

export { PSL_SNAPSHOT };

let ruleSet = null;

function getRules() {
  if (!ruleSet) {
    ruleSet = new Set(PSL_TEXT.split('\n'));
  }
  return ruleSet;
}

/** Readable names for sites people save often. Keys are matched against the
 * full hostname first, then against the registrable domain. */
export const FOLDER_NAMES = Object.freeze({
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
  'github.com': 'GitHub',
  'github.io': 'GitHub Pages',
  'gist.github.com': 'GitHub Gists',
  'reddit.com': 'Reddit',
  'redd.it': 'Reddit',
  'etsy.com': 'Etsy',
  'wikipedia.org': 'Wikipedia',
  'wikimedia.org': 'Wikimedia',
  'google.com': 'Google',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'maps.google.com': 'Google Maps',
  'calendar.google.com': 'Google Calendar',
  'photos.google.com': 'Google Photos',
  'news.google.com': 'Google News',
  'x.com': 'X',
  'twitter.com': 'Twitter',
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'linkedin.com': 'LinkedIn',
  'tiktok.com': 'TikTok',
  'pinterest.com': 'Pinterest',
  'tumblr.com': 'Tumblr',
  'discord.com': 'Discord',
  'twitch.tv': 'Twitch',
  'spotify.com': 'Spotify',
  'netflix.com': 'Netflix',
  'amazon.com': 'Amazon',
  'amazon.co.uk': 'Amazon',
  'amazon.de': 'Amazon',
  'ebay.com': 'eBay',
  'stackoverflow.com': 'Stack Overflow',
  'stackexchange.com': 'Stack Exchange',
  'superuser.com': 'Super User',
  'serverfault.com': 'Server Fault',
  'news.ycombinator.com': 'Hacker News',
  'ycombinator.com': 'Y Combinator',
  'developer.mozilla.org': 'MDN',
  'mozilla.org': 'Mozilla',
  'medium.com': 'Medium',
  'dev.to': 'DEV Community',
  'substack.com': 'Substack',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'dribbble.com': 'Dribbble',
  'behance.net': 'Behance',
  'npmjs.com': 'npm',
  'openai.com': 'OpenAI',
  'anthropic.com': 'Anthropic',
  'huggingface.co': 'Hugging Face',
  'archive.org': 'Internet Archive',
  'bbc.com': 'BBC',
  'bbc.co.uk': 'BBC',
  'nytimes.com': 'The New York Times',
  'theguardian.com': 'The Guardian',
  'w3.org': 'W3C',
  'imdb.com': 'IMDb',
  'goodreads.com': 'Goodreads',
  'letterboxd.com': 'Letterboxd',
  'steampowered.com': 'Steam',
  'roblox.com': 'Roblox',
  'bandcamp.com': 'Bandcamp',
  'soundcloud.com': 'SoundCloud',
  'patreon.com': 'Patreon',
  'ko-fi.com': 'Ko-fi',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  'chromewebstore.google.com': 'Chrome Web Store',
  'addons.mozilla.org': 'Firefox Add-ons',
  'codepen.io': 'CodePen',
  'jsfiddle.net': 'JSFiddle',
  'replit.com': 'Replit',
  'vercel.com': 'Vercel',
  'netlify.com': 'Netlify',
  'producthunt.com': 'Product Hunt',
  'news.ycombinator.com': 'Hacker News',
});

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isIpHost(hostname) {
  if (typeof hostname !== 'string') return false;
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;
  if (hostname.includes(':')) return true;
  return IPV4_RE.test(hostname);
}

/**
 * Normalise a hostname or a hostname-ish URL into a lowercase ASCII hostname.
 * Returns '' when the input cannot be a hostname.
 */
export function normalizeHostname(input) {
  if (typeof input !== 'string') return '';
  let value = input.trim();
  if (!value) return '';
  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      return '';
    }
  }
  if (/[\s/?#@\\]/.test(value)) return '';
  value = value.replace(/\.$/, '').toLowerCase();
  if (!value) return '';

  try {
    // URL parses IDNs into punycode and validates the label syntax.
    const parsed = new URL(`http://${value}/`);
    if (parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.hostname.replace(/\.$/, '');
  } catch {
    return '';
  }
}

/** Returns the public suffix ("co.uk", "com", "github.io" is not included). */
export function getPublicSuffix(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return '';
  if (isIpHost(host)) return host;

  const labels = host.split('.');
  const count = labels.length;
  let suffixLabels = 1; // the implicit "*" rule

  for (let i = 0; i < count; i += 1) {
    const candidate = labels.slice(i).join('.');
    const rules = getRules();
    if (rules.has(`!${candidate}`)) {
      // Exception rule: the suffix is the rule minus its leftmost label.
      suffixLabels = count - i - 1;
      break;
    }
    if (rules.has(candidate)) {
      suffixLabels = count - i;
      break;
    }
    if (i + 1 < count && rules.has(`*.${labels.slice(i + 1).join('.')}`)) {
      suffixLabels = count - i;
      break;
    }
  }

  if (suffixLabels <= 0) suffixLabels = 1;
  return labels.slice(count - suffixLabels).join('.');
}

/** Registrable domain, e.g. "news.bbc.co.uk" -> "bbc.co.uk". */
export function getRegistrableDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return '';
  if (isIpHost(host)) return host;

  const labels = host.split('.');
  const suffix = getPublicSuffix(host);
  const suffixLabels = suffix ? suffix.split('.').length : 1;
  if (labels.length <= suffixLabels) return host;
  return labels.slice(labels.length - suffixLabels - 1).join('.');
}

function titleCaseLabel(label) {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) =>
      part.length >= 3 && part.length <= 4 && !/[aeiou]/i.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join(' ');
}

/**
 * Human-readable folder name for an unknown domain.
 * "example-site.co.uk" -> "Example Site"
 */
export function folderNameFromDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return 'Unknown site';
  if (host === 'localhost') return 'Localhost';
  if (isIpHost(host)) return 'Local Network';

  const registrable = getRegistrableDomain(host) || host;
  const suffix = getPublicSuffix(registrable);
  const suffixLabels = suffix ? suffix.split('.').length : 1;
  const labels = registrable.split('.');
  const siteLabel = labels.slice(0, Math.max(1, labels.length - suffixLabels)).join('-');
  const name = titleCaseLabel(siteLabel);
  return name || registrable;
}

/**
 * Resolve the folder identity for a saved page.
 *
 * @param {string} pageUrl
 * @returns {{ok: true, hostname: string, displayHost: string, domain: string,
 *   folderKey: string, folderName: string} | {ok: false, error: string}}
 */
export function classifyUrl(pageUrl) {
  const parsed = parsePageUrl(pageUrl);
  if (!parsed) {
    return { ok: false, error: 'That does not look like a savable http(s) page URL.' };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    return { ok: false, error: 'The page has no usable hostname.' };
  }

  const domain = getRegistrableDomain(hostname) || hostname;
  const displayHost = hostname.replace(/^www\./, '');
  let folderName = FOLDER_NAMES[hostname] || FOLDER_NAMES[domain];

  if (!folderName) {
    if (hostname === 'localhost') {
      folderName = 'Localhost';
    } else if (isIpHost(hostname)) {
      folderName = 'Local Network';
    } else {
      folderName = folderNameFromDomain(domain);
    }
  }

  return {
    ok: true,
    hostname,
    displayHost,
    domain,
    folderKey: domain,
    folderName,
  };
}

/** Convenience used by the UI. Never throws. */
export function folderNameForUrl(pageUrl) {
  const result = classifyUrl(pageUrl);
  return result.ok ? result.folderName : 'Unsorted';
}
