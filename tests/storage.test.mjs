import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { Vault, VaultError } from '../src/storage/vault.js';

let counter = 0;

function makeVault() {
  counter += 1;
  const factory = new IDBFactory();
  return {
    factory,
    dbName: `cofretabs-test-${counter}-${Date.now()}`,
    vault: new Vault({ indexedDB: factory, dbName: `cofretabs-test-${counter}-${Date.now()}` }),
  };
}

async function freshVault() {
  counter += 1;
  const factory = new IDBFactory();
  const dbName = `cofretabs-test-${counter}-${Date.now()}`;
  const vault = new Vault({ indexedDB: factory, dbName });
  await vault.init();
  return { vault, factory, dbName };
}

test('initialises the database schema', async () => {
  const { vault } = await freshVault();
  assert.equal(vault.isOpen, true);
  const stats = await vault.getStats();
  assert.deepEqual(stats, {
    active: 0,
    trashed: 0,
    total: 0,
    folders: 0,
    activeFolders: 0,
    newestAt: null,
    oldestAt: null,
  });
  await vault.close();
});

test('saves a tab, creates a website folder and reads it back', async () => {
  const { vault } = await freshVault();
  const result = await vault.saveTab({
    url: 'https://www.youtube.com/watch?v=abc123',
    title: '  A   useful   video  ',
    faviconUrl: '',
  });

  assert.equal(result.created, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.entry.title, 'A useful video');
  assert.equal(result.entry.url, 'https://www.youtube.com/watch?v=abc123');
  assert.equal(result.entry.hostname, 'www.youtube.com');
  assert.equal(result.folder.name, 'YouTube');
  assert.equal(result.createdFolder, true);

  const found = await vault.findByUrl('https://www.youtube.com/watch?v=abc123');
  assert.equal(found.id, result.entry.id);

  const folders = await vault.listFolders();
  assert.equal(folders.length, 1);
  assert.equal(folders[0].name, 'YouTube');
  assert.equal(folders[0].count, 1);

  await vault.close();
});

test('detects duplicates of active tabs but not trashed ones', async () => {
  const { vault } = await freshVault();
  const first = await vault.saveTab({ url: 'https://example.com/page', title: 'Example' });
  const second = await vault.saveTab({ url: 'https://example.com/page', title: 'Example again' });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.entry.id, first.entry.id);

  let stats = await vault.getStats();
  assert.equal(stats.active, 1);

  await vault.moveToTrash(first.entry.id);
  stats = await vault.getStats();
  assert.equal(stats.active, 0);
  assert.equal(stats.trashed, 1);

  const third = await vault.saveTab({ url: 'https://example.com/page', title: 'Saved again' });
  assert.equal(third.created, true);
  stats = await vault.getStats();
  assert.equal(stats.active, 1);
  assert.equal(stats.trashed, 1);

  await vault.close();
});

test('trashes, restores and permanently deletes tabs', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://github.com/MadalinWolf', title: 'MadalinWolf' });

  await assert.rejects(() => vault.deleteForever(entry.id), (error) => error.code === 'NOT_TRASHED');

  const trashed = await vault.moveToTrash(entry.id);
  assert.ok(trashed.entry.deletedAt);

  const library = await vault.getLibrary({ view: 'trash' });
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].id, entry.id);

  const restored = await vault.restoreTab(entry.id);
  assert.equal(restored.entry.deletedAt, null);
  assert.equal(restored.folder.name, 'GitHub');

  await vault.moveToTrash(entry.id);
  const deleted = await vault.deleteForever(entry.id);
  assert.equal(deleted.deleted, true);
  assert.equal(await vault.getTab(entry.id), null);

  await vault.close();
});

test('restores a tab whose folder was deleted by re-filing it', async () => {
  const { vault } = await freshVault();
  const { entry, folder } = await vault.saveTab({ url: 'https://www.reddit.com/r/brave', title: 'Brave' });

  const folderResult = await vault.deleteFolder(folder.id);
  assert.equal(folderResult.movedToTrash, 1);

  const stats = await vault.getStats();
  assert.equal(stats.active, 0);
  assert.equal(stats.trashed, 1);

  const restored = await vault.restoreTab(entry.id);
  assert.equal(restored.entry.deletedAt, null);
  assert.equal(restored.folder.name, 'Reddit');
  assert.equal((await vault.getStats()).active, 1);

  await vault.close();
});

test('emptyTrash removes only trashed entries', async () => {
  const { vault } = await freshVault();
  const keep = await vault.saveTab({ url: 'https://keep.example.com/', title: 'Keep' });
  const purgeA = await vault.saveTab({ url: 'https://a.example.com/', title: 'A' });
  const purgeB = await vault.saveTab({ url: 'https://b.example.com/', title: 'B' });

  await vault.moveToTrash(purgeA.entry.id);
  await vault.moveToTrash(purgeB.entry.id);

  const result = await vault.emptyTrash();
  assert.equal(result.deleted, 2);

  const stats = await vault.getStats();
  assert.equal(stats.active, 1);
  assert.equal(stats.trashed, 0);
  assert.ok(await vault.getTab(keep.entry.id));

  await vault.close();
});

test('folder deletion is recoverable and never silently destroys tabs', async () => {
  const { vault } = await freshVault();
  const a = await vault.saveTab({ url: 'https://example.com/a', title: 'A' });
  const folder = a.folder;

  await vault.renameFolder(folder.id, 'My examples');
  const renamed = await vault.getLibrary({ view: 'folder', folderId: folder.id });
  assert.equal(renamed.items[0].folderName, 'My examples');

  await vault.deleteFolder(folder.id);
  const stats = await vault.getStats();
  assert.equal(stats.folders, 0);
  assert.equal(stats.trashed, 1);
  assert.ok(await vault.getTab(a.entry.id));

  await vault.close();
});

