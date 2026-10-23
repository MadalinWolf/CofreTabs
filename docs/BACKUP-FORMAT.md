# Backup format (schema v1)

CofreTabs exports plain UTF-8 JSON. The file is created locally by the library
page and downloaded through the browser; nothing is uploaded.

```json
{
  "format": "cofretabs-backup",
  "schemaVersion": 1,
  "app": {
    "name": "CofreTabs",
    "version": "1.0.0",
    "studio": "Mad Wolf Studios"
  },
  "exportedAt": "2026-10-23T12:00:00.000Z",
  "counts": {
    "tabs": 2,
    "active": 1,
    "trashed": 1,
    "folders": 1
  },
  "folders": [
    {
      "id": "folder_example",
      "key": "github.com",
      "name": "GitHub",
      "createdAt": 1761000000000,
      "updatedAt": 1761000000000
    }
  ],
  "tabs": [
    {
      "id": "tab_example",
      "title": "CofreTabs",
      "url": "https://github.com/MadalinWolf/CofreTabs",
      "hostname": "github.com",
      "folderId": "folder_example",
      "folderName": "GitHub",
      "faviconUrl": "",
      "note": "",
      "createdAt": 1761000000000,
      "updatedAt": 1761000000000,
      "deletedAt": null
    }
  ]
}
```

## Top-level fields

| Field | Required | Notes |
| --- | --- | --- |
| `format` | Recommended | If present, must be exactly `cofretabs-backup`. A missing value is tolerated for hand-written files. |
| `schemaVersion` | **Yes** | Positive integer. v1 is the only supported version. Newer versions are rejected with an upgrade message. |
| `app` | No | Informational only; ignored on import. |
| `exportedAt` | No | Informational ISO string; stored in import metadata only. |
| `counts` | No | Informational; recomputed on import. |
| `folders` | No | Array, defaults to `[]`. Maximum 10,000. |
| `tabs` | **Yes** | Array. Maximum 100,000. |

The whole file is limited to 80 MiB of text.

## Folder fields

| Field | Required | Behaviour |
| --- | --- | --- |
| `id` | No | Sanitized. Missing/duplicate ids are regenerated. Mapped to a local id on import. |
| `key` | No | Normalized hostname / grouping key. Falls back to `id` when absent. |
| `name` | **Yes** | Sanitized plain text, max 80 chars. Blank names are rejected. |
| `createdAt` | No | Epoch ms; invalid values fall back to import time. |
| `updatedAt` | No | Epoch ms; falls back to `createdAt`. |

If a folder with the same `key` already exists in merge mode, the imported tabs
are attached to the existing folder. Duplicate display names are disambiguated.

## Tab fields

| Field | Required | Behaviour |
| --- | --- | --- |
| `id` | No | Sanitized. Missing/duplicate ids are regenerated (import never overwrites by id). |
| `url` | **Yes** | Must normalize to an absolute `http(s)` URL, max 8,000 chars. Anything else rejects the entire import. |
| `title` | No | Sanitized, max 300 chars. Falls back to hostname or URL. |
| `hostname` | No | Used as a fallback when classification fails; otherwise derived from the URL. |
| `folderId` | No | Mapped through the imported folder map when possible. |
| `folderName` | No | Used when no folder is mapped, otherwise the folder is created or looked up by domain. |
| `faviconUrl` | No | Only inline `data:image/*` values survive; everything else becomes `""`. |
| `note` | No | Sanitized plain text, max 4,000 chars. |
| `createdAt` / `updatedAt` | No | Epoch ms; invalid values fall back to import time. |
| `deletedAt` | No | `null`/missing = active. Valid epoch ms = Trash. |

## Validation

- Invalid JSON, a non-object root, a missing `tabs` array or a non-array
  `folders` field rejects the import.
- `schemaVersion` must be an integer ≥ 1. A version greater than 1 is rejected
  with `INCOMPATIBLE_SCHEMA`.
- A single invalid tab URL rejects the entire file (`INVALID_TAB_URL`). There is
  no partial import.
- Over-limit tab/folder counts or file size are rejected before writing.
- Validation runs before the IndexedDB write transaction; a rejected file
  changes nothing.

## Merge mode

Merge keeps existing data and adds imported records:

- Active duplicates are skipped when the normalized URL already exists as an
  **active** entry.
- Trashed duplicates are skipped only against existing **trashed** entries.
  A trashed import does not block an active entry with the same URL, and vice
  versa.
- Within the imported file itself, duplicates are still inserted; the vault's
  normal duplicate policy applies to future saves. (The UI reports imported and
  skipped counts for records skipped against the pre-existing vault.)
- Imported folder ids are remapped. Folder records are matched by `key`.
- Imported tabs always receive fresh local ids.

## Replace mode

Replace deletes all existing tabs and folders first, then imports the file. The
`removedExisting` count reports how many tab records were removed. Trash is
included in the export and therefore restored by a replace import.

## Restore behaviour

A tab exported from Trash returns to Trash (`deletedAt` preserved). Restoring it
later checks whether its original folder still exists. If not, CofreTabs files
it by its URL's registrable domain.

## Compatibility policy

- Additive fields may be added within schema v1; importers ignore unknown fields.
- Breaking shape changes require schema v2 and a migration path. v1 importers
  must refuse newer versions rather than guess.
- The app version is informational and does not gate import.

## Privacy reminder

Backups contain URLs, titles and notes and are **not encrypted**. Store them
accordingly. CofreTabs never uploads them.
