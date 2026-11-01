(() => {
  // Measure the GitHub folder card while the folders view is open.
  const ctr = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  };
  let card = null;
  for (const b of document.querySelectorAll('[data-action="open-folder"]')) {
    if (b.textContent.includes('GitHub')) { card = b; break; }
  }
  return {
    ok: Boolean(card),
    githubCard: ctr(card),
    header: document.body.textContent.includes('WEBSITE FOLDERS'),
  };
})()
