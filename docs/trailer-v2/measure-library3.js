(() => {
  // Measure the library page ('all' view) — viewport px, click centers.
  const q = (s) => document.querySelector(s);
  const ctr = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  };
  const theme = q('#theme-select');
  const search = q('#search-input');
  const edits = Array.from(document.querySelectorAll('[data-action="edit-tab"]'));
  let editBtn = null;
  let moveBtn = null;
  for (const b of edits) {
    const row = b.closest('.tab-row');
    if (row && row.textContent.includes('Chrome for Developers')) {
      editBtn = b;
      const id = b.getAttribute('data-id');
      moveBtn = document.querySelector('[data-action="move-tab"][data-id="' + id + '"]');
      break;
    }
  }
  return {
    ok: Boolean(theme && search && editBtn && moveBtn),
    navAll: ctr(q('.nav-item[data-view="all"]')),
    navFolders: ctr(q('.nav-item[data-view="folders"]')),
    navTrash: ctr(q('.nav-item[data-view="trash"]')),
    search: ctr(search),
    theme: ctr(theme),
    themeOpts: theme ? Array.from(theme.options).map((o) => o.value) : [],
    themeAttr: document.documentElement.getAttribute('data-theme'),
    edit1: ctr(editBtn),
    move1: ctr(moveBtn),
    editRows: edits.length,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    searchVal: search ? search.value : '',
  };
})()
