# Chrome Web Store listing copy

Draft copy for review. Do not publish until the extension has passed the QA
checklist and the owner has confirmed every URL.

## Name

CofreTabs

## Short description (132-character limit)

> Your tabs. Your vault. Your device. Save, search and restore tabs in a local-only retro vault. No accounts, no cloud.

Count: 121 characters.

## Detailed description

```text
YOUR TABS. YOUR VAULT. YOUR DEVICE.

CofreTabs is a private, local-only tab vault with a retro terminal soul.
Save the page you are reading with one explicit click, then find it again
months later. No account. No sync. No cloud. No analytics.

WHY COFRETABS
• Save only when you say so. Click the toolbar icon, review the page, press
  SAVE THIS TAB. Nothing is captured automatically.
• Automatic website folders. Pages are grouped by their real domain using the
  Public Suffix List, so news.bbc.co.uk files under BBC, not co.uk.
• Search everything. Find saved pages by title, URL, hostname, folder or note.
• A library that scales. Sort, filter, edit notes and titles, move tabs between
  folders and clean up without losing anything.
• Trash with a way back. Restore a tab, or delete permanently only from Trash
  with confirmation.
• Portable backups. Export a versioned JSON file, or import one in merge or
  replace mode. Your data stays a file you own.
• Honest feedback. The progress animation is tied to the real local database
  write. Success means saved; failure means not saved.
• Retro, not retrograde. Keyboard-friendly dialogs, screen-reader
  announcements, reduced-motion support and readable contrast.

PRIVATE BY CONSTRUCTION
• Vault stored in IndexedDB on your device.
• No accounts, servers, telemetry, ads or third-party scripts.
• No remote favicon requests.
• No host permissions. Two permissions: activeTab and scripting, used only
  after you click the toolbar icon.
• Open source under the MIT license.

GOOD TO KNOW
• Chromium browsers only (Chrome 102+, Edge, Brave, Vivaldi, Opera).
• Only http(s) pages can be saved. Browser-internal pages open the library
  with an explanation instead.
• No cross-device sync; use JSON export/import to move a vault.
• Backups are not encrypted. Store them like any other personal file.

CofreTabs by Mad Wolf Studios.
Your tabs. Your vault. Your device.
```

## Category

Productivity → Tools

## Search terms / keywords (natural, no spam)

tab manager, tab vault, save tabs, read later, local-only, privacy, bookmark
alternative, tab organizer, offline, retro terminal

## Permission justification (short form)

- `activeTab` — Reads the current tab's title and URL only after the user clicks
  the toolbar icon, to preview the page before saving.
- `scripting` — Injects the save panel into the active tab after that click.
  Nothing runs automatically.

## Support / homepage copy

Homepage: <https://madwolfstudios.com/>
Support: <https://madwolfstudios.com/> (replace with the public GitHub issues URL
once the repository is published)

## Screenshot captions

1. **Review before you save.** Title, host, automatic folder and duplicate
   status — nothing is written until you press the button.
2. **Saved, for real.** Success appears only after the local database confirms
   the write.
3. **Your vault, searchable.** Search titles, URLs, hosts, folders and notes.
4. **Trash is not a black hole.** Restore entries or delete them permanently
   with confirmation.
5. **Own your backup.** Versioned JSON export and validated merge/replace
   import.

## Promo tile copy (440×280)

```text
COFRETABS
Your tabs. Your vault. Your device.
Local-only tab vault. No cloud.
```

## What's new (first release)

```text
First release candidate.
• Explicit one-click tab saving with truthful progress
• Automatic folders from the Public Suffix List
• Search, folders, notes, sort and Trash
• Versioned JSON backup with merge/replace import
• Local-only, no accounts, no analytics
```

## Claims to avoid

Do not use any of these until they are true:

- "Available on the Chrome Web Store" (not submitted)
- "Download now" / release download links (nothing hosted)
- "Syncs across devices" (it does not)
- "Encrypted vault" (it is not encrypted)
- "Blocks trackers" (it is a vault, not a blocker)
- "Works in Firefox/Safari" (not tested/supported)
- Any donation URL (still `TODO: ADD DONATION LINK`)
