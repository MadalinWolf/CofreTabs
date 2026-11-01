(() => {
  // Measure the injected panel (run in the chrome-dev tab's main world).
  // Coordinates are VIEWPORT px (CDP Input uses them as-is; cursor glides add +95 Y).
  const host = document.getElementById('cofretabs-panel-host');
  if (!host || !host.shadowRoot) return { ok: false, err: 'panel host missing' };
  const sr = host.shadowRoot;
  const ctr = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  };
  const search = sr.querySelector('input[type="search"]');
  const lib = sr.querySelector('[data-action="open-library"]');
  const favs = Array.from(sr.querySelectorAll('[data-action="toggle-favorite"]'));
  const dels = Array.from(sr.querySelectorAll('[data-action="trash-item"]'));
  let trashSO = null;
  for (const b of dels) {
    const row = b.closest('.ct-item');
    if (row && row.textContent.includes('Newest')) { trashSO = ctr(b); break; }
  }
  const txt = sr.textContent || '';
  const m = txt.match(/vault\s*(\d+)\s*tabs/i);
  return {
    ok: Boolean(search && lib && favs[0] && trashSO),
    search: ctr(search),
    openLib: ctr(lib),
    heart1: ctr(favs[0]),
    trashSO,
    rows: dels.length,
    vault: m ? Number(m[1]) : -1,
    searchVal: search ? search.value : null,
  };
})()
