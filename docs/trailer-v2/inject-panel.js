(async () => {
  // Inject the panel into the chrome-dev tab — the exact same code path the
  // Ctrl+Shift+P command uses (service worker runs this same file). Runs from
  // fix.html (extension origin), so no OS keyboard is involved.
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => t.url && t.url.startsWith('https://developer.chrome.com/docs/extensions'));
  if (!tab) return { ok: false, err: 'chrome-dev tab not found' };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/panel.js'] });
  return { ok: true, tabId: tab.id };
})()
