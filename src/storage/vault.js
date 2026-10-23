/**
 * IndexedDB storage layer for CofreTabs.
 *
 * Design notes:
 *  - One database ("cofretabs"), explicit schema versions, additive upgrades.
 *  - `tabs` holds saved pages, active or trashed. `deletedAt === null` means
 *    active. `folders` holds automatic website folders.
 *  - Duplicate detection compares the canonical URL of *active* entries only.
 *    A trashed entry does not block saving the page again.
 *  - No in-memory state is required for correctness: every read goes to the
 *    database, so service-worker suspension cannot lose data.
 */
import { classifyUrl } from '../lib/domain.js';
import { normalizePageUrl } from '../lib/url.js';
import { buildBackup, normalizeBackupData, parseBackupText } from '../lib/backup.js';
import {
  cleanFolderName,
  cleanNote,
  cleanText,
  normalizeFavicon,
  MAX_TITLE,
} from '../lib/sanitize.js';

export const DB_NAME = 'cofretabs';
export const SCHEMA_VERSION = 1;

export class VaultError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    this.details = details;
  }
}

function newId(prefix) {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function now() {
  return Date.now();
}

// Ensures strictly increasing creation timestamps even when two saves happen
// in the same millisecond, which keeps "newest first" stable.
let lastTimestamp = 0;
function nextTimestamp() {
  const timestamp = Math.max(Date.now(), lastTimestamp + 1);
  lastTimestamp = timestamp;
  return timestamp;
}

function safeTimestamp(value, fallback) {
  return Number.isFinite(value) && value > 0 && value < 8.64e15 ? Math.floor(value) : fallback;
}

export class Vault {
  /**
   * @param {{indexedDB?: IDBFactory, dbName?: string}} [options]
   * The factory is injectable so tests can use fake-indexeddb.
   */
  constructor(options = {}) {
    this._factory = options.indexedDB ?? globalThis.indexedDB;
    this._dbName = options.dbName ?? DB_NAME;
    this._db = null;
    this._opening = null;
  }

  get isOpen() {
    return Boolean(this._db);
  }

  async init() {
    if (this._db) return this;
    if (this._opening) return this._opening;

    if (!this._factory) {
      throw new VaultError('NO_INDEXEDDB', 'IndexedDB is not available in this context.');
    }

    this._opening = this._openDatabase().then(
      (db) => {
        this._db = db;
        this._opening = null;
        return this;
      },
      (error) => {
        this._opening = null;
        throw error;
      },
    );

    return this._opening;
  }

  _openDatabase() {
    return new Promise((resolve, reject) => {
      const openRequest = this._factory.open(this._dbName, SCHEMA_VERSION);

      openRequest.onupgradeneeded = (event) => {
        const db = openRequest.result;
        upgradeDatabase(db, event.oldVersion ?? 0);
      };

      openRequest.onsuccess = () => {
        const db = openRequest.result;
        db.onversionchange = () => {
          db.close();
          this._db = null;
        };
        resolve(db);
      };

      openRequest.onerror = () => {
        reject(new VaultError('DB_OPEN_FAILED', 'Could not open the local vault database.', openRequest.error?.message));
      };

      openRequest.onblocked = () => {
        reject(
          new VaultError(
            'DB_BLOCKED',
            'The vault database is locked by another CofreTabs window. Close other copies of the library and try again.',
          ),
        );
      };
    });
  }

  async ready() {
    await this.init();
    return this._requireDb();
  }

  _requireDb() {
    if (!this._db) throw new VaultError('DB_NOT_READY', 'The vault database is not open yet.');
    return this._db;
  }

  async close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
    this._opening = null;
  }

  /** Reopens the database. Used by tests and after import/replace. */
  async reopen() {
    await this.close();
    await this.init();
    return this;
  }

  async _read(storeNames, work) {
    const db = await this.ready();
    const tx = db.transaction(storeNames, 'readonly');
    const done = transactionDone(tx);
    try {
      const result = await work(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      await done.catch(() => {});
      throw error;
    }
  }

  async _write(storeNames, work) {
    const db = await this.ready();
    const tx = db.transaction(storeNames, 'readwrite');
    const done = transactionDone(tx);
    try {
      const result = await work(tx);
      await done;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      await done.catch(() => {});
      throw error;
    }
  }

  // ---------------------------------------------------------------- reading

  async getTab(id) {
    if (typeof id !== 'string' || !id) return null;
    return (await this._read(['tabs'], (tx) => requestToPromise(tx.objectStore('tabs').get(id)))) ?? null;
  }

  async findByUrl(url) {
    const key = normalizePageUrl(url);
    if (!key) return null;
    return this._read(['tabs'], async (tx) => {
      const matches = await requestToPromise(tx.objectStore('tabs').index('by_urlKey').getAll(key));
      return matches.find((entry) => !entry.deletedAt) ?? null;
    });
  }

  async getTabCounts() {
    return this._read(['tabs'], async (tx) => {
      const all = await requestToPromise(tx.objectStore('tabs').getAll());
      return {
        active: all.filter((entry) => !entry.deletedAt).length,
        trashed: all.filter((entry) => Boolean(entry.deletedAt)).length,
        total: all.length,
      };
    });
  }

  async _allFolders(tx) {
    return requestToPromise(tx.objectStore('folders').getAll());
  }

  async _allTabs(tx) {
    return requestToPromise(tx.objectStore('tabs').getAll());
  }

  async listFolders() {
    return this._read(['tabs', 'folders'], async (tx) => {
      const [folders, tabs] = await Promise.all([this._allFolders(tx), this._allTabs(tx)]);
      return decorateFolders(folders, tabs);
    });
  }

  async getStats() {
    return this._read(['tabs', 'folders'], async (tx) => {
      const [folders, tabs] = await Promise.all([this._allFolders(tx), this._allTabs(tx)]);
      const active = tabs.filter((entry) => !entry.deletedAt);
      const trashed = tabs.filter((entry) => Boolean(entry.deletedAt));
      const timestamps = active.map((entry) => entry.createdAt).filter(Number.isFinite);
      return {
        active: active.length,
        trashed: trashed.length,
        total: tabs.length,
        folders: folders.length,
        activeFolders: new Set(active.map((entry) => entry.folderId)).size,
        newestAt: timestamps.length ? Math.max(...timestamps) : null,
        oldestAt: timestamps.length ? Math.min(...timestamps) : null,
      };
    });
  }

  /** Compact payload for the in-page slide-over panel. */
  async getPanelSnapshot(recentLimit = 5) {
    return this._read(['tabs', 'folders'], async (tx) => {
      const [folders, tabs] = await Promise.all([this._allFolders(tx), this._allTabs(tx)]);
      const active = tabs.filter((entry) => !entry.deletedAt).sort((a, b) => b.createdAt - a.createdAt);
      const decorated = decorateFolders(folders, tabs);
      return {
        stats: {
          active: active.length,
          trashed: tabs.length - active.length,
          folders: folders.length,
        },
        folders: decorated
          .filter((folder) => folder.count > 0)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, 6)
          .map(publicFolder),
        recent: active.slice(0, recentLimit).map(publicEntry),
      };
    });
  }

  async search(query, options = {}) {
    const { limit = 8, includeTrash = false } = options;
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    return this._read(['tabs'], async (tx) => {
      const all = await this._allTabs(tx);
      return all
        .filter((entry) => (includeTrash ? true : !entry.deletedAt))
        .filter((entry) => matchesTokens(entry, tokens))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit)
        .map(publicEntry);
    });
  }

  async getLibrary(options = {}) {
    const { view = 'all', query = '', folderId = null, sort = 'newest', limit = 0 } = options;
    const tokens = tokenize(query);
    return this._read(['tabs', 'folders'], async (tx) => {
      const [folders, tabs] = await Promise.all([this._allFolders(tx), this._allTabs(tx)]);
      const decorated = decorateFolders(folders, tabs);
      const includeTrash = view === 'trash';
      let items = tabs.filter((entry) => (includeTrash ? Boolean(entry.deletedAt) : !entry.deletedAt));

      if (view === 'folder' && folderId) {
        items = items.filter((entry) => entry.folderId === folderId);
      }
      if (tokens.length) {
        items = items.filter((entry) => matchesTokens(entry, tokens));
      }

      items = sortEntries(items, sort);
      if (view === 'recent') {
        items = items.slice(0, 30);
      }
      const total = items.length;
      const limited = limit > 0 ? items.slice(0, limit) : items;

      return {
        view,
        query,
        sort,
        folderId,
        total,
        items: limited.map(publicEntry),
        folders: decorated.map(publicFolder),
        stats: {
          active: tabs.filter((entry) => !entry.deletedAt).length,
          trashed: tabs.filter((entry) => Boolean(entry.deletedAt)).length,
          folders: folders.length,
        },
      };
    });
  }

  // ---------------------------------------------------------------- writing

  /**
   * Save a page. Returns { created, duplicate, entry, folder, createdFolder }.
   * Throws VaultError for invalid URLs or storage failures.
   */
  async saveTab({ url, title, faviconUrl = '', note = '' } = {}) {
    const classification = classifyUrl(url);
    if (!classification.ok) throw new VaultError('INVALID_URL', classification.error);

    const normalizedUrl = normalizePageUrl(url);
    if (!normalizedUrl) throw new VaultError('INVALID_URL', classification.error);

    const cleanTitle = cleanText(title, MAX_TITLE) || classification.displayHost;
    const cleanFavicon = normalizeFavicon(faviconUrl);
    const cleanUserNote = cleanNote(note);

    const result = await this._write(['tabs', 'folders'], async (tx) => {
      const tabStore = tx.objectStore('tabs');
      const folderStore = tx.objectStore('folders');

      const sameUrl = await requestToPromise(tabStore.index('by_urlKey').getAll(normalizedUrl));
      const activeDuplicate = sameUrl.find((entry) => !entry.deletedAt);
      if (activeDuplicate) {
        return { duplicate: true, entry: activeDuplicate, folder: null, createdFolder: false };
      }

      const folders = await this._allFolders(tx);
      const materialized = findOrCreateFolder(folders, classification.folderKey, classification.folderName);
      if (materialized.created) {
        await requestToPromise(folderStore.add(materialized.folder));
        folders.push(materialized.folder);
      }

      const timestamp = now();
      const entry = {
        id: newId('tab'),
        title: cleanTitle,
        url: normalizedUrl,
        urlKey: normalizedUrl,
        hostname: classification.hostname,
        folderId: materialized.folder.id,
        folderName: materialized.folder.name,
        faviconUrl: cleanFavicon,
        note: cleanUserNote,
        createdAt: nextTimestamp(),
        updatedAt: timestamp,
        deletedAt: null,
      };

      await requestToPromise(tabStore.add(entry));
      return {
        duplicate: false,
        entry,
        folder: materialized.folder,
        createdFolder: materialized.created,
      };
    });

    if (result.duplicate) {
      result.entry = publicEntry(result.entry);
      const folder = await this._read(['folders'], (tx) => requestToPromise(tx.objectStore('folders').get(result.entry.folderId)));
      result.folder = folder ? publicFolder(decorateFolders([folder], [result.entry])[0]) : null;
      result.created = false;
      return result;
    }

    return {
      ...result,
      folder: publicFolder(decorateFolders([result.folder], [result.entry])[0]),
      entry: publicEntry(result.entry),
      created: true,
    };
  }

  async updateTab(id, changes = {}) {
    return this._write(['tabs', 'folders'], async (tx) => {
      const tabStore = tx.objectStore('tabs');
      const folderStore = tx.objectStore('folders');
      const entry = await requestToPromise(tabStore.get(id));
      if (!entry) throw new VaultError('NOT_FOUND', 'That saved tab no longer exists.');

      if (Object.prototype.hasOwnProperty.call(changes, 'title')) {
        entry.title = cleanText(changes.title, MAX_TITLE) || entry.hostname;
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'note')) {
        entry.note = cleanNote(changes.note);
      }
      if (Object.prototype.hasOwnProperty.call(changes, 'folderId') && changes.folderId !== entry.folderId) {
        const folder = await requestToPromise(folderStore.get(changes.folderId));
        if (!folder) throw new VaultError('FOLDER_NOT_FOUND', 'That folder no longer exists.');
        entry.folderId = folder.id;
        entry.folderName = folder.name;
      }

      entry.updatedAt = now();
      await requestToPromise(tabStore.put(entry));
      return publicEntry(entry);
    });
  }

  async moveToTrash(id) {
    return this._write(['tabs'], async (tx) => {
      const store = tx.objectStore('tabs');
      const entry = await requestToPromise(store.get(id));
      if (!entry) throw new VaultError('NOT_FOUND', 'That saved tab no longer exists.');
      if (entry.deletedAt) return { entry: publicEntry(entry), alreadyTrashed: true };
      const timestamp = now();
      entry.deletedAt = timestamp;
      entry.updatedAt = timestamp;
      await requestToPromise(store.put(entry));
      return { entry: publicEntry(entry), alreadyTrashed: false };
    });
  }

  async restoreTab(id) {
    return this._write(['tabs', 'folders'], async (tx) => {
      const tabStore = tx.objectStore('tabs');
      const folderStore = tx.objectStore('folders');
      const entry = await requestToPromise(tabStore.get(id));
      if (!entry) throw new VaultError('NOT_FOUND', 'That saved tab no longer exists.');

      let folder = entry.folderId ? await requestToPromise(folderStore.get(entry.folderId)) : null;
      if (!folder) {
        const classification = classifyUrl(entry.url);
        const folderKey = classification.ok ? classification.folderKey : entry.hostname || 'unknown';
        const folderName = classification.ok ? classification.folderName : entry.folderName || 'Unsorted';
        const folders = await this._allFolders(tx);
        const materialized = findOrCreateFolder(folders, folderKey, folderName);
        folder = materialized.folder;
        if (materialized.created) await requestToPromise(folderStore.add(folder));
      }

      entry.folderId = folder.id;
      entry.folderName = folder.name;
      entry.deletedAt = null;
      entry.updatedAt = now();
      await requestToPromise(tabStore.put(entry));
      return { entry: publicEntry(entry), folder: publicFolder(decorateFolders([folder], [entry])[0]) };
    });
  }

  /** Permanent deletion is only allowed for entries already in the trash. */
  async deleteForever(id) {
    return this._write(['tabs'], async (tx) => {
      const store = tx.objectStore('tabs');
      const entry = await requestToPromise(store.get(id));
      if (!entry) return { deleted: false };
      if (!entry.deletedAt) {
        throw new VaultError('NOT_TRASHED', 'Move the tab to the trash before deleting it permanently.');
      }
      await requestToPromise(store.delete(id));
      return { deleted: true, id };
    });
  }

  async emptyTrash() {
    return this._write(['tabs'], async (tx) => {
      const store = tx.objectStore('tabs');
      const all = await this._allTabs(tx);
      const trashed = all.filter((entry) => Boolean(entry.deletedAt));
      for (const entry of trashed) {
        await requestToPromise(store.delete(entry.id));
      }
      return { deleted: trashed.length };
    });
  }

  async renameFolder(id, nextName) {
    const name = cleanFolderName(nextName);
    if (!name) throw new VaultError('INVALID_NAME', 'Folder names cannot be empty.');

    return this._write(['tabs', 'folders'], async (tx) => {
      const folderStore = tx.objectStore('folders');
      const tabStore = tx.objectStore('tabs');
      const folder = await requestToPromise(folderStore.get(id));
      if (!folder) throw new VaultError('FOLDER_NOT_FOUND', 'That folder no longer exists.');

      const folders = await this._allFolders(tx);
      const clash = folders.find(
        (candidate) => candidate.id !== id && candidate.name.toLowerCase() === name.toLowerCase(),
      );
      if (clash) {
        throw new VaultError('DUPLICATE_NAME', `Another folder is already called "${clash.name}".`);
      }

      folder.name = name;
      folder.updatedAt = now();
      await requestToPromise(folderStore.put(folder));

      const tabs = await this._allTabs(tx);
      for (const entry of tabs) {
        if (entry.folderId === id) {
          entry.folderName = name;
          await requestToPromise(tabStore.put(entry));
        }
      }
      return publicFolder(decorateFolders([folder], tabs.filter((entry) => entry.folderId === id && !entry.deletedAt))[0]);
    });
  }

  /**
   * Deleting a folder never destroys saved pages: its active tabs move to the
   * trash (recoverable) and the folder record is removed. Trashed entries are
   * kept in the trash and will be re-filed from their URL on restore.
   */
  async deleteFolder(id) {
    return this._write(['tabs', 'folders'], async (tx) => {
      const folderStore = tx.objectStore('folders');
      const tabStore = tx.objectStore('tabs');
      const folder = await requestToPromise(folderStore.get(id));
      if (!folder) throw new VaultError('FOLDER_NOT_FOUND', 'That folder no longer exists.');

      const tabs = await this._allTabs(tx);
      const affected = tabs.filter((entry) => entry.folderId === id);
      const timestamp = now();
      let movedToTrash = 0;

      for (const entry of affected) {
        if (!entry.deletedAt) {
          entry.deletedAt = timestamp;
          movedToTrash += 1;
        }
        entry.folderId = '';
        entry.updatedAt = timestamp;
        await requestToPromise(tabStore.put(entry));
      }

      await requestToPromise(folderStore.delete(id));
      return { deletedFolder: folder.name, movedToTrash };
    });
  }

  async exportBackup(appVersion = '1.0.0') {
    const { folders, tabs } = await this._read(['tabs', 'folders'], async (tx) => ({
      folders: await this._allFolders(tx),
      tabs: await this._allTabs(tx),
    }));
    return buildBackup({ folders, tabs, appVersion });
  }

  async importBackup(payload, mode = 'merge') {
    if (mode !== 'merge' && mode !== 'replace') {
      throw new VaultError('INVALID_MODE', 'Choose either merge or replace.');
    }
    const normalized = normalizeBackupData(payload);
    const timestamp = now();

    return this._write(['tabs', 'folders'], async (tx) => {
      const tabStore = tx.objectStore('tabs');
      const folderStore = tx.objectStore('folders');

      let existingTabs = await this._allTabs(tx);
      let existingFolders = await this._allFolders(tx);
      const removedExisting = mode === 'replace' ? existingTabs.length : 0;

      if (mode === 'replace') {
        for (const entry of existingTabs) await requestToPromise(tabStore.delete(entry.id));
        for (const folder of existingFolders) await requestToPromise(folderStore.delete(folder.id));
        existingTabs = [];
        existingFolders = [];
      }

      const activeUrlKeys = new Set(existingTabs.filter((entry) => !entry.deletedAt).map((entry) => entry.urlKey));
      const trashedUrlKeys = new Set(existingTabs.filter((entry) => Boolean(entry.deletedAt)).map((entry) => entry.urlKey));
      const foldersByKey = new Map(existingFolders.map((folder) => [folder.key, folder]));
      const folderIdMap = new Map();
      let foldersCreated = 0;

      for (const importedFolder of normalized.folders) {
        const existing = foldersByKey.get(importedFolder.key);
        if (existing) {
          folderIdMap.set(importedFolder.id, existing.id);
          continue;
        }
        const duplicateName = existingFolders.some(
          (folder) => folder.name.toLowerCase() === importedFolder.name.toLowerCase(),
        );
        const folder = {
          id: newId('folder'),
          key: importedFolder.key,
          name: duplicateName ? uniqueFolderName(importedFolder.name, existingFolders, importedFolder.key) : importedFolder.name,
          createdAt: importedFolder.createdAt,
          updatedAt: timestamp,
        };
        await requestToPromise(folderStore.add(folder));
        existingFolders.push(folder);
        foldersByKey.set(folder.key, folder);
        folderIdMap.set(importedFolder.id, folder.id);
        foldersCreated += 1;
      }

      let imported = 0;
      let skipped = 0;

      for (const raw of normalized.tabs) {
        const key = raw.urlKey;
        if (raw.deletedAt && trashedUrlKeys.has(key)) {
          skipped += 1;
          continue;
        }
        if (!raw.deletedAt && activeUrlKeys.has(key)) {
          skipped += 1;
          continue;
        }

        let folder = raw.folderId ? existingFolders.find((candidate) => candidate.id === folderIdMap.get(raw.folderId)) : null;
        if (!folder && raw.deletedAt && raw.folderId) {
          // Trashed entries may reference a folder that was deleted; keep a
          // friendly label but re-file it on restore.
          folder = { id: '', name: raw.folderName || 'Unsorted' };
        }
        if (!folder) {
          const classification = classifyUrl(raw.url);
          const folderKey = classification.ok ? classification.folderKey : raw.hostname || 'unknown';
          const folderName = classification.ok ? classification.folderName : raw.folderName || 'Unsorted';
          const materialized = findOrCreateFolder(existingFolders, folderKey, folderName);
          folder = materialized.folder;
          if (materialized.created) {
            await requestToPromise(folderStore.add(folder));
            existingFolders.push(folder);
            foldersByKey.set(folder.key, folder);
            foldersCreated += 1;
          }
        }

        const nowTs = timestamp;
        const entry = {
          id: newId('tab'),
          title: raw.title,
          url: raw.url,
          urlKey: key,
          hostname: raw.hostname,
          folderId: folder.id,
          folderName: folder.name,
          faviconUrl: raw.faviconUrl,
          note: raw.note,
          createdAt: raw.createdAt,
          updatedAt: safeTimestamp(raw.updatedAt, nowTs),
          deletedAt: raw.deletedAt,
        };
        await requestToPromise(tabStore.add(entry));
        if (entry.deletedAt) {
          trashedUrlKeys.add(key);
        } else {
          activeUrlKeys.add(key);
        }
        imported += 1;
      }

      return { mode, imported, skipped, foldersCreated, removedExisting };
    });
  }

  async importBackupText(text, mode = 'merge') {
    return this.importBackup(parseBackupText(text), mode);
  }

  /** Used by tests and by a future "reset vault" action. Not exposed in v1 UI. */
  async clearAll() {
    return this._write(['tabs', 'folders'], async (tx) => {
      const tabs = await this._allTabs(tx);
      const folders = await this._allFolders(tx);
      for (const entry of tabs) await requestToPromise(tx.objectStore('tabs').delete(entry.id));
      for (const folder of folders) await requestToPromise(tx.objectStore('folders').delete(folder.id));
      return { tabs: tabs.length, folders: folders.length };
    });
  }
}

