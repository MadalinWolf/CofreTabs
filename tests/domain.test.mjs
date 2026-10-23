import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyUrl,
  folderNameFromDomain,
  getPublicSuffix,
  getRegistrableDomain,
  normalizeHostname,
} from '../src/lib/domain.js';

test('classifies the documented example sites into friendly folders', () => {
  const cases = [
    ['https://www.youtube.com/watch?v=123', 'YouTube', 'youtube.com'],
    ['https://github.com/MadalinWolf', 'GitHub', 'github.com'],
    ['https://www.reddit.com/r/brave', 'Reddit', 'reddit.com'],
    ['https://www.etsy.com/listing/example', 'Etsy', 'etsy.com'],
    ['https://en.wikipedia.org/wiki/Privacy', 'Wikipedia', 'wikipedia.org'],
    ['https://news.ycombinator.com/item?id=1', 'Hacker News', 'ycombinator.com'],
  ];

  for (const [url, folderName, domain] of cases) {
    const result = classifyUrl(url);
    assert.equal(result.ok, true, `expected ${url} to classify`);
    assert.equal(result.folderName, folderName);
    assert.equal(result.folderKey, domain);
  }
});

test('keeps the original hostname while grouping www and subdomains together', () => {
  const www = classifyUrl('https://www.youtube.com/watch?v=abc');
  const mobile = classifyUrl('https://m.youtube.com/watch?v=abc');

  assert.equal(www.hostname, 'www.youtube.com');
  assert.equal(www.displayHost, 'youtube.com');
  assert.equal(mobile.hostname, 'm.youtube.com');
  assert.equal(www.folderKey, mobile.folderKey);
  assert.equal(www.folderName, mobile.folderName);
});

test('handles multi-part public suffixes', () => {
  assert.equal(getPublicSuffix('www.bbc.co.uk'), 'co.uk');
  assert.equal(getRegistrableDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(getRegistrableDomain('shop.example.com.au'), 'example.com.au');
  assert.equal(getRegistrableDomain('a.b.example.co.nz'), 'example.co.nz');
  assert.equal(getRegistrableDomain('deep.subdomain.example.com'), 'example.com');
  assert.equal(getRegistrableDomain('example.com'), 'example.com');
});

test('implements Public Suffix List wildcard and exception rules', () => {
  // *.ck: any single label under .ck is itself a public suffix.
  assert.equal(getPublicSuffix('foo.bar.ck'), 'bar.ck');
  assert.equal(getRegistrableDomain('foo.bar.ck'), 'foo.bar.ck');
  // !www.ck: an exception to the wildcard rule.
  assert.equal(getPublicSuffix('www.ck'), 'ck');
  assert.equal(getRegistrableDomain('www.ck'), 'www.ck');
  // A host that is itself a public suffix has no registrable parent.
  assert.equal(getRegistrableDomain('co.uk'), 'co.uk');
});

test('handles localhost and IP hosts without inventing domains', () => {
  assert.equal(getRegistrableDomain('localhost'), 'localhost');
  assert.equal(classifyUrl('http://localhost:3000/dev').folderName, 'Localhost');
  assert.equal(getRegistrableDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(classifyUrl('http://127.0.0.1:8080/').folderName, 'Local Network');
  assert.equal(getRegistrableDomain('[::1]'), '[::1]');
});

test('handles internationalised domain names via punycode', () => {
  const result = classifyUrl('https://münchen.de/straße');
  assert.equal(result.ok, true);
  assert.equal(result.hostname, 'xn--mnchen-3ya.de');
  assert.equal(result.folderKey, 'xn--mnchen-3ya.de');
});

test('derives readable names for unknown domains', () => {
  assert.equal(folderNameFromDomain('example.com'), 'Example');
  assert.equal(folderNameFromDomain('my-cool_site.co.uk'), 'My Cool Site');
  assert.equal(folderNameFromDomain('news.example.org'), 'Example');
  assert.equal(folderNameFromDomain('bbc.co.uk'), 'BBC');
  assert.equal(folderNameFromDomain('localhost'), 'Localhost');
});

test('normalises hostnames safely', () => {
  assert.equal(normalizeHostname('WWW.Example.COM.'), 'www.example.com');
  assert.equal(normalizeHostname('https://www.example.com/path'), 'www.example.com');
  assert.equal(normalizeHostname('bad host'), '');
  assert.equal(normalizeHostname('example.com/path'), '');
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname(null), '');
});

test('rejects URLs that cannot be saved', () => {
  for (const bad of [
    '',
    'not a url',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'chrome://settings',
    'file:///C:/secret.txt',
    'https://user:password@example.com/',
    'ftp://example.com/file',
    'https://',
  ]) {
    const result = classifyUrl(bad);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.equal(typeof result.error, 'string');
  }
});

test('a folder key never contains credentials or a port', () => {
  const result = classifyUrl('https://www.example.com:8443/private?q=1#frag');
  assert.equal(result.ok, true);
  assert.equal(result.hostname, 'www.example.com');
  assert.equal(result.folderKey, 'example.com');
});
