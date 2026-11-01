(() => {
  // Measure the Stack Overflow row's RESTORE button while the trash view is
  // open (run right before the c17 clip — SO is only in the trash after c07).
  const ctr = (el) => {
    const b = el.getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  };
  const all = Array.from(document.querySelectorAll('[data-action="restore-tab"]'));
  for (const b of all) {
    const row = b.closest('.tab-row');
    if (row && row.textContent.includes('Newest')) {
      return { ok: true, restoreSO: ctr(b), count: all.length };
    }
  }
  return { ok: false, count: all.length };
})()
