/**
 * Backup format, validation and export construction.
 *
 * Imported files are untrusted. Validation is strict: the whole import fails
 * with a readable error rather than silently accepting half a broken backup.
 * Nothing here performs I/O - the storage layer decides how to persist data.
 */
import { classifyUrl, normalizeHostname } from './domain.js';
import { cleanFolderName, cleanNote, cleanText, normalizeFavicon, MAX_TITLE } from './sanitize.js';
import { normalizePageUrl } from './url.js';

export const BACKUP_FORMAT = 'cofretabs-backup';
export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_IMPORT_TABS = 100_000;
export const MAX_IMPORT_FOLDERS = 10_000;
export const MAX_BACKUP_TEXT_LENGTH = 80 * 1024 * 1024;

export class BackupError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
    this.details = details;
  }
}

function safeTimestamp(value, fallback) {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? Math.floor(value) : fallback;
}

function optionalTimestamp(value) {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? Math.floor(value) : null;
}

/**
 * Build a portable backup object from database records.
 * Includes trashed entries so a restore is a complete restore.
 */
export function buildBackup({ folders, tabs, appVersion = '1.0.0', exportedAt = new Date().toISOString() }) {
  const folderList = Array.isArray(folders) ? folders : [];
  const tabList = Array.isArray(tabs) ? tabs : [];

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: {
      name: 'CofreTabs',
      version: cleanText(appVersion, 32) || '1.0.0',
      studio: 'Mad Wolf Studios',
    },
    exportedAt,
    counts: {
      tabs: tabList.length,
      active: tabList.filter((entry) => !entry.deletedAt).length,
      trashed: tabList.filter((entry) => Boolean(entry.deletedAt)).length,
      folders: folderList.length,
    },
    folders: folderList.map((folder) => ({
      id: folder.id,
      key: folder.key,
      name: folder.name,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    })),
    tabs: tabList.map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      hostname: entry.hostname,
      folderId: entry.folderId,
      folderName: entry.folderName,
      faviconUrl: entry.faviconUrl,
      note: entry.note,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      deletedAt: entry.deletedAt ?? null,
    })),
  };
}

export function parseBackupText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new BackupError('INVALID_JSON', 'The backup file is empty.');
  }
  if (text.length > MAX_BACKUP_TEXT_LENGTH) {
    throw new BackupError('FILE_TOO_LARGE', 'That backup file is too large to import.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('INVALID_JSON', 'That file is not valid JSON. Choose a CofreTabs backup file.');
  }
  return normalizeBackupData(parsed);
}

/**
 * Validate and normalise a parsed backup object.
 * @returns {{folders: Array, tabs: Array, meta: {schemaVersion: number, exportedAt: string|null}}}
 */
