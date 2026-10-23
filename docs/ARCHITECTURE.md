# Architecture

CofreTabs deliberately has no bundler and no runtime dependencies. The extension
is plain HTML, CSS and ES modules; `dist/` is a validated copy of the runtime
files. This keeps the shipped artifact auditable and the permission model small.

## Runtime components

```text
┌─────────────────────────────┐
│ Browser toolbar click       │
└──────────────┬──────────────┘
               │ chrome.action.onClicked
┌──────────────▼──────────────┐
│ Service worker              │
│ src/background/             │
│  • ping/close existing panel│
│  • inject panel on demand   │
│  • restricted-page fallback │
│  • message router           │
│  • badge refresh            │
└──────┬───────────────┬──────┘
       │               │
       │ messages      │ opens
┌──────▼──────────┐  ┌─▼────────────────────┐
│ Panel           │  │ Library page         │
│ injected classic│  │ extension page       │
│ script + Shadow │  │ library.html/js      │
│ DOM             │  │ dialogs/import/export│
└──────┬──────────┘  └─┬────────────────────┘
       │               │
       └───────┬───────┘
        chrome.runtime messages
               │
┌──────────────▼──────────────┐
│ Vault (IndexedDB)           │
│ src/storage/vault.js        │
│ tabs / folders / meta       │
└─────────────────────────────┘
```

The service worker owns the canonical IndexedDB connection. The library page can
also open the same database directly (same origin), while the content-script
panel always goes through the service worker. IndexedDB is the source of truth;
the worker keeps no authoritative state in memory, so suspension is harmless.

### Why a classic content script?

`chrome.scripting.executeScript({ files })` injects a classic script. It cannot
use ES module `import`. The panel is therefore a single self-contained file. The
message names it uses are duplicated from `src/lib/messages.js`; keep both sides
in sync. Its styles are fetched from the packaged `src/styles/panel.css` (a
`web_accessible_resource`) and placed in a Shadow DOM root so page CSS cannot
affect the panel and the panel cannot leak styles into the page.

### Why no declared content script?

A declared content script would run on every page load and would require host
permissions (or broad `matches`). That conflicts with the privacy model. The
panel is injected only after an explicit toolbar click, using `activeTab`.

## Data model (IndexedDB schema v1)

Database: `cofretabs`.

### `tabs` store

| Field | Notes |
| --- | --- |
| `id` | UUID-ish string generated locally. |
| `title` | Sanitized plain text, max 300 chars. |
| `url` | Normalized absolute `http(s)` URL, max 8,000 chars. |
| `urlKey` | Indexed normalized URL used for duplicate lookup. |
| `hostname` | Original hostname (lowercased ASCII form), preserved separately from the folder. |
| `folderId` | Current folder id, or `''`. |
| `folderName` | Denormalized display name for resilience. |
| `faviconUrl` | Inline `data:image/*` only, or `''`. |
| `note` | Sanitized plain text, max 4,000 chars. |
| `createdAt` / `updatedAt` | Epoch milliseconds. |
| `deletedAt` | `null` for active, epoch ms for Trash. |

Indexes: `urlKey`, `createdAt`, `folderId`, `deletedAt`.

### `folders` store

| Field | Notes |
| --- | --- |
| `id` | Local id. |
| `key` | Registrable domain / IP / grouping key. |
| `name` | Display name, max 80 chars. |
| `createdAt` / `updatedAt` | Epoch milliseconds. |

Index: `key`.

### `meta` store

Holds the schema version (`schemaVersion`). `init()` creates stores/indexes if
needed and writes the version. There is no destructive migration path yet
because v1 is the first schema.

## URL and folder classification

1. `parsePageUrl()` accepts only `http:`/`https:` and rejects restricted browser
   surfaces.
2. `normalizePageUrl()` canonicalizes the URL, strips default ports, preserves
   the query and fragment, and caps length.
3. `classifyUrl()` derives the hostname and display host, then
   `getRegistrableDomain()` applies the bundled ICANN PSL (longest matching
   rule, wildcard and exception support).
4. `folderNameFromDomain()` produces a readable folder name (e.g.
   `news.bbc.co.uk` → BBC; `192.0.2.1` → `192.0.2.1`; IDNs use their Unicode
   form when safe).
5. A folder is looked up by key and created if absent. The original `hostname`
   is stored on the tab, so grouping never rewrites the page's identity.

Private PSL rules are excluded on purpose: shared platforms such as `github.io`
or `vercel.app` group under the platform. This is documented behaviour.

Duplicate policy: active entries are deduplicated by normalized full URL
(including fragment). Trashed entries do not block a fresh save. Import dedupes
active and trashed entries separately.

## Save flow

```text
toolbar click
  → ping panel; if open, close
  → executeScript(panel.js)
  → panel sends PANEL_INIT
  → worker reads sender tab, validates URL, classifies, checks duplicate
  → panel renders preview (no write)
  → user clicks SAVE THIS TAB
  → panel disables button, starts progress
  → worker validates sender URL == requested URL (reject STALE_PAGE)
  → worker in-flight lock per URL
  → vault.saveTab() → IndexedDB transaction
  → worker refreshes badge
  → response returns only after DB confirmation
  → panel shows success / duplicate / failure truthfully
```

Reduced motion removes the minimum decorative delay; the database promise is
still awaited.

## Library behaviour

- All queries go through `Vault`: `listTabs`, `search`, `getFolderSummaries`,
  `getStats`, `getPanelSnapshot`.
- Editing uses `updateTab` with sanitization.
- Folder deletion moves active tabs to Trash, clears `folderId`, and removes the
  folder record.
- Restore from Trash checks whether the original folder still exists; if not,
  the tab is re-filed by URL classification.
- Import validates the complete backup before opening a write transaction, then
  applies merge or replace. Merge dedupes by URL separately for active and
  trashed records.

## Security boundaries

- Page data and imported files are untrusted. Sanitizers (`src/lib/sanitize.js`)
  trim, cap length and normalize strings; UI uses DOM text nodes.
- Favicons are accepted only as `data:image/*`.
- `safeHttpUrlForOpening()` re-validates URLs before `chrome.tabs.create`.
- Messages are accepted only from the extension's own runtime id.
- The service worker logs error codes, never URLs/titles/notes.
- `scripts/build.mjs` enforces the no-remote/no-eval/no-innerHTML invariants.

## Build and release

`scripts/build.mjs`:

1. validates required files, manifest, versions, permissions, icons, CSP;
2. copies `src/`, `assets/`, `manifest.json`, `README.md`, `LICENSE` to `dist/`;
3. validates module imports, HTML references, and forbidden patterns;
4. writes `BUILD-INFO.json`.

`scripts/package.mjs` builds into `dist/`, collects files, writes a ZIP with the
zero-dependency `scripts/lib/zip.mjs`, reads it back to verify required entries,
and writes a JSON summary plus SHA-256. ZIP entries are stored with forward
slashes and `manifest.json` at the root.

## Testing strategy

- Pure logic: `node:test` + `assert`.
- Storage: real `Vault` against `fake-indexeddb`.
- Panel: real `panel.js` executed in jsdom with a mocked `chrome` API and a
  Shadow DOM container.
- Release: build/package into throwaway directories, verify ZIP entries and
  checksum.
- Manual browser pass: real injection, visual layout, downloads, quota
  behaviour — see `docs/QA-CHECKLIST.md`.
