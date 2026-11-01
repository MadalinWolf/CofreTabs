import { getVault } from './src/storage/vault.js';

const log = (m) => { document.getElementById('log').textContent += '\n' + m; };
const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const now = Date.now();

// Real pages only: every URL is a live, publicly reachable page.
const TABS = [
  { url: 'https://github.com/MadalinWolf/CofreTabs', title: 'MadalinWolf/CofreTabs: Your tabs. Your vault. Your device.', note: 'v1.1.0 shipped — sync site copy after release', favorite: true, age: 2 * DAY + 3 * HOUR },
  { url: 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions', title: 'WebExtensions - Mozilla | MDN', note: 'compare chrome.* vs browser.* APIs', age: 5 * HOUR },
  { url: 'https://news.ycombinator.com/', title: 'Hacker News', note: '', favorite: false, age: 40 * MIN },
  { url: 'https://www.godotengine.org/', title: 'Godot Engine - Free and open source game engine', note: '', age: 4 * DAY },
  { url: 'https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html', title: 'GDScript basics — Godot Engine latest documentation', note: 'read the static typing section', favorite: true, age: 1 * DAY + 2 * HOUR },
  { url: 'https://en.wikipedia.org/wiki/Synthwave', title: 'Synthwave - Wikipedia', note: 'soundtrack research for the trailer', age: 6 * HOUR + 20 * MIN },
  { url: 'https://en.wikipedia.org/wiki/Chiptune', title: 'Chiptune - Wikipedia', note: '', age: 3 * DAY + 1 * HOUR },
  { url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs', title: 'chrome.tabs API - Chrome for Developers', note: '', age: 8 * HOUR },
  { url: 'https://stackoverflow.com/questions/tagged/chrome-extension', title: "Newest 'chrome-extension' Questions - Stack Overflow", note: '', age: 2 * HOUR + 10 * MIN },
  { url: 'https://github.com/topics/godot', title: 'godot · GitHub Topics', note: '', age: 3 * DAY + 9 * HOUR },
  { url: 'https://itch.io/game-assets/free/tag/2d', title: 'Free 2D Game Assets - itch.io', note: 'check every license before use', favorite: true, age: 19 * HOUR },
  { url: 'https://itch.io/jams', title: 'Game Jams - itch.io', note: '', age: 2 * DAY + 20 * HOUR },
  { url: 'https://obsidian.md/', title: 'Obsidian - Sharpen your thinking', note: '', age: 7 * HOUR },
  { url: 'https://web.dev/', title: 'web.dev', note: '', age: 30 * MIN },
  { url: 'https://example.com/', title: 'Example Domain', note: '', age: 6 * DAY, trash: true },
  { url: 'https://old.reddit.com/r/InternetIsBeautiful/', title: 'The Internet Is Beautiful', note: '', age: 8 * DAY, trash: true },
];

try {
  const vault = getVault();
  await vault.init();
  await vault.importBackup({ version: 1, meta: {}, folders: [], tabs: [] }, 'replace');

  for (const t of TABS) {
    const res = await vault.saveTab({ url: t.url, title: t.title, note: t.note || '' });
    const id = res.entry.id;
    if (t.favorite) await vault.updateTab(id, { favorite: true });
    if (t.trash) await vault.moveToTrash(id);
    log('saved: ' + t.url);
  }

  // Age the timestamps so "saved 2 d ago" style metadata looks lived-in.
  const db = await vault.ready();
  const tx = db.transaction(['tabs'], 'readwrite');
  const store = tx.objectStore('tabs');
  const all = await p(store.getAll());
  const byUrl = new Map(all.map((e) => [e.url, e]));
  for (const t of TABS) {
    const e = byUrl.get(t.url.replace(/\/$/, '')) || byUrl.get(t.url);
    if (!e) continue;
    const ts = now - t.age;
    e.createdAt = ts;
    e.updatedAt = t.trash ? ts + 60000 : ts;
    if (t.trash) e.deletedAt = ts + 60000;
    store.put(e);
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  const stats = await vault.getStats();
  log('DONE — active: ' + stats.active + ', trashed: ' + stats.trashed + ', folders: ' + stats.folders);
  window.__seeded = { ok: true, stats };
} catch (err) {
  log('SEED FAILED: ' + (err && err.message));
  window.__seeded = { ok: false, error: String(err) };
}
