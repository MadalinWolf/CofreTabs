import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { build } from '../scripts/build.mjs';
import { packageRelease } from '../scripts/package.mjs';
import { listZipEntries } from '../scripts/lib/zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_BUILD = join(ROOT, '.test-build');
const TEST_RELEASE = join(ROOT, '.test-release');

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('manifest is a minimal Manifest V3 extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.name);
  assert.ok(manifest.description.length <= 132);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.background.service_worker, 'src/background/service-worker.js');
  assert.ok(manifest.content_security_policy.extension_pages);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-(?:inline|eval)/);
  assert.equal(manifest.homepage_url, 'https://madwolfstudios.com/');
});

test('all manifest resources exist and icons have the declared dimensions', async () => {
  const referenced = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.web_accessible_resources.flatMap((entry) => entry.resources),
  ];

  for (const reference of referenced) {
    assert.ok(await exists(join(ROOT, reference)), `missing manifest resource: ${reference}`);
  }

  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    const buffer = await readFile(join(ROOT, iconPath));
    assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${iconPath} is not a PNG`);
    assert.equal(buffer.readUInt32BE(16), Number(size), `${iconPath} width`);
    assert.equal(buffer.readUInt32BE(20), Number(size), `${iconPath} height`);
  }
});

test('release documentation and privacy page are present without fake donation links', async () => {
  for (const file of [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'SECURITY.md',
    'docs/PRIVACY.md',
    'docs/QA-CHECKLIST.md',
    'docs/STORE.md',
    'docs/RELEASE-NOTES-v1.0.0.md',
    'src/library/privacy.html',
    'website/index.html',
  ]) {
    assert.ok(await exists(join(ROOT, file)), `missing release file: ${file}`);
  }

  const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /https:\/\/github\.com\/sponsors\/MadalinWolf/);
  assert.doesNotMatch(readme, /TODO: ADD DONATION LINK/);
  assert.match(readme, /Your tabs\. Your vault\. Your device\./);
  assert.doesNotMatch(readme, /https:\/\/github\.com\/MadalinWolf\/CofreTabs\/releases\/download/);
});

test('the extension builds without touching the checked-in tree', async (t) => {
  t.after(() => rm(TEST_BUILD, { recursive: true, force: true }));

  const result = await build({ outDir: TEST_BUILD, quiet: true });
  assert.ok(result.files.includes('manifest.json'));
  assert.ok(result.files.includes('src/background/service-worker.js'));
  assert.ok(result.files.includes('src/content/panel.js'));
  assert.ok(result.files.includes('src/library/library.html'));
  assert.ok(result.files.includes('src/library/privacy.html'));
  assert.ok(result.files.includes('BUILD-INFO.json'));
  assert.equal(result.info.version, pkg.version);
  assert.equal(result.warnings.length, 0);
});

test('packaging produces a verified, reproducible release ZIP', async (t) => {
  t.after(async () => {
    await rm(TEST_BUILD, { recursive: true, force: true });
    await rm(TEST_RELEASE, { recursive: true, force: true });
  });

  const summary = await packageRelease({
    distDir: TEST_BUILD,
    releaseDir: TEST_RELEASE,
    zipPath: join(TEST_RELEASE, 'CofreTabs-test.zip'),
    quiet: true,
  });

  const archive = await readFile(summary.zip);
  assert.equal(summary.entries, listZipEntries(archive).length);
  assert.equal(createHash('sha256').update(archive).digest('hex'), summary.sha256);
  assert.equal(archive.subarray(0, 2).toString('latin1'), 'PK');

  const names = new Set(listZipEntries(archive).map((entry) => entry.name));
  for (const required of [
    'manifest.json',
    'LICENSE',
    'src/background/service-worker.js',
    'src/content/panel.js',
    'src/library/library.html',
    'src/library/privacy.html',
    'src/styles/panel.css',
    'src/styles/library.css',
    'assets/icons/icon16.png',
    'assets/icons/icon128.png',
  ]) {
    assert.ok(names.has(required), `ZIP is missing ${required}`);
  }
  assert.ok(![...names].some((name) => name.endsWith('.map')));
  assert.ok(![...names].some((name) => name.includes('node_modules')));

  const info = JSON.parse(await readFile(join(TEST_RELEASE, `CofreTabs-v${pkg.version}.json`), 'utf8'));
  assert.equal(info.sha256, summary.sha256);
  assert.equal(info.version, pkg.version);
});
