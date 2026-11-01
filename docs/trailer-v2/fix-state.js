(async () => {
  // Read the vault's ground truth from IndexedDB (run on fix.html).
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('cofretabs');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const items = await new Promise((res, rej) => {
    const tx = db.transaction('tabs', 'readonly');
    const rq = tx.objectStore('tabs').getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  const t = items.find((x) => String(x.url || '').includes('developer.chrome.com/docs/extensions'));
  const so = items.find((x) => String(x.url || '').includes('stackoverflow.com'));
  return {
    active: items.filter((x) => !x.deletedAt).length,
    trashed: items.filter((x) => Boolean(x.deletedAt)).length,
    fav: Boolean(t && t.favorite),
    folderId: t ? (t.folderId || null) : null,
    note: t ? (t.note || '') : '',
    soActive: Boolean(so && !so.deletedAt),
  };
})()
