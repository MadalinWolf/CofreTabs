# QA checklist

Use this before tagging a release or uploading to a store. Automated checks are
listed first; the browser pass is still mandatory because jsdom cannot verify
real extension injection, layout or downloads.

## Automated

- [ ] `node --test` — all suites pass, including manifest/build/package tests.
- [ ] `node scripts/build.mjs` — build validation passes with no warnings.
- [ ] `node scripts/package.mjs` — ZIP written, entry count verified, SHA-256
      reported.
- [ ] `git status` reviewed: no `dist/`, `release/`, `node_modules/`, browser
      profiles, secrets or personal data staged.
- [ ] Manifest version and `package.json` version match.
- [ ] `docs/RELEASE-NOTES-v<version>.md` exists.

## Load and install

- [ ] Load `dist/` as an unpacked extension in a clean browser profile.
- [ ] No manifest, CSP or service-worker errors in `chrome://extensions`.
- [ ] Toolbar icon is visible and pinned; it uses the expected retro icon.
- [ ] Extension details show only **Read your browsing history on click** (or
      the browser's equivalent for `activeTab`) and scripting; no host access.
- [ ] Badge is empty on a fresh vault.

## Save flow — normal page

- [ ] Open a normal `https://` article. Click the toolbar icon.
- [ ] Panel slides in from the right, about 20% of the viewport, readable at
      1280×720, 1920×1080 and a narrow 900px window.
- [ ] Preview shows correct title, hostname, automatic folder and URL.
- [ ] Nothing is saved before pressing the button. (Close the panel, reopen the
      library, confirm the count did not change.)
- [ ] Press **SAVE THIS TAB**. Progress appears, then success only after the
      write. The library contains the entry.
- [ ] Second toolbar click closes the panel.
- [ ] Reopen the panel on the same page: duplicate status is shown, and saving
      again does not create a second active entry.
- [ ] Double-click the save button rapidly: only one record is created and no
      success message is shown for a rejected request.
- [ ] With DevTools set to offline, save still works (no network dependency).

## Save flow — edge cases

- [ ] Trash an entry, revisit the URL, reopen the panel: saving creates a fresh
      active entry (trashed entries do not block it).
- [ ] Open the panel, navigate the tab to another URL, then press save: the save
      is refused with a "page changed" message; no wrong URL is stored.
- [ ] Try `chrome://extensions`, `edge://settings`, the Chrome Web Store and a
      PDF viewer: library opens with a notice; nothing is auto-saved.
- [ ] Use a page with a very long title and a URL with query + fragment: layout
      remains readable; full URL including fragment is stored.
- [ ] Test `http://` (non-TLS) page if available.
- [ ] Test an internationalized domain (e.g. `https://münchen.de`): no crash and
      folder is sensible.

## Folder classification

Spot-check in the library after saving:

- [ ] `https://www.youtube.com/...` → YouTube, original hostname preserved.
- [ ] `https://news.bbc.co.uk/...` → BBC (not `co.uk`).
- [ ] `https://foo.github.io/...` → GitHub Pages grouping (private PSL rules
      excluded).
- [ ] `http://192.0.2.1/` → IP-based folder, no crash.
- [ ] `http://[2001:db8::1]/` → IPv6 folder, no crash.
- [ ] A malformed/unsupported scheme is rejected rather than guessed.

## Library

- [ ] Search by title, URL fragment, hostname, folder name and note text.
- [ ] Search with multiple tokens narrows results.
- [ ] Sort newest, oldest, title, domain and folder.
- [ ] Folder filter and "All tabs" switch correctly; counts match.
- [ ] Edit a title and note; reload the page and confirm persistence.
- [ ] Move a tab to another folder; counts update on both folders.
- [ ] Rename a folder; tabs show the new name immediately.
- [ ] Delete a folder: its active tabs move to Trash, are recoverable, and no
      permanent deletion occurs without a second explicit action.
- [ ] Restore a tab from Trash; it returns to its folder, or is re-filed by
      domain if the folder is gone.
- [ ] Permanently delete a single Trash entry after confirmation.
- [ ] Empty Trash after confirmation; counts update.
- [ ] Add a URL manually; invalid URLs are rejected with a readable message.
- [ ] Trash view is visually distinct and search/sort still work there.
- [ ] Empty states are clear and do not claim data exists.

## Import / export

- [ ] Export produces a JSON file that parses, with `format`,
      `schemaVersion: 1`, folders and tabs.
- [ ] Export includes trashed entries.
- [ ] Import the same file in merge mode: duplicates are skipped, counts are
      reported truthfully, original data is unchanged.
- [ ] Import in replace mode: existing data is replaced, Trash is restored from
      the file.
- [ ] Import invalid JSON: nothing changes; error is clear.
- [ ] Import a newer `schemaVersion`: refused with an upgrade message.
- [ ] Import a tab with an invalid URL: whole import refused.
- [ ] Import a backup containing `<img onerror=...>` in a title/note: rendered
      as text, no script execution.
- [ ] Import a backup with a remote favicon URL: no remote request; monogram
      fallback is used.

## Accessibility and keyboard

- [ ] Toolbar/panel can be dismissed with `Escape`.
- [ ] Focus moves into the panel and returns to the page on close.
- [ ] Tab order is logical; all controls have visible focus.
- [ ] Save/duplicate/error messages are announced (screen reader or accessibility
      inspector live region).
- [ ] With `prefers-reduced-motion: reduce`, the panel opens without a long
      animation and saving does not use a decorative delay.
- [ ] Zoom to 200%: no clipped primary actions.
- [ ] Color contrast of body text and status text is readable.
- [ ] Dialog focus trap works; Escape closes only the topmost dialog.

## Privacy and permissions

- [ ] DevTools Network tab on the library page shows no third-party requests.
- [ ] Toolbar click on a page does not fetch a favicon URL from the network.
- [ ] `manifest.json` in `dist/` has exactly `activeTab` and `scripting`, no
      `host_permissions`, no `content_scripts`.
- [ ] Data persists after browser restart.
- [ ] Uninstalling/clearing extension data removes the vault (after exporting a
      backup).

## Packaging and publishing

- [ ] ZIP has `manifest.json` at its root, not inside a nested folder.
- [ ] ZIP contains `LICENSE`, icons 16/32/48/128, library, privacy page.
- [ ] ZIP contains no tests, docs, `node_modules`, source maps or `.git`.
- [ ] SHA-256 in the release summary matches `Get-FileHash` /
      `sha256sum`.
- [ ] Store screenshots are current and contain no personal data.
- [ ] Store privacy answers match `docs/PRIVACY.md`.
- [ ] Donation link is either verified and configured, or clearly absent
      (`TODO: ADD DONATION LINK`).
- [ ] GitHub repository, website and store URLs in docs are real before claiming
      a release.

## Result log

Record the browser/version and date for each release candidate:

| Date | Browser | Version | Result | Notes |
| --- | --- | --- | --- | --- |
| 2026-10-23 | Automated (`node --test`) | Node 24 | PASS | 49 tests pass |
| 2026-10-23 | Chrome headless 155 | Windows | PARTIAL | Library loaded from `dist/`, real IndexedDB seed/search passed, no console errors. Toolbar injection not automatable in headless; panel visual captured with mocked messaging. |
|  |  |  |  |  |
