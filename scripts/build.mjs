#!/usr/bin/env node
/**
 * Builds the loadable unpacked extension in dist/.
 *
 * There is no bundler: the extension uses plain ES modules, so the build is a
 * deterministic file copy plus a set of integrity checks. Run `npm run package`
 * to also produce the release ZIP.
 */
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = resolve(ROOT, 'dist');

const RUNTIME_DIRS = ['src', 'assets'];
const ROOT_FILES = ['manifest.json', 'README.md', 'LICENSE'];
const FORBIDDEN_PERMISSIONS = new Set([
  'tabs',
  'history',
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'clipboardRead',
  'clipboardWrite',
  'downloads',
  'nativeMessaging',
  'management',
  'sessions',
  'bookmarks',
  'topSites',
  'proxy',
  'debugger',
  'unlimitedStorage',
]);

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function walk(directory, base = directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(fullPath, base)));
    } else if (entry.isFile()) {
      results.push({ fullPath, relativePath: relative(base, fullPath).split(sep).join('/') });
    }
  }
  return results;
}

function parsePngSize(buffer) {
  if (buffer.length < 24) throw new Error('PNG is too short.');
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file.');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function validateHtmlReferences(htmlPath, errors) {
  const html = await readFile(htmlPath, 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html)) {
    errors.push(`${relative(ROOT, htmlPath)} contains an inline script, which the extension CSP would block.`);
  }
  if (/\son[a-z]+\s*=/i.test(html)) {
    errors.push(`${relative(ROOT, htmlPath)} contains inline event handler attributes.`);
  }
  const referencePattern = /(?:src|href)\s*=\s*"([^"]+)"/gi;
  let match;
  while ((match = referencePattern.exec(html))) {
    const reference = match[1];
    if (!reference || reference.startsWith('#') || /^(?:https?:|mailto:|data:|about:)/i.test(reference)) continue;
    const clean = reference.split(/[?#]/)[0];
    const target = resolve(dirname(htmlPath), clean);
    try {
      await stat(target);
    } catch {
      errors.push(`${relative(ROOT, htmlPath)} references missing file: ${reference}`);
    }
  }
}

async function validateSourceImports(sources, errors) {
  const importPattern = /(?:^|\n)\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g;
  for (const file of sources) {
    if (extname(file) !== '.js') continue;
    const text = await readFile(file, 'utf8');
    let match;
    while ((match = importPattern.exec(text))) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        errors.push(`${relative(ROOT, file)} imports a bare module ("${specifier}"). Runtime must stay dependency-free.`);
        continue;
      }
      const target = resolve(dirname(file), specifier);
      try {
        await stat(target);
      } catch {
        errors.push(`${relative(ROOT, file)} imports a missing module: ${specifier}`);
      }
    }
  }
}

async function validateManifest(root, errors, warnings) {
  const manifestPath = join(root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    errors.push(`manifest.json is not valid JSON: ${error.message}`);
    return null;
  }

  if (manifest.manifest_version !== 3) errors.push('manifest.json must use manifest_version 3.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) errors.push('manifest.json needs a semantic version.');
  if (!manifest.name || !manifest.description) errors.push('manifest.json needs a name and description.');
  if (manifest.description && manifest.description.length > 132) {
    errors.push('manifest.json description is longer than the Chrome Web Store limit (132 chars).');
  }

  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  for (const permission of permissions) {
    if (FORBIDDEN_PERMISSIONS.has(permission)) {
      errors.push(`Unnecessary permission declared: ${permission}`);
    }
  }
  if (permissions.includes('<all_urls>') || manifest.host_permissions?.length) {
    errors.push('CofreTabs must not request host permissions; it relies on activeTab.');
  }
  if (!permissions.includes('activeTab') || !permissions.includes('scripting')) {
    errors.push('manifest.json must declare activeTab and scripting.');
  }

  if (manifest.background?.type !== 'module') errors.push('The service worker must be declared as a module.');
  if (!manifest.background?.service_worker) errors.push('manifest.json has no background service worker.');
  if (manifest.action?.default_popup) errors.push('The toolbar action should inject the panel, not open a popup.');

  const csp = manifest.content_security_policy?.extension_pages;
  if (!csp || /unsafe-(?:inline|eval)/.test(csp)) {
    errors.push('Extension CSP must be set without unsafe-inline or unsafe-eval.');
  }

  const referenced = [];
  if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
  for (const source of Object.values(manifest.icons || {})) referenced.push(source);
  for (const source of Object.values(manifest.action?.default_icon || {})) referenced.push(source);
  for (const resource of manifest.web_accessible_resources || []) {
    for (const item of resource.resources || []) referenced.push(item);
  }

  for (const reference of referenced) {
    if (/^(?:https?:)?\/\//.test(reference)) {
      errors.push(`manifest.json references a remote resource: ${reference}`);
      continue;
    }
    try {
      await stat(join(root, reference));
    } catch {
      errors.push(`manifest.json references a missing file: ${reference}`);
    }
  }

  const iconEntries = Object.entries(manifest.icons || {});
  for (const [size, iconPath] of iconEntries) {
    try {
      const buffer = await readFile(join(root, iconPath));
      const actual = parsePngSize(buffer);
      if (actual.width !== Number(size) || actual.height !== Number(size)) {
        errors.push(`${iconPath} is ${actual.width}x${actual.height}, expected ${size}x${size}.`);
      }
    } catch (error) {
      errors.push(`Could not read icon ${iconPath}: ${error.message}`);
    }
  }

  if (!manifest.icons?.['16'] || !manifest.icons?.['32'] || !manifest.icons?.['48'] || !manifest.icons?.['128']) {
    errors.push('Icons 16, 32, 48 and 128 are required.');
  }

  if (!manifest.homepage_url) warnings.push('No homepage_url set in manifest.json.');

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.version) {
    errors.push(`package.json version (${pkg.version}) does not match manifest.json (${manifest.version}).`);
  }

  return manifest;
}

