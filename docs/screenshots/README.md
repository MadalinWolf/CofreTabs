# Screenshots

All images here use demo data and a local fixture page. They contain no personal
browsing data.

| File | What it shows |
| --- | --- |
| `panel.png` | The slide-over panel in its "review before save" state. |
| `panel-saved.png` | The panel after a simulated save acknowledgement. |
| `library.png` | The library populated with demo tabs. |

## How they were produced

- Browser: Google Chrome 155 (headless, CDP), Windows.
- The extension was loaded from `dist/` via the Chrome DevTools Protocol
  `Extensions.loadUnpacked` command.
- `library.png` is a **real extension page** with records written through the
  real `Vault` API into IndexedDB. Search was exercised in the page before the
  screenshot and returned the expected single result.
- `panel.png` / `panel-saved.png` use the **real `src/content/panel.js` and
  `src/content/panel.css`** rendered in Chrome on a local HTML fixture. Because
  a headless toolbar click cannot grant `activeTab`, the panel's
  `chrome.runtime` messaging was mocked with demo vault data. This is a visual
  capture, not an end-to-end injection test. End-to-end save/message behaviour is
  covered by `tests/panel-ui.test.mjs` and the manual checklist.
- Viewport: 1440×1000, device scale factor 1.
- No browser extensions other than the test build were loaded for the library
  capture; Chrome's built-in component extensions may still be present in the
  profile.

The fixture page text was written for this project. The URLs shown
(`boring.tools`, `github.com`, `developer.mozilla.org`, etc.) are demo entries;
none were fetched for the capture except the local fixture.

## Re-capturing

The browser automation scripts used for the capture were temporary and are not
part of the repository. A maintainer can reproduce them with any CDP client:

1. Build `dist/` and load it unpacked.
2. Seed demo records through `Vault` (see `tests/storage.test.mjs` for API
   examples).
3. Set a 1440×1000 viewport and capture PNG screenshots.
4. Confirm no real browsing data or personal folders are visible before
   committing.