test('folder names are made unique when different domains share a label', async () => {
  const { vault } = await freshVault();
  const a = await vault.saveTab({ url: 'https://example.com/a', title: 'A' });
  const b = await vault.saveTab({ url: 'https://example.net/b', title: 'B' });

  assert.equal(a.folder.name, 'Example');
  assert.notEqual(a.folder.name, b.folder.name);
  assert.equal((await vault.getStats()).folders, 2);

  await vault.close();
});

test('updates title, note and folder with sanitisation', async () => {
  const { vault } = await freshVault();
  const { entry, folder } = await vault.saveTab({ url: 'https://example.com/one', title: 'One' });
  const other = await vault.saveTab({ url: 'https://example.org/two', title: 'Two' });

  const updated = await vault.updateTab(entry.id, {
    title: 'Renamed',
    note: 'Line one\n\n\n\nLine two',
    folderId: other.folder.id,
  });
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.note, 'Line one\n\nLine two');
  assert.equal(updated.folderId, other.folder.id);
  assert.equal(updated.folderName, other.folder.name);

  const lib = await vault.getLibrary({ view: 'folder', folderId: other.folder.id });
  assert.equal(lib.items.length, 2);
  assert.ok(folder.id !== other.folder.id);

  await vault.close();
});

test('search matches titles, URLs, hostnames, notes and folder names', async () => {
  const { vault } = await freshVault();
  const saved = await vault.saveTab({
    url: 'https://github.com/MadalinWolf/CofreTabs',
    title: 'CofreTabs repository',
    note: 'retro terminal extension',
  });
  await vault.saveTab({ url: 'https://example.com/unrelated', title: 'Something else' });

  const byTitle = await vault.search('cofretabs');
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].id, saved.entry.id);

  assert.equal((await vault.search('madalinwolf')).length, 1);
  assert.equal((await vault.search('github')).length, 1);
  assert.equal((await vault.search('terminal')).length, 1);
  assert.equal((await vault.search('unrelated')).length, 1);
  assert.equal((await vault.search('no-such-term')).length, 0);

  const library = await vault.getLibrary({ query: 'github cofretabs' });
  assert.equal(library.total, 1);

  await vault.close();
});

test('library sorting is stable and newest-first by default', async () => {
  const { vault } = await freshVault();
  const a = await vault.saveTab({ url: 'https://a.example.com/', title: 'Alpha' });
  const b = await vault.saveTab({ url: 'https://b.example.com/', title: 'Beta' });

  const newest = await vault.getLibrary({ view: 'all' });
  assert.equal(newest.items[0].id, b.entry.id);

  const oldest = await vault.getLibrary({ view: 'all', sort: 'oldest' });
  assert.equal(oldest.items[0].id, a.entry.id);

  const byTitle = await vault.getLibrary({ view: 'all', sort: 'title' });
  assert.deepEqual(byTitle.items.map((item) => item.title), ['Alpha', 'Beta']);

  await vault.close();
});

test('data persists after closing and reopening the database', async () => {
  const factory = new IDBFactory();
  const dbName = `cofretabs-persist-${Date.now()}`;
  const first = new Vault({ indexedDB: factory, dbName });
  const { entry } = await first.saveTab({ url: 'https://persist.example.com/', title: 'Persist' });
  await first.close();

  const second = new Vault({ indexedDB: factory, dbName });
  await second.init();
  const found = await second.getTab(entry.id);
  assert.equal(found.title, 'Persist');
  await second.close();
});

test('rejects invalid URLs without writing anything', async () => {
  const { vault } = await freshVault();
  await assert.rejects(
    () => vault.saveTab({ url: 'javascript:alert(1)', title: 'Nope' }),
    (error) => error instanceof VaultError && error.code === 'INVALID_URL',
  );
  assert.equal((await vault.getStats()).total, 0);
  await vault.close();
});

test('propagates database write failures', async () => {
  const { vault } = await freshVault();
  const realDb = vault._db;
  vault._db = {
    transaction() {
      throw new Error('simulated disk failure');
    },
  };

  await assert.rejects(
    () => vault.saveTab({ url: 'https://example.com/failure', title: 'Failure' }),
    /simulated disk failure/,
  );

  vault._db = realDb;
  assert.equal((await vault.getStats()).total, 0);
  await vault.close();
});

test('reports a clear error when IndexedDB cannot open', async () => {
  const broken = new Vault({
    indexedDB: {
      open() {
        throw new Error('storage disabled');
      },
    },
    dbName: 'broken',
  });
  await assert.rejects(() => broken.init(), /storage disabled/);
});

test('rejects corrupt or unsupported backups without touching data', async () => {
  const { vault } = await freshVault();
  await vault.saveTab({ url: 'https://keep.example.com/', title: 'Keep' });

  await assert.rejects(
    () => vault.importBackupText('{not json', 'merge'),
    (error) => error.code === 'INVALID_JSON',
  );
  await assert.rejects(
    () => vault.importBackup({ format: 'cofretabs-backup', schemaVersion: 99, tabs: [] }, 'merge'),
    (error) => error.code === 'INCOMPATIBLE_SCHEMA',
  );
  assert.equal((await vault.getStats()).active, 1);

  await vault.close();
});
