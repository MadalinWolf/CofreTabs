# CofreTabs v1.1.0 — Release Notes

**Release date:** 2026-10-25
**Package:** `CofreTabs-v1.1.0.zip` → `CofreTabs-v1.1.0/` (load unpacked)
**Manifest:** v3, Chrome 102+, local-only. No build step, no server, no accounts.

This release completes the roadmap announced with v1.0.0: folder navigation and
management, Favorites, appearance, and an in-app update notice — with the core
local-only, privacy-first architecture unchanged.

## Highlights

### Favorite tabs

- Toggle a heart on any tab (library list, library card, or panel expanded view).
- Favorites appear in a virtual **Favorites** collection in the panel folder list
  and in the library — moving, renaming, or deleting folders never touches it.
- Non-destructive by design: favoriting only sets a `favorite` flag on the tab
  record; the bookmark is never duplicated.

### Folder management

- Create new folders from a **+** button in the library sidebar.
- Rename and delete folders from the sidebar row menu.
- Deleting a folder moves its tabs to Trash (recoverable) — never a data loss.
- The built-in Favorites folder cannot be renamed or deleted.

### Move tabs between folders

- From the library list and library cards: a **Move to…** menu on each tab.
- From the panel: a **Move to…** action on each expanded tab.
- Moving preserves the original page title and favicon.

### Folder navigation in the panel

- 3×3 paginated folder grid (9 folders per page, one-row paging, clamped final page).
- **Up** button navigates back from folders-in-folders; **ESC** closes the panel.
- Clicking outside the panel closes it; clicks inside (folders, links, nav) do not.

### Light / dark theme

- System-aware default (respects OS preference), plus an explicit **Light** /
  **Dark** option in library settings.
- Applied consistently across the panel and the library.

### Update notice

- CofreTabs checks the GitHub Releases feed for a newer version (at most once
  every 12 hours, with an 8-second timeout).
- A dismissible banner links to the release page — **nothing is downloaded or
  installed automatically**.

### Backup / restore

- Backups now round-trip Favorites and folder names (`favorite` flag and folder
  `type` are stored additively; existing v1 backups restore unchanged).
- Backup filename is generated from the manifest version.

## Branding & documentation

- MADWOLFSTUDIOS branding across the library, library footer, and privacy page.
- The GitHub profile link was removed from the library footer (it remains on the
  privacy page as the functional issue-tracker contact).
- README, CHANGELOG, and privacy documentation updated for all new features.

## Upgrade instructions (unpacked extension)

1. Create a backup from the library (**Backup / Restore** → *Create backup*) or
   confirm you have a recent one.
2. Download `CofreTabs-v1.1.0.zip` from this release and extract it, **or** pull
   the `v1.1.0` tag in your local clone and run `node scripts/build.mjs`.
3. In `chrome://extensions`, remove (or update the path of) the old CofreTabs
   entry and **Load unpacked** the extracted/built `CofreTabs-v1.1.0` folder.
4. In `chrome://extensions`, load the extracted/built `CofreTabs-v1.1.0` folder
   with **Load unpacked**. Your vault already lives in local storage — all tabs,
   folders, Trash, favorites and settings are there; nothing else to restore.
5. Optional: **Restore** a backup file if you prefer a file-based restore.

## Verification

- `node --test` — 98/98 tests passing (storage, vault, backup, panel UI,
  library UI, update flow, plus new suites for favorites, custom folders,
  folder grid, theme, and update checks).
- `node scripts/build.mjs` — dist build succeeds and passes the built-folder
  smoke test (manifest parses, every referenced script/style exists, no `.bak`
  or backup files).
- `node scripts/package.mjs` — reproducible zip built and recorded in
  `release/CofreTabs-v1.1.0.json` with its SHA-256 checksum.

## Notes

- Known limitations still apply: restricted Chromium pages (`chrome://`, the
  Web Store, PDF viewers) cannot be injected — the library opens instead; no
  cross-device sync (backups are manual JSON files); only `http(s)` pages can
  be saved.
- This release does not change the local-only data model: the vault is stored
  unencrypted in IndexedDB inside your browser profile — there is no password,
  encryption layer, account or server component.

**SHA-256:** GitHub displays the ZIP's SHA-256 digest on this release page; the
same hash is recorded in `release/CofreTabs-v1.1.0.json`, generated at
packaging time.
