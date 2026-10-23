/**
 * Input sanitisation shared by the storage layer and the backup importer.
 * All of these helpers return plain strings; callers render them with
 * textContent, never as HTML.
 */

export const MAX_TITLE = 500;
export const MAX_NOTE = 2000;
export const MAX_FOLDER_NAME = 60;
export const MAX_FAVICON_LENGTH = 100_000;

export function cleanText(value, maxLength = MAX_TITLE) {
  if (typeof value !== 'string') return '';
  let text = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();
  return text;
}

export function cleanNote(value) {
  if (typeof value !== 'string') return '';
  let text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > MAX_NOTE) text = text.slice(0, MAX_NOTE).trim();
  return text;
}

/**
 * Only inline raster favicons are persisted. Remote favicon URLs are never
 * stored, so displaying the library never triggers a network request.
 */
export function normalizeFavicon(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FAVICON_LENGTH) return '';
  if (!/^data:image\/(png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export function cleanFolderName(value) {
  return cleanText(value, MAX_FOLDER_NAME);
}
