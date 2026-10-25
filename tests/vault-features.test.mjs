import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { Vault, VaultError, FAVORITES_FOLDER_ID } from '../src/storage/vault.js';

let counter = 0;

async function freshVault() {
  counter += 1;
  const factory = new IDBFactory();
  const dbName = `cofretabs-feat-${counter}-${Date.now()}`;
  const vault = new Vault({ indexedDB: factory, dbName });
  await vault.init();
  return { vault, factory, dbName };
}

// ------------------------------------------------------------------ favorites

test('favorites start empty and toggle on and off without moving the tab', async () => {
  const { vault } = await freshVault();
  const { entry, folder } = await vault.saveTab({ url: 'https://example.com/a', title: 'A' });
  assert.equal(entry.favorite, false);

  const on = await vault.toggleFavorite(entry.id);
  assert.equal(on.favorite, true);

  const stored = await vault.getTab(entry.id);
  assert.equal(stored.favorite, true);
  // Favoriting must not change the folder it lives in.
  assert.equal(stored.folderId, folder.id);
  assert.equal(stored.folderName, folder.name);

  const off = await vault.toggleFavorite(entry.id);
  assert.equal(off.favorite, false);
  assert.equal((await vault.getTab(entry.id)).favorite, false);

  await vault.close();
});

test('toggleFavorite with a forced value is idempotent (no duplicate state)', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/b', title: 'B' });

  const a = await vault.toggleFavorite(entry.id, true);
  const b = await vault.toggleFavorite(entry.id, true);
  assert.equal(a.favorite, true);
  assert.equal(b.favorite, true);
  assert.equal((await vault.getTab(entry.id)).favorite, true);

  await vault.close();
});

test('toggleFavorite rejects unknown ids', async () => {
  const { vault } = await freshVault();
  await assert.rejects(() => vault.toggleFavorite('nope'), (error) => error instanceof VaultError && error.code === 'NOT_FOUND');
  await vault.close();
});

test('the Favorites folder is virtual, counted, and protected from deletion', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/c', title: 'C' });
  await vault.toggleFavorite(entry.id);

  const folders = await vault.listFolders();
  const favorites = folders.find((folder) => folder.id === FAVORITES_FOLDER_ID);
  assert.ok(favorites);
  assert.equal(favorites.type, 'favorites');
  assert.equal(favorites.count, 1);

  await assert.rejects(
    () => vault.deleteFolder(FAVORITES_FOLDER_ID),
    (error) => error.code === 'PROTECTED_FOLDER',
  );

  await vault.close();
});

test('getLibrary lists only favorited active tabs in the Favorites view', async () => {
  const { vault } = await freshVault();
  const a = await vault.saveTab({ url: 'https://a.example.com/', title: 'Alpha' });
  const b = await vault.saveTab({ url: 'https://b.example.com/', title: 'Beta' });
  await vault.toggleFavorite(a.entry.id);

  const lib = await vault.getLibrary({ view: 'folder', folderId: FAVORITES_FOLDER_ID });
  assert.equal(lib.items.length, 1);
  assert.equal(lib.items[0].id, a.entry.id);

  // Trashing a favorited tab removes it from the Favorites view.
  await vault.moveToTrash(a.entry.id);
  const after = await vault.getLibrary({ view: 'folder', folderId: FAVORITES_FOLDER_ID });
  assert.equal(after.items.length, 0);
  assert.ok(b.entry.id);

  await vault.close();
});

test('stats.favorites counts active favorited tabs only', async () => {
  const { vault } = await freshVault();
  const a = await vault.saveTab({ url: 'https://a.example.com/', title: 'Alpha' });
  const b = await vault.saveTab({ url: 'https://b.example.com/', title: 'Beta' });
  await vault.toggleFavorite(a.entry.id);
  await vault.toggleFavorite(b.entry.id);
  assert.equal((await vault.getStats()).favorites, 2);

  await vault.moveToTrash(b.entry.id);
  assert.equal((await vault.getStats()).favorites, 1);

  await vault.close();
});

// --------------------------------------------------------------- custom folders

