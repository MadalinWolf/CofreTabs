import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  buildBackup,
  normalizeBackupData,
  parseBackupText,
} from '../src/lib/backup.js';
import { Vault } from '../src/storage/vault.js';

const PNG_FAVICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function sampleBackup() {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    app: { name: 'CofreTabs', version: '1.0.0' },
    exportedAt: '2026-01-01T00:00:00.000Z',
    counts: { tabs: 2, active: 1, trashed: 1, folders: 1 },
    folders: [
      { id: 'folder-1', key: 'github.com', name: 'GitHub', createdAt: 1000, updatedAt: 1000 },
    ],
    tabs: [
      {
        id: 'tab-1',
        title: 'CofreTabs',
        url: 'https://github.com/MadalinWolf/CofreTabs',
        hostname: 'github.com',
        folderId: 'folder-1',
        folderName: 'GitHub',
        faviconUrl: '',
        note: '',
        createdAt: 2000,
        updatedAt: 2000,
        deletedAt: null,
      },
      {
        id: 'tab-2',
        title: 'Old page',
        url: 'https://example.com/old',
        hostname: 'example.com',
        folderId: '',
        folderName: 'Example',
        faviconUrl: '',
        note: 'old',
        createdAt: 3000,
        updatedAt: 3000,
        deletedAt: 4000,
      },
    ],
  };
}

test('buildBackup produces a versioned, self-describing file', () => {
  const backup = buildBackup({
    folders: [{ id: 'f1', key: 'example.com', name: 'Example', createdAt: 1, updatedAt: 2 }],
    tabs: [
      {
        id: 't1',
        title: 'Example',
        url: 'https://example.com/',
        hostname: 'example.com',
        folderId: 'f1',
        folderName: 'Example',
        faviconUrl: '',
        note: '',
        createdAt: 3,
        updatedAt: 3,
        deletedAt: null,
      },
    ],
    appVersion: '1.0.0',
    exportedAt: '2026-10-23T00:00:00.000Z',
  });

  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.schemaVersion, BACKUP_SCHEMA_VERSION);
  assert.equal(backup.exportedAt, '2026-10-23T00:00:00.000Z');
  assert.equal(backup.counts.tabs, 1);
  assert.equal(backup.counts.active, 1);
  assert.equal(backup.tabs[0].title, 'Example');
});

test('rejects invalid JSON with a clear code', () => {
  assert.throws(
    () => parseBackupText('{ this is not json'),
    (error) => error.code === 'INVALID_JSON',
  );
  assert.throws(() => parseBackupText(''), (error) => error.code === 'INVALID_JSON');
});

test('rejects newer schema versions', () => {
  assert.throws(
    () => normalizeBackupData({ ...sampleBackup(), schemaVersion: 2 }),
    (error) => error.code === 'INCOMPATIBLE_SCHEMA',
  );
  assert.throws(
    () => normalizeBackupData({ ...sampleBackup(), schemaVersion: '1' }),
    (error) => error.code === 'INVALID_SCHEMA',
  );
});

test('rejects invalid tab URLs and reports the row', () => {
  const backup = sampleBackup();
  backup.tabs[1].url = 'javascript:alert(1)';
  assert.throws(
    () => normalizeBackupData(backup),
    (error) => error.code === 'INVALID_TAB_URL' && error.details.index === 1,
  );
});

test('normalises and sanitises imported values', () => {
  const backup = sampleBackup();
  backup.tabs[0].title = '<img src=x onerror=alert(1)>' + 'x'.repeat(900);
  backup.tabs[0].note = 'a\n\n\n\nb';
  backup.tabs[0].faviconUrl = 'https://evil.example/favicon.ico';
  backup.tabs[1].faviconUrl = PNG_FAVICON;

  const normalized = normalizeBackupData(backup);
  const active = normalized.tabs[0];
  assert.ok(active.title.startsWith('<img src=x onerror=alert(1)>'));
  assert.equal(active.title.length, 500);
  assert.equal(active.note, 'a\n\nb');
  assert.equal(active.faviconUrl, '');
  assert.equal(normalized.tabs[1].faviconUrl, PNG_FAVICON);
  assert.equal(normalized.tabs[1].deletedAt, 4000);
});

test('normalises URLs and re-files tabs whose folder is missing', () => {
  const backup = sampleBackup();
  backup.tabs[0].url = 'HTTPS://WWW.YOUTUBE.COM/watch?v=1#frag';
  backup.tabs[0].folderId = 'missing-folder';
  backup.tabs[0].folderName = '';

  const normalized = normalizeBackupData(backup);
  assert.equal(normalized.tabs[0].url, 'https://www.youtube.com/watch?v=1#frag');
  assert.equal(normalized.tabs[0].folderName, 'YouTube');
  assert.equal(normalized.tabs[0].folderId, '');
});

