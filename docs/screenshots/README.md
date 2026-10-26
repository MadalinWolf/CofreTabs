# Screenshots

All images here use demo data and a local fixture page. They contain no personal
browsing data.

## v1.1.0 captures (current)

| File | What it shows |
| --- | --- |
| `panel-v1.1.0.png` | Slide-over save panel: detected page, SAVE THIS TAB, 3×3 folder grid with Favorites and recent tabs. |
| `panel-saved-v1.1.0.png` | Panel after a real save: write acknowledged, duplicate notice, updated vault count. |
| `panel-light-v1.1.0.png` | Panel in the light theme on an already-saved page (duplicate detection). |
| `library-v1.1.0.png` | Library, dark theme: Favorites, custom folders, MOVE controls, notes, theme switch, Trash count. |
| `library-light-v1.1.0.png` | Library, light theme. |
| `favorites-v1.1.0.png` | Favorites collection view. |
| `search-v1.1.0.png` | Search results across title/URL/notes. |
| `trash-v1.1.0.png` | Trash view with RESTORE / DELETE actions and EMPTY TRASH. |
| `import-v1.1.0.png` | Import backup dialog: validation preview, MERGE / REPLACE modes. |

Captured 2026-10-26 from the packaged v1.1.0 build (`dist/` produced by
`node scripts/build.mjs` at the `v1.1.0` tag) using the project's own
documented capture technique:

- **Library captures:** the real `src/library/library.html` page running the
  real `library.js`, `vault.js` and IndexedDB, served over local HTTP with only
  three `chrome.*` APIs stubbed (`getManifest`, `sendMessage`, `tabs.create`),
  because a scripted visit cannot be an extension page.
- **Panel captures:** the real, unmodified `src/content/panel.js` (classic
  script, Shadow DOM) rendered on a local article fixture, with
  `chrome.runtime` messaging answered by the real Vault in IndexedDB — the same
  documented mock used for the original screenshots below. Saving goes through
  the real `Vault.saveTab` write path.
- Demo fixture data only: well-known public sites used as URLs
  (`github.com`, `bbc.co.uk`, `developer.mozilla.org`, `youtube.com`,
  `news.ycombinator.com`, `arxiv.org`, `jvns.ca`, `danluu.com`,
  `css-tricks.com`, `boring.tools`). No personal browsing data appears in any
  image. Viewport 1440×1000, device scale factor 1, PNG.

## v1.0.0 captures (originals)

| File | What it shows |
| --- | --- |
| `panel.png` | The slide-over panel in its "review before save" state. |
| `panel-saved.png` | The panel after a simulated save acknowledgement. |
| `library.png` | The library populated with demo tabs. |

### How the v1.0.0 captures were produced

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
