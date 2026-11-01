(() => {
  // Measure the tab-edit dialog (note textarea + save), then CANCEL it
  // so prep leaves no state behind.
  const dlg = document.querySelector('dialog[open]');
  if (!dlg) return { ok: false, err: 'no open dialog' };
  const ctr = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  };
  const out = {
    ok: Boolean(dlg.querySelector('#edit-note') && dlg.querySelector('#edit-submit')),
    note: ctr(dlg.querySelector('#edit-note')),
    save: ctr(dlg.querySelector('#edit-submit')),
  };
  const close = dlg.querySelector('[data-close-dialog]');
  if (close) close.click();
  return out;
})()