test('duplicate folder ids and tab ids are remapped without failing', () => {
  const backup = sampleBackup();
  backup.folders.push({ ...backup.folders[0], name: 'GitHub copy' });
  backup.tabs.push({ ...backup.tabs[0], url: 'https://github.com/other' });

  const normalized = normalizeBackupData(backup);
  assert.equal(new Set(normalized.folders.map((folder) => folder.id)).size, 2);
  assert.equal(new Set(normalized.tabs.map((tab) => tab.id)).size, 3);
});

async function freshVault() {
  const factory = new IDBFactory();
  const vault = new Vault({ indexedDB: factory, dbName: `cofretabs-backup-${Date.now()}-${Math.random()}` });
  await vault.init();
  return vault;
}

test('export and merge-import round-trip, skipping duplicates', async () => {
  const source = await freshVault();
  const saved = await source.saveTab({
    url: 'https://github.com/MadalinWolf/CofreTabs',
    title: 'CofreTabs',
    note: 'local only',
  });
  await source.saveTab({ url: 'https://example.com/trashed', title: 'Trashed' });
  const trashed = (await source.getLibrary({ view: 'all' })).items.find((item) => item.title === 'Trashed');
  await source.moveToTrash(trashed.id);
  const backup = await source.exportBackup('1.0.0');
  await source.close();

  assert.equal(backup.counts.tabs, 2);
  assert.equal(backup.counts.trashed, 1);

  const target = await freshVault();
  const firstImport = await target.importBackup(backup, 'merge');
  assert.equal(firstImport.imported, 2);
  assert.equal(firstImport.skipped, 0);

  const secondImport = await target.importBackup(backup, 'merge');
  assert.equal(secondImport.skipped, 2);
  assert.equal(secondImport.imported, 0);

  const stats = await target.getStats();
  assert.equal(stats.active, 1);
  assert.equal(stats.trashed, 1);
  const restored = (await target.getLibrary({ view: 'all' })).items[0];
  assert.equal(restored.title, saved.entry.title);
  assert.equal(restored.note, 'local only');

  await target.close();
});

test('replace import removes existing data, merge keeps it', async () => {
  const vault = await freshVault();
  await vault.saveTab({ url: 'https://keep-me.example.com/', title: 'Keep me' });

  const backup = sampleBackup();
  const merged = await vault.importBackup(backup, 'merge');
  assert.equal(merged.imported, 2);
  assert.equal((await vault.getStats()).active, 2);

  const replaced = await vault.importBackup(backup, 'replace');
  assert.equal(replaced.removedExisting, 3);
  const stats = await vault.getStats();
  assert.equal(stats.active, 1);
  assert.equal(stats.trashed, 1);
  const titles = (await vault.getLibrary({ view: 'all' })).items.map((item) => item.title);
  assert.deepEqual(titles, ['CofreTabs']);

  await vault.close();
});

test('import creates missing folders and reuses existing ones by domain', async () => {
  const vault = await freshVault();
  const existing = await vault.saveTab({ url: 'https://youtube.com/watch?v=1', title: 'Video' });

  const backup = sampleBackup();
  backup.folders = [];
  backup.tabs = [
    {
      ...backup.tabs[0],
      id: 'yt',
      url: 'https://www.youtube.com/watch?v=2',
      folderId: '',
      folderName: '',
    },
  ];
  const result = await vault.importBackup(backup, 'merge');
  assert.equal(result.imported, 1);
  assert.equal(result.foldersCreated, 0);

  const folders = await vault.listFolders();
  const youtube = folders.find((folder) => folder.key === 'youtube.com');
  assert.equal(youtube.count, 2);
  assert.equal(youtube.id, existing.folder.id);

  await vault.close();
});

test('merged folder names do not collide case-insensitively', async () => {
  const vault = await freshVault();
  await vault.saveTab({ url: 'https://example.com/a', title: 'A' }); // folder "Example"

  const backup = sampleBackup();
  backup.folders = [{ id: 'f2', key: 'example.net', name: 'example', createdAt: 1, updatedAt: 1 }];
  backup.tabs = [
    {
      ...backup.tabs[0],
      url: 'https://example.net/b',
      folderId: 'f2',
      folderName: 'example',
    },
  ];
  await vault.importBackup(backup, 'merge');

  const names = (await vault.listFolders()).map((folder) => folder.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('example'));
  assert.ok(names.some((name) => name !== 'example'));

  await vault.close();
});

test('imported text is never interpreted as markup', async () => {
  const vault = await freshVault();
  const backup = sampleBackup();
  backup.tabs[0].title = '<script>window.__pwned = true</script>';
  const result = await vault.importBackup(backup, 'merge');
  assert.equal(result.imported, 2);
  const item = (await vault.getLibrary({ view: 'all' })).items[0];
  assert.equal(item.title, '<script>window.__pwned = true</script>');
  await vault.close();
});