// ------------------------------------------------------------------ helpers

function upgradeDatabase(db, oldVersion) {
  if (oldVersion < 1) {
    const tabs = db.createObjectStore('tabs', { keyPath: 'id' });
    tabs.createIndex('by_urlKey', 'urlKey', { unique: false });
    tabs.createIndex('by_folderId', 'folderId', { unique: false });
    tabs.createIndex('by_createdAt', 'createdAt', { unique: false });
    tabs.createIndex('by_deletedAt', 'deletedAt', { unique: false });

    const folders = db.createObjectStore('folders', { keyPath: 'id' });
    folders.createIndex('by_key', 'key', { unique: true });
    folders.createIndex('by_name', 'name', { unique: false });

    const meta = db.createObjectStore('meta', { keyPath: 'key' });
    meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  }
  // Future schema migrations go here, one guarded block per version.
}

function findOrCreateFolder(folders, key, desiredName) {
  const existing = folders.find((folder) => folder.key === key);
  if (existing) return { folder: existing, created: false };

  const timestamp = now();
  const name = uniqueFolderName(desiredName, folders, key);
  const folder = {
    id: newId('folder'),
    key,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { folder, created: true };
}

function uniqueFolderName(base, folders, key) {
  const desired = cleanFolderName(base) || 'Unsorted';
  const taken = new Set(folders.map((folder) => folder.name.toLowerCase()));
  if (!taken.has(desired.toLowerCase())) return desired;

  const withDomain = cleanFolderName(`${desired} (${key})`);
  if (!taken.has(withDomain.toLowerCase())) return withDomain;

  for (let i = 2; i < 50; i += 1) {
    const candidate = cleanFolderName(`${desired} ${i}`);
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return cleanFolderName(`${desired} ${newId('x').slice(-6)}`);
}

function tokenize(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function matchesTokens(entry, tokens) {
  const haystack = [
    entry.title,
    entry.url,
    entry.hostname,
    entry.folderName,
    entry.note,
  ]
    .join('\n')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function sortEntries(entries, sort) {
  const copy = [...entries];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    case 'folder':
      return copy.sort(
        (a, b) =>
          (a.folderName || '').localeCompare(b.folderName || '', undefined, { sensitivity: 'base' }) ||
          b.createdAt - a.createdAt,
      );
    case 'newest':
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}

function decorateFolders(folders, tabs) {
  const counts = new Map();
  const lastSaved = new Map();
  for (const entry of tabs) {
    if (entry.deletedAt) continue;
    if (!entry.folderId) continue;
    counts.set(entry.folderId, (counts.get(entry.folderId) ?? 0) + 1);
    const previous = lastSaved.get(entry.folderId) ?? 0;
    if (entry.createdAt > previous) lastSaved.set(entry.folderId, entry.createdAt);
  }
  return folders
    .map((folder) => ({
      ...publicFolder(folder),
      count: counts.get(folder.id) ?? 0,
      lastSavedAt: lastSaved.get(folder.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function publicFolder(folder) {
  return {
    id: folder.id,
    key: folder.key,
    name: folder.name,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    count: folder.count ?? 0,
    lastSavedAt: folder.lastSavedAt ?? null,
  };
}

function publicEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    url: entry.url,
    urlKey: entry.urlKey,
    hostname: entry.hostname,
    folderId: entry.folderId,
    folderName: entry.folderName,
    faviconUrl: entry.faviconUrl,
    note: entry.note,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt ?? null,
  };
}

let sharedVault = null;

/** Shared instance for the current extension context (worker or page). */
export function getVault() {
  if (!sharedVault) sharedVault = new Vault();
  return sharedVault;
}
