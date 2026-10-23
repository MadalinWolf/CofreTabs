# CofreTabs v1.0.0 — Release Notes

**Release date:** Unreleased (local release candidate)
**Channel:** First release candidate, not yet published to the Chrome Web Store
**Manifest version:** 3
**Minimum Chromium version:** 102

CofreTabs is a local-only tab vault with a retro terminal interface. Nothing is
saved until you press **SAVE THIS TAB**.

## Highlights

- Slide-over panel injected only when you click the toolbar icon.
- Truthful save flow: progress starts with the IndexedDB write, success appears
  only after the database confirms it, and errors remain errors.
- Automatic folders based on the registrable domain using a bundled ICANN
  Public Suffix List snapshot (6,949 rules).
- Search across title, URL, hostname, folder and notes; sort and filter.
- Editable titles/notes, folder moves, folder rename and safe folder deletion.
- Trash with restore and confirmed permanent deletion.
- Versioned JSON backup with merge/replace import and strict validation.
- Manual URL add for pages where injection is unavailable.
- Local-only privacy model: no accounts, no backend, no analytics, no remote
  favicon requests, no host permissions.
- Permissions limited to `activeTab` and `scripting`.
- Keyboard-accessible dialogs, live-region announcements and reduced-motion
  support.

## Fixes and hardenings in this release candidate

- Duplicate detection uses the normalized full URL; trashed entries do not block
  a fresh save.
- Double-clicks and overlapping saves are rejected by an in-flight lock in both
  the panel and service worker.
- Page navigation while the panel is open invalidates the save with a clear
  `STALE_PAGE` message.
- Imported HTML/text is treated as untrusted: titles, notes, folder names and
  URLs are normalized and rendered with DOM text nodes, never `innerHTML`.
- Favicons are persisted only when they are inline `data:image/*` payloads.
- Library focus trapping/restoration and Escape handling for dialogs.
- Badge count includes active entries only and caps at `999+`.

## Known limitations

- Chromium-internal pages (`chrome://`, the Chrome Web Store, PDF viewers and
  similar restricted surfaces) cannot be injected. CofreTabs opens the library
  with an explanation and optional manual add instead.
- No cross-device sync. Backups are manual JSON files.
- Only `http(s)` pages can be saved.
- The Public Suffix List snapshot is bundled at build time; refresh it with
  `npm run psl`.
- Automated tests cover domain/storage/backup logic and the panel in jsdom. A
  real-browser manual pass remains required before store submission; see
  `docs/QA-CHECKLIST.md`.
- Store publication, GitHub publication and website deployment are owner
  actions and were not performed.
- Donation URL is not configured (`TODO: ADD DONATION LINK`).

## Install this release candidate

```sh
npm.cmd install
npm.cmd run build
```

Then load `dist/` via the browser's **Load unpacked** developer flow. See the
README for details.

## Verification

```sh
node --test
node scripts/package.mjs
```

The packaged ZIP is written to `release/` together with a JSON manifest
containing its SHA-256. Published checksums will be added only when a real
release is hosted publicly.

## License

MIT © 2026 Mad Wolf Studios.
