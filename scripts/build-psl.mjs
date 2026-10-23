#!/usr/bin/env node
/**
 * Regenerates src/lib/psl-data.js from the official Public Suffix List.
 *
 * The Public Suffix List is licensed under the Mozilla Public License 2.0.
 * Only the ICANN section is embedded: private suffix rules (for example
 * `github.io` or `vercel.app`) are intentionally excluded so that pages on a
 * shared hosting platform are grouped by the platform rather than by the
 * tenant. See docs/THIRD-PARTY.md.
 *
 * Usage: node scripts/build-psl.mjs [--source path-to-list.dat]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const OUT_FILE = resolve(ROOT, 'src/lib/psl-data.js');

function toAsciiHost(value) {
  try {
    const url = new URL(`http://${value}/`);
    return url.hostname.replace(/\.$/, '');
  } catch {
    return '';
  }
}

function normaliseRule(rule) {
  let prefix = '';
  let body = rule;
  if (body.startsWith('!')) {
    prefix = '!';
    body = body.slice(1);
  } else if (body.startsWith('*.')) {
    prefix = '*.';
    body = body.slice(2);
  }
  const ascii = toAsciiHost(body);
  if (!ascii || ascii.includes(':')) return '';
  return `${prefix}${ascii}`;
}

function extractIcann(text) {
  const lines = text.split(/\r?\n/);
  const rules = new Set();
  let inIcann = false;
  let sawMarkers = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '// ===BEGIN ICANN DOMAINS===') {
      inIcann = true;
      sawMarkers = true;
      continue;
    }
    if (line === '// ===END ICANN DOMAINS===') {
      inIcann = false;
      continue;
    }
    if (!sawMarkers) {
      // Fall back to the whole file if markers ever change.
      inIcann = true;
    }
    if (!inIcann || !line || line.startsWith('//')) continue;
    const normalised = normaliseRule(line);
    if (normalised) rules.add(normalised);
  }

  return [...rules].sort();
}

async function getSourceText() {
  const explicit = process.argv.indexOf('--source');
  if (explicit !== -1 && process.argv[explicit + 1]) {
    return readFile(resolve(process.argv[explicit + 1]), 'utf8');
  }
  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'CofreTabs-PSL-Builder/1.0 (+https://madwolfstudios.com/)' },
  });
  if (!response.ok) throw new Error(`PSL download failed: HTTP ${response.status}`);
  return response.text();
}

const text = await getSourceText();
const rules = extractIcann(text);
if (rules.length < 1000) {
  throw new Error(`Refusing to write a suspiciously small PSL (${rules.length} rules)`);
}

const generatedAt = new Date().toISOString().slice(0, 10);
const output = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with: node scripts/build-psl.mjs
//
// Source: Public Suffix List, ICANN section only.
//   ${SOURCE_URL}
// Snapshot generated: ${generatedAt} (${rules.length} rules)
//
// The Public Suffix List is licensed under the Mozilla Public License 2.0.
// See docs/THIRD-PARTY.md for attribution. This file is data, not code.

export const PSL_SNAPSHOT = ${JSON.stringify(generatedAt)};

export const PSL_TEXT = ${JSON.stringify(rules.join('\n'))};
`;

await writeFile(OUT_FILE, output, 'utf8');
console.log(`Wrote ${OUT_FILE} (${rules.length} rules, ${output.length} bytes)`);
