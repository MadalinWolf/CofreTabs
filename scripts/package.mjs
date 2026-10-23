#!/usr/bin/env node
/**
 * Packages the built extension into a clean release ZIP.
 *
 * Usage:
 *   node scripts/package.mjs
 *   node scripts/package.mjs --dist dist --zip release/CofreTabs-v1.0.0.zip
 *   node scripts/package.mjs --no-build
 *
 * The ZIP contains the contents of dist/ at its root (manifest.json at the
 * top level is what stores and "load unpacked" users expect).
 */
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from './build.mjs';
import { createZip, listZipEntries } from './lib/zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIST = resolve(ROOT, 'dist');
const DEFAULT_RELEASE = resolve(ROOT, 'release');
const RELEASE_NOTES = resolve(ROOT, 'docs/RELEASE-NOTES-v1.0.0.md');

async function collectFiles(directory, base = directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, base, results);
    } else if (entry.isFile()) {
      results.push({ fullPath, name: fullPath.slice(base.length + 1).replace(/\\/g, '/') });
    }
  }
  return results;
}

export async function packageRelease({ distDir = DEFAULT_DIST, zipPath, releaseDir, skipBuild = false, quiet = false } = {}) {
  if (!skipBuild) {
    await build({ outDir: distDir, quiet });
  }

  const manifest = JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  const release = releaseDir ? resolve(releaseDir) : DEFAULT_RELEASE;
  const zipFile = zipPath ? resolve(zipPath) : join(release, `${manifest.name}-v${version}.zip`);

  await mkdir(release, { recursive: true });
  await mkdir(dirname(zipFile), { recursive: true });

  const files = await collectFiles(distDir);
  if (!files.some((file) => file.name === 'manifest.json')) {
    throw new Error('dist/manifest.json is missing; refusing to package.');
  }
  if (files.some((file) => file.name.endsWith('.map') || file.name.includes('node_modules/'))) {
    throw new Error('Development artefacts found in the build output; refusing to package.');
  }

  const entries = [];
  let uncompressed = 0;
  for (const file of files) {
    const data = await readFile(file.fullPath);
    uncompressed += data.length;
    entries.push({ name: file.name, data });
  }

  const zipBuffer = createZip(entries);
  await writeFile(zipFile, zipBuffer);

  const verified = listZipEntries(zipBuffer);
  const verifiedNames = new Set(verified.map((entry) => entry.name));
  for (const required of [
    'manifest.json',
    'src/background/service-worker.js',
    'src/content/panel.js',
    'src/library/library.html',
    'src/library/library.js',
    'src/library/privacy.html',
    'src/styles/panel.css',
    'src/styles/library.css',
    'assets/icons/icon16.png',
    'assets/icons/icon32.png',
    'assets/icons/icon48.png',
    'assets/icons/icon128.png',
    'LICENSE',
  ]) {
    if (!verifiedNames.has(required)) throw new Error(`Release ZIP is missing ${required}`);
  }

  let notesPath = null;
  try {
    await stat(RELEASE_NOTES);
    notesPath = join(release, `RELEASE-NOTES-v${version}.md`);
    await copyFile(RELEASE_NOTES, notesPath);
  } catch {
    // Notes are optional; the changelog remains in the repository.
  }

  const sha256 = createHash('sha256').update(zipBuffer).digest('hex');
  const summary = {
    name: manifest.name,
    version,
    zip: zipFile,
    bytes: zipBuffer.length,
    uncompressedBytes: uncompressed,
    entries: verified.length,
    sha256,
    packagedAt: new Date().toISOString(),
  };
  await writeFile(join(release, `CofreTabs-v${version}.json`), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (!quiet) {
    console.log(`Packaged ${manifest.name} v${version}`);
    console.log(`  zip: ${zipFile}`);
    console.log(`  ${verified.length} entries, ${(zipBuffer.length / 1024).toFixed(1)} KiB compressed`);
    console.log(`  sha256: ${sha256}`);
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const valueFor = (flag) => {
    const index = args.indexOf(flag);
    return index !== -1 ? args[index + 1] : undefined;
  };

  try {
    const summary = await packageRelease({
      distDir: valueFor('--dist') ? resolve(valueFor('--dist')) : DEFAULT_DIST,
      zipPath: valueFor('--zip') ? resolve(valueFor('--zip')) : undefined,
      releaseDir: valueFor('--release') ? resolve(valueFor('--release')) : undefined,
      skipBuild: args.includes('--no-build'),
    });
    process.stdout.write(`RELEASE_ZIP=${summary.zip}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
