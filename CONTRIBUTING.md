# Contributing to CofreTabs

Thanks for taking the time to improve CofreTabs. This is a small, privacy-first
project, so the review bar is mostly about **not breaking local-only guarantees**
and **being kind to the next reader**.

## Before you start

- Read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- For security issues, follow [`SECURITY.md`](SECURITY.md) and do not open a
  public issue.
- For large features, open an issue first so the design can be agreed on.
- Search existing issues/PRs before starting duplicate work.

## Development setup

Requirements: Node.js 20+ and npm. A Chromium browser is needed for manual
injection/UI checks.

```sh
npm.cmd install        # Windows PowerShell
# or: npm install
npm.cmd test
npm.cmd run build
```

On Windows, the `npm` shim can be blocked by execution policy. Use `npm.cmd`, or
run the underlying command directly, e.g. `node --test`.

### Useful commands

| Command | Purpose |
| --- | --- |
| `node --test` | All unit and jsdom UI tests. |
| `node --test --test-reporter=spec` | Verbose test output. |
| `node scripts/build.mjs` | Validate and copy runtime into `dist/`. |
| `node scripts/package.mjs` | Build and write a verified release ZIP. |
| `node scripts/generate-icons.mjs` | Regenerate PNG icons. |
| `node scripts/build-psl.mjs` | Refresh the bundled PSL snapshot. |

## What to change, and what not to

Please keep these invariants:

1. **No automatic saving.** A tab may only be written after an explicit user
   action. Do not add "save on install", "save on click", or navigation-triggered
   writes.
2. **No network at runtime.** No remote scripts, fonts, stylesheets, images,
   analytics or fetch calls from extension pages. If a feature seems to need a
   server, it needs a design discussion first.
3. **No new permissions without a strong reason.** The shipped permission list is
   `activeTab` + `scripting`. `tabs`, `history`, `bookmarks`, `cookies`,
   `webRequest`, `downloads`, `clipboard*` and host permissions are rejected by
   the build validator for a reason.
4. **No `innerHTML` / `eval` / `new Function`.** Build saved text with
   `textContent` and DOM APIs. Imported backups and page titles are untrusted.
5. **Truthful save state.** Success is displayed only after IndexedDB confirms
   the write. Do not replace the real promise with a timer.
6. **Local data stays local.** Do not add telemetry, remote favicon fetching or
   cloud sync.
7. **Accessibility is part of done.** Keep keyboard navigation, focus handling,
   labels and live-region announcements intact. Respect reduced motion.

The build script fails on several of these automatically. Passing the build is a
floor, not a substitute for thinking about them.

## Coding style

- Vanilla ES modules, no runtime dependencies.
- Prefer small pure functions in `src/lib/` and keep I/O in
  `src/storage/vault.js` or the service worker.
- Use `const`/`let`, early returns, and descriptive names.
- Keep user-facing strings plain and honest. Say "could not save" when a save
  failed; do not use cheerful euphemisms.
- No emoji-only UI controls; use text or an accessible label.
- Follow the existing visual language (phosphor green / near-black, monospace,
  square corners, thin borders).
- Keep the panel script self-contained: it is injected as a classic script and
  cannot use `import`.

## Tests

Add or update tests for behaviour changes:

- domain/URL/PSL changes → `tests/domain.test.mjs`
- storage, folders, trash, import/export → `tests/storage.test.mjs`
- backup schema and validation → `tests/backup.test.mjs`
- panel UI/flow → `tests/panel-ui.test.mjs`
- manifest/build/release invariants → `tests/manifest.test.mjs`

Run the full suite and the build before opening a PR:

```sh
node --test
node scripts/build.mjs
node scripts/package.mjs
```

Manual browser checks are listed in [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md).
If your change affects injection, downloads or layout, say which checks you ran
and on which browser/version.

## Commit messages

Short imperative subject, then a body explaining *why* when it is not obvious.
Examples:

```text
Reject stale saves after navigation

The panel could save the previous URL if the tab navigated while open.
Compare the sender tab URL with the requested URL and return STALE_PAGE.
```

## Pull requests

Include:

- what changed and why;
- user-visible impact;
- test commands and results;
- manual browser checks if applicable;
- screenshots for visual changes (no personal browsing data visible);
- confirmation that no new permissions, network calls or auto-save paths were
  introduced.

Keep PRs focused. Refactors unrelated to the fix make review harder.

## Documentation

If you change the backup format, update [`docs/BACKUP-FORMAT.md`](docs/BACKUP-FORMAT.md),
the schema version, and the backup tests. If you change the permission model,
update the README table, [`docs/PRIVACY.md`](docs/PRIVACY.md) and
`src/library/privacy.html`.

## License

By contributing, you agree that your contribution is licensed under the
project's MIT license (see [`LICENSE`](LICENSE)).