test('createFolder validates and rejects empty or duplicate names', async () => {
  const { vault } = await freshVault();
  await assert.rejects(() => vault.createFolder('   '), (error) => error.code === 'INVALID_NAME');
  await assert.rejects(() => vault.createFolder(''), (error) => error.code === 'INVALID_NAME');

  const folder = await vault.createFolder('Research');
  assert.equal(folder.name, 'Research');
  assert.equal(folder.type, 'custom');

  // Duplicate (case-insensitive) is refused.
  await assert.rejects(() => vault.createFolder('research'), (error) => error.code === 'DUPLICATE_NAME');

  await vault.close();
});

test('a custom folder shows up in the folder list and accepts moved tabs', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/d', title: 'D' });
  const folder = await vault.createFolder('Read Later');

  const updated = await vault.updateTab(entry.id, { folderId: folder.id });
  assert.equal(updated.folderId, folder.id);
  assert.equal(updated.folderName, 'Read Later');

  const lib = await vault.getLibrary({ view: 'folder', folderId: folder.id });
  assert.equal(lib.items.length, 1);
  assert.equal(lib.items[0].id, entry.id);
  // Title, url and metadata are preserved by the move.
  assert.equal(lib.items[0].url, 'https://example.com/d');
  assert.equal(lib.items[0].title, 'D');

  await vault.close();
});

test('updateTab rejects a move to a non-existent folder', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/e', title: 'E' });
  await assert.rejects(
    () => vault.updateTab(entry.id, { folderId: 'ghost-folder' }),
    (error) => error.code === 'FOLDER_NOT_FOUND',
  );
  await vault.close();
});

test('renameFolder updates the label and its tabs, and rejects clashes', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/f', title: 'F' });
  const folder = await vault.createFolder('Old Name');
  await vault.updateTab(entry.id, { folderId: folder.id });

  const renamed = await vault.renameFolder(folder.id, 'New Name');
  assert.equal(renamed.name, 'New Name');

  const stored = await vault.getTab(entry.id);
  assert.equal(stored.folderName, 'New Name');

  // Renaming to an existing other folder's name is refused.
  await vault.createFolder('Taken');
  await assert.rejects(() => vault.renameFolder(folder.id, 'taken'), (error) => error.code === 'DUPLICATE_NAME');

  await vault.close();
});

test('deleting a folder with tabs is non-destructive: tabs go to Trash', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/g', title: 'G' });
  const folder = await vault.createFolder('Doomed');
  await vault.updateTab(entry.id, { folderId: folder.id });

  const result = await vault.deleteFolder(folder.id);
  assert.equal(result.movedToTrash, 1);

  const stats = await vault.getStats();
  assert.equal(stats.active, 0);
  assert.equal(stats.trashed, 1);
  // The tab still exists and is restorable.
  assert.ok(await vault.getTab(entry.id));

  await vault.close();
});

test('custom folders participate in getPanelSnapshot with Favorites first', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/h', title: 'H' });
  const folder = await vault.createFolder('Zeta Custom');
  await vault.updateTab(entry.id, { folderId: folder.id });
  await vault.toggleFavorite(entry.id);

  const snapshot = await vault.getPanelSnapshot();
  assert.ok(snapshot.folders.length >= 2);
  // Favorites is always the first visible folder.
  assert.equal(snapshot.folders[0].id, FAVORITES_FOLDER_ID);
  const ids = snapshot.folders.map((f) => f.id);
  assert.ok(ids.includes(folder.id));
  assert.equal(snapshot.stats.favorites, 1);

  await vault.close();
});

test('backup export and import preserve favorites and custom folders', async () => {
  const { vault } = await freshVault();
  const { entry } = await vault.saveTab({ url: 'https://example.com/i', title: 'Keep me' });
  const folder = await vault.createFolder('Archive');
  await vault.updateTab(entry.id, { folderId: folder.id });
  await vault.toggleFavorite(entry.id, true);

  const backup = await vault.exportBackup('1.1.0');
  const exportedTab = backup.tabs.find((t) => t.url === 'https://example.com/i');
  assert.equal(exportedTab.favorite, true);
  assert.ok(backup.folders.some((f) => f.type === 'custom' && f.name === 'Archive'));

  // Import into a brand-new vault (replace) and confirm the favorite survives.
  const { vault: fresh } = await freshVault();
  await fresh.importBackup(backup, 'replace');
  const imported = await fresh.findByUrl('https://example.com/i');
  assert.equal(imported.favorite, true);
  assert.equal(imported.folderName, 'Archive');

  await vault.close();
  await fresh.close();
});