async function scanForForbiddenPatterns(files, errors) {
  for (const file of files) {
    const extension = extname(file);
    if (!['.js', '.html', '.css'].includes(extension)) continue;
    const text = await readFile(file, 'utf8');
    const rel = relative(ROOT, file);
    if (/\beval\s*\(/.test(text)) errors.push(`${rel} uses eval().`);
    if (/\bnew Function\s*\(/.test(text)) errors.push(`${rel} uses new Function().`);
    if (/\.innerHTML\s*=/.test(text)) errors.push(`${rel} assigns innerHTML; use DOM APIs and textContent.`);
    if (/document\.write\s*\(/.test(text)) errors.push(`${rel} uses document.write().`);
    if (/\bfetch\s*\(\s*['"`](?:https?:)?\/\//.test(text)) errors.push(`${rel} performs a remote fetch().`);
    if (/chrome\.storage\./.test(text)) errors.push(`${rel} uses chrome.storage without a declared need.`);
    if (/\bchrome\.(?:history|cookies|webRequest)\./.test(text)) errors.push(`${rel} uses an out-of-scope chrome API.`);
  }
}

export async function build({ outDir = DEFAULT_OUT, quiet = false } = {}) {
  const target = resolve(outDir);
  if (!isInside(ROOT, target) || target === ROOT) {
    throw new Error(`Refusing to build outside the project: ${target}`);
  }

  const errors = [];
  const warnings = [];

  for (const file of ROOT_FILES) {
    try {
      await stat(join(ROOT, file));
    } catch {
      errors.push(`Missing required project file: ${file}`);
    }
  }

  const manifest = await validateManifest(ROOT, errors, warnings);

  if (errors.length) {
    throw new Error(`Build validation failed:\n- ${errors.join('\n- ')}`);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  for (const directory of RUNTIME_DIRS) {
    await cp(join(ROOT, directory), join(target, directory), {
      recursive: true,
      filter: (source) => !source.endsWith('.map'),
    });
  }
  for (const file of ROOT_FILES) {
    await cp(join(ROOT, file), join(target, file));
  }

  const files = await walk(target);

  // Integrity checks on the copied tree.
  await validateSourceImports(files.map((file) => file.fullPath), errors);
  await scanForForbiddenPatterns(files.map((file) => file.fullPath), errors);

  for (const file of files) {
    if (extname(file.fullPath) === '.html') {
      await validateHtmlReferences(file.fullPath, errors);
    }
  }

  if (!files.some((file) => file.relativePath === 'src/content/panel.js')) {
    errors.push('src/content/panel.js is missing from the build.');
  }
  if (!files.some((file) => file.relativePath === 'src/styles/panel.css')) {
    errors.push('src/styles/panel.css is missing from the build.');
  }
  if (!files.some((file) => file.relativePath === 'src/library/privacy.html')) {
    errors.push('src/library/privacy.html is missing from the build.');
  }

  if (errors.length) {
    throw new Error(`Build validation failed:\n- ${errors.join('\n- ')}`);
  }

  let bytes = 0;
  for (const file of files) {
    const info = await stat(file.fullPath);
    bytes += info.size;
    if (info.size > 600_000) warnings.push(`Large runtime file: ${file.relativePath} (${info.size} bytes)`);
  }

  const info = {
    name: manifest.name,
    version: manifest.version,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    bytes,
  };
  await writeFile(join(target, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');

  if (!quiet) {
    console.log(`Built ${manifest.name} v${manifest.version} → ${target}`);
    console.log(`  ${files.length + 1} files, ${(bytes / 1024).toFixed(1)} KiB`);
    for (const warning of warnings) console.warn(`  warning: ${warning}`);
  }

  return { outDir: target, manifest, files: files.map((file) => file.relativePath).concat('BUILD-INFO.json'), warnings, info };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outDir = outIndex !== -1 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : DEFAULT_OUT;
  try {
    await build({ outDir });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) await main();
