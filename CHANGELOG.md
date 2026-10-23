# Changelog

All notable changes to CofreTabs are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No changes yet.

## [1.0.0] — Unreleased release candidate

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

[Unreleased]: https://github.com/MadalinWolf/CofreTabs/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/MadalinWolf/CofreTabs/releases/tag/v1.0.0
