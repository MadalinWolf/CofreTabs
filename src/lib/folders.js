/**
 * Folder identity, icons and playful fallbacks shared by the library page.
 *
 * The in-page panel cannot import ES modules (it runs as a classic content
 * script), so panel.js repeats the small helpers below; keep both sides in
 * sync when changing them.
 */

/** Virtual folder id for the built-in Favorites collection. */
export const FAVORITES_FOLDER_ID = '__favorites__';
export const FAVORITES_KEY = 'favorites';
export const FAVORITES_NAME = 'Favorites';

export function isFavoritesFolder(folder) {
  return Boolean(folder) && (folder.id === FAVORITES_FOLDER_ID || folder.type === 'favorites');
}

export function folderType(folder) {
  if (isFavoritesFolder(folder)) return 'favorites';
  return folder?.type === 'custom' ? 'custom' : 'site';
}

/** Small stable string hash (FNV-1a style). Same input always gives same output. */
export function hashString(value) {
  const text = String(value ?? '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Tasteful, stable ASCII personalities for generic/custom folders. The same
 * folder always renders the same face: the glyph is derived from its id.
 */
export const PLAYFUL_GLYPHS = Object.freeze(['=^.^=', '<-<', ':3', '>_', '~/ ', '=^._.^=', '>w<', '~~>', '^.^', '<3']);

export function folderGlyph(seed) {
  return PLAYFUL_GLYPHS[hashString(seed) % PLAYFUL_GLYPHS.length];
}

/** Renders an SVG icon for a folder node. Returns an SVGElement. */
export function folderIconSvg(kind, size = 16) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `folder-icon folder-icon-${kind}`);

  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    svg.append(node);
  };

  if (kind === 'favorites') {
    add('path', {
      d: 'M12 20.4 4.6 13a4.6 4.6 0 0 1 0-6.5 4.7 4.7 0 0 1 6.6 0l.8.8.8-.8a4.7 4.7 0 0 1 6.6 0 4.6 4.6 0 0 1 0 6.5Z',
      fill: 'currentColor',
    });
  } else {
    add('path', {
      d: 'M3.5 6.5h5.6l1.7 2h9.7v9.4a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2Z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.6',
      'stroke-linejoin': 'round',
    });
    add('path', {
      d: 'M3.5 10h17',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.2',
      opacity: '0.55',
    });
  }
  return svg;
}

/** Builds the icon node for a folder: SVG for site/favorites, glyph for custom. */
export function buildFolderIcon(folder, size = 16) {
  const kind = folderType(folder);
  if (kind === 'custom') {
    const span = document.createElement('span');
    span.setAttribute('class', 'folder-icon folder-icon-glyph');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = folderGlyph(folder.id || folder.name);
    return span;
  }
  return folderIconSvg(kind, size);
}
