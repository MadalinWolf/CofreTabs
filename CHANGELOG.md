# Changelog

All notable changes to CofreTabs are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No changes yet.

## [1.1.0] — 25 October 2026

### Added

- **Favorites**: a built-in, virtual Favorites collection with a heart toggle on
  every saved tab (library and panel). Favoriting is non-destructive — the tab
  keeps its folder — and is persisted, de-duplicated and counted in stats.
- **Custom folders**: create, rename and delete your own folders from the
  library. Deleting a folder is safe: its active tabs move to Trash (restorable)
  instead of being destroyed. Favorites cannot be deleted.
- **Move tabs between folders**: an inline MOVE folder-selector on each row
  re-files a saved tab immediately, preserving title, URL, favicon and notes.
- **Light and dark themes**: a theme selector in the library sidebar. The choice
  is persisted (localStorage + vault meta), restored on launch, applied to both
  the library and the injected panel, and defaults to the system preference when
  unset. No wrong-theme flash.
- **Folder grid redesign (panel)**: the folder popup is now a compact 3×3 grid
  showing up to 9 folders with icons, names, counts, hover and active states.
  Folders get stable personalities: site SVGs, a heart for Favorites and a
  deterministic playful ASCII glyph for custom folders.
- **Folder grid pagination**: with more than 9 folders, accessible up/down
  controls step one row (3 folders) at a time, clamped to the final page, with a
  live position readout and a stable partial last page.
- **Outside-click close**: clicking anywhere outside the panel closes it;
  inside clicks, folders, URLs and navigation keep working. Escape also closes,
  listeners are removed on close, and focus is restored.
- **Update notifications**: the library checks the official GitHub releases feed
  (at most once every 12 hours) and shows a dismissible banner when a newer
  version exists. Offline, rate-limit and malformed responses are silent no-ops;
  installing stays a manual, user-approved step on the release page.

### Changed

- Branding text now reads **MADWOLFSTUDIOS** (was "MAD WOLF STUDIOS") in the
  library footer and privacy page.
- The GitHub profile link was removed from the fullscreen library interface.
- Backup format (still schema 1) now round-trips the `favorite` flag and folder
  `type` (`site` / `custom`); older backups import cleanly with defaults.

### Security

- Favorites and folder moves reuse the existing sanitised write paths; no new
  permissions, no network writes, and the update check contacts only the public
  GitHub releases endpoint with no vault data.

## [1.0.0] — 25 October 2026

### Added

- Manifest V3 extension with a toolbar-triggered, right-side slide-over panel.
- Explicit `SAVE THIS TAB` flow with real IndexedDB progress, duplicate
  detection, in-flight locking and truthful success/failure states.
- Local IndexedDB vault (schema v1) for tabs, folders, notes and Trash.
- Automatic website folders using a bundled ICANN Public Suffix List snapshot
  (6,949 rules); `www`, subdomains, ccTLDs, IP literals and malformed URLs are
  handled.
- Library page with search across title/URL/host/folder/note, sorting, folder
  filters, Trash view, manual URL add, title/note editing and folder moves.
- Folder rename and safe deletion (tabs move to Trash; permanent deletion is
  Trash-only and confirmed).
- Restore from Trash with URL-based re-filing when the original folder is gone.
- Versioned JSON export/import (`cofretabs-backup`, schema 1) with full-file
  validation, merge and replace modes, and duplicate counts.
- Bundled offline privacy policy at `src/library/privacy.html`.
- Retro terminal UI scoped in Shadow DOM for the panel, reduced-motion support,
  live-region announcements and keyboard/focus handling.
- Pixel-art PNG icons (16/32/48/128/512), SVG logo and favicon.
- Dependency-free build, ZIP packager, PSL generator and icon generator.
- Unit/DOM test suites for domain logic, storage, backups, panel behaviour,
  manifest and release packaging.
- MIT license, README, contributing guide, code of conduct, security policy,
  QA checklist, store copy, architecture and third-party notices.
- Static landing-page package in `website/` (not deployed).

### Security

- Permissions limited to `activeTab` and `scripting`; no host permissions.
- No remote code, fonts, styles or favicon requests at runtime.
- Untrusted saved text rendered via DOM text nodes; no `innerHTML`, `eval` or
  `new Function`.
- Only inline `data:image/*` favicons are persisted.
- Build validator rejects forbidden permissions, remote resources, inline
  scripts/handlers and dangerous runtime patterns.

### Known limitations

- Restricted Chromium pages cannot be injected; the library opens instead.
- No sync between devices; backups are manual.
- Only `http(s)` pages can be saved.
- Not published to GitHub or the Chrome Web Store; website not deployed.
- Donation URL not configured (`TODO: ADD DONATION LINK`).

[Unreleased]: https://github.com/MadalinWolf/CofreTabs/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/MadalinWolf/CofreTabs/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/MadalinWolf/CofreTabs/releases/tag/v1.0.0