export function normalizeBackupData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BackupError('INVALID_BACKUP', 'This file does not contain a CofreTabs backup object.');
  }
  if (input.format !== undefined && input.format !== BACKUP_FORMAT) {
    throw new BackupError('INVALID_BACKUP', 'This file is not a CofreTabs backup.');
  }

  const schemaVersion = input.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new BackupError('INVALID_SCHEMA', 'The backup is missing a valid schema version.');
  }
  if (schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupError(
      'INCOMPATIBLE_SCHEMA',
      `This backup was created by a newer version of CofreTabs (schema v${schemaVersion}). Update the extension, then try again.`,
      { schemaVersion, supported: BACKUP_SCHEMA_VERSION },
    );
  }

  if (!Array.isArray(input.tabs)) {
    throw new BackupError('INVALID_BACKUP', 'The backup has no tabs array.');
  }
  if (input.tabs.length > MAX_IMPORT_TABS) {
    throw new BackupError('TOO_MANY_TABS', `The backup contains more than ${MAX_IMPORT_TABS.toLocaleString()} tabs.`);
  }
  const rawFolders = input.folders === undefined ? [] : input.folders;
  if (!Array.isArray(rawFolders)) {
    throw new BackupError('INVALID_BACKUP', 'The backup folders field is not an array.');
  }
  if (rawFolders.length > MAX_IMPORT_FOLDERS) {
    throw new BackupError('TOO_MANY_FOLDERS', `The backup contains more than ${MAX_IMPORT_FOLDERS.toLocaleString()} folders.`);
  }

  const now = Date.now();
  const folders = [];
  const seenFolderIds = new Set();

  rawFolders.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BackupError('INVALID_FOLDER', `Folder #${index + 1} is not an object.`, { index });
    }
    const name = cleanFolderName(raw.name);
    if (!name) {
      throw new BackupError('INVALID_FOLDER', `Folder #${index + 1} has no name.`, { index });
    }
    let id = typeof raw.id === 'string' ? cleanText(raw.id, 200) : '';
    if (!id || seenFolderIds.has(id)) id = `imported-folder-${index}-${Math.random().toString(36).slice(2, 8)}`;
    seenFolderIds.add(id);

    const rawKey = typeof raw.key === 'string' ? raw.key.toLowerCase().replace(/^\.+|\.+$/g, '') : '';
    const key = normalizeHostname(rawKey) || cleanText(rawKey, 253) || id;

    const createdAt = safeTimestamp(raw.createdAt, now);
    folders.push({
      id,
      key,
      name,
      createdAt,
      updatedAt: safeTimestamp(raw.updatedAt, createdAt),
    });
  });

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const tabs = [];
  const seenTabIds = new Set();

  input.tabs.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BackupError('INVALID_TAB', `Tab #${index + 1} is not an object.`, { index });
    }
    const url = normalizePageUrl(raw.url);
    if (!url) {
      throw new BackupError(
        'INVALID_TAB_URL',
        `Tab #${index + 1} has an invalid URL. Only http(s) pages can be imported.`,
        { index },
      );
    }

    const classification = classifyUrl(url);
    const hostname = classification.ok ? classification.hostname : normalizeHostname(raw.hostname) || '';
    const title = cleanText(raw.title, MAX_TITLE) || classification.displayHost || hostname || url;
    const createdAt = safeTimestamp(raw.createdAt, now);

    let folderId = typeof raw.folderId === 'string' ? cleanText(raw.folderId, 200) : '';
    let folderName = cleanFolderName(raw.folderName);
    const knownFolder = folderId ? folderById.get(folderId) : null;
    if (knownFolder) {
      folderName = knownFolder.name;
    } else if (!folderName) {
      folderName = classification.ok ? classification.folderName : 'Unsorted';
      folderId = '';
    }

    let id = typeof raw.id === 'string' ? cleanText(raw.id, 200) : '';
    if (!id || seenTabIds.has(id)) id = `imported-tab-${index}-${Math.random().toString(36).slice(2, 8)}`;
    seenTabIds.add(id);

    tabs.push({
      id,
      title,
      url,
      urlKey: url,
      hostname,
      folderId,
      folderName,
      faviconUrl: normalizeFavicon(raw.faviconUrl),
      note: cleanNote(raw.note),
      createdAt,
      updatedAt: safeTimestamp(raw.updatedAt, createdAt),
      deletedAt: optionalTimestamp(raw.deletedAt),
    });
  });

  return {
    folders,
    tabs,
    meta: {
      schemaVersion,
      exportedAt: typeof input.exportedAt === 'string' ? cleanText(input.exportedAt, 64) : null,
    },
  };
}

export function describeBackup(input) {
  try {
    const normalized = normalizeBackupData(input);
    return {
      ok: true,
      tabs: normalized.tabs.length,
      folders: normalized.folders.length,
      trashed: normalized.tabs.filter((entry) => Boolean(entry.deletedAt)).length,
      exportedAt: normalized.meta.exportedAt,
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_BACKUP',
      message: error.message ?? 'This backup could not be read.',
    };
  }
}
