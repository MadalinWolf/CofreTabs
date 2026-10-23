# CofreTabs Privacy Policy

**Effective date:** 2026-10-23
**Publisher:** Mad Wolf Studios
**Website:** <https://madwolfstudios.com/>
**Applies to:** CofreTabs browser extension, version 1.0.x

CofreTabs is a local-only tab vault. It has no backend, no user accounts, no
analytics and no cloud sync. Your vault lives in your browser profile, on your
device.

The same policy is bundled inside the extension at
`src/library/privacy.html` so it remains readable offline.

## 1. What CofreTabs stores

When **you explicitly press `SAVE THIS TAB`**, CofreTabs stores the following in
IndexedDB on your device:

- the page title and the full URL you chose to save;
- the page hostname and the automatically assigned website folder;
- the time the tab was saved and when it was last changed;
- an inline favicon image, only when the browser supplies one as a local
  `data:` image;
- a note, title edit and folder assignment if you change them yourself;
- a trash flag and deletion time if you move the entry to Trash.

The extension also stores the website folders it creates (a folder key and a
display name) and a small local database schema version. It does not store
browsing history, open-tab lists, form data, cookies, clipboard contents or
passwords.

## 2. What CofreTabs does not do

- No account, sign-in, email address or API key is required.
- No analytics, telemetry, crash reporting, advertising or tracking pixels.
- No remote AI or third-party service receives your data.
- No browsing history, cookies, clipboard contents, form data or open tabs are
  read.
- No saved page, title, URL, note, folder or backup is uploaded anywhere by the
  extension.
- No remote scripts, fonts, stylesheets or images are loaded at runtime.
- No saved text is executed as HTML or JavaScript.

## 3. Permissions and why they exist

| Permission | Purpose |
| --- | --- |
| `activeTab` | Lets the extension read the current tab's title and URL **after you click the toolbar icon**. It does not grant continuous access to tabs. |
| `scripting` | Lets the extension inject the slide-over panel into the active tab when you click. |

CofreTabs does **not** request host permissions, `tabs`, `history`, `bookmarks`,
`cookies`, `webRequest`, `downloads`, `clipboardRead`, `clipboardWrite`,
`management`, `nativeMessaging`, `sessions`, `topSites`, `proxy` or
`unlimitedStorage`.

No content script runs automatically on page load. The panel is injected on
demand and is removed from the page when closed (or when the page navigates).

Browser-internal pages (`chrome://`, the Chrome Web Store, PDF viewers and other
restricted surfaces) cannot be injected by any extension. On those pages
CofreTabs opens the library with an explanation. It does not attempt to bypass
the browser's restriction.

## 4. Backups

The export button creates a JSON file locally and hands it to the browser's
normal download flow. CofreTabs does not upload it. Where that file goes — your
Downloads folder, a synced folder, a removable drive — is controlled by you and
your browser/OS.

Import reads a file you choose. Validation happens locally. Nothing is written
until the entire file has passed validation.

Backups can contain URLs, titles and notes. Treat them as personal data. Store
them accordingly and delete old copies you no longer need.

## 5. Favicons and network requests

Saved favicons are kept only when the browser provides them as inline
`data:image/*` values. CofreTabs does not request, fetch or store remote favicon
URLs. If no safe inline icon is available, the interface draws a monogram from
the site name.

The extension makes **no runtime network requests**. Its panel stylesheet is
loaded from the extension package itself (`chrome.runtime.getURL`). The Public
Suffix List is bundled at build time, not downloaded at runtime.

## 6. Website folders and the Public Suffix List

CofreTabs groups saved pages by their registrable domain using a bundled
snapshot of the ICANN section of the Public Suffix List. This is a local
calculation. The hostname is not sent to a lookup service. Private PSL rules are
excluded, so shared hosting domains such as `github.io` are grouped by the
platform rather than by tenant.

## 7. Other software on your computer

CofreTabs runs inside your browser and is subject to the browser's own data
handling. Your browser vendor, operating system, backup software or a
separately installed password manager may process browser profile data under
their own policies. CofreTabs does not control those products and does not send
data to them.

If you install CofreTabs from a store, the store may collect install/update
telemetry independently of the extension. That is governed by the store's
policy, not this one.

## 8. Data control and deletion

- **Trash** hides an entry from the active vault without deleting it.
- **Delete forever** and **Empty Trash** remove entries from IndexedDB.
- **Delete folder** moves its active tabs to Trash; it does not upload or
  archive them elsewhere.
- **Export** creates a copy you control. Export before clearing browser data if
  you want to keep the vault.
- **Uninstall** the extension, or clear its data in the browser's extension
  settings, to remove the local database. Browser behaviour for extension
  storage removal can vary; exporting first is the safe option.

There is no server-side copy to delete because none is ever created.

## 9. Children and sensitive data

CofreTabs is a general-purpose productivity tool, not directed at children. Do
not use it as a password manager, health record store or other sensitive-data
vault. URLs, titles and notes are stored unencrypted in the browser profile;
anyone with access to that profile or your unlocked device may be able to read
them. Use full-disk encryption and OS account security.

## 10. Changes and contact

Material changes to this policy will be documented in `CHANGELOG.md` and, where
practical, in the extension's release notes. The effective date above will be
updated.

Questions or privacy concerns: <https://madwolfstudios.com/>.

---

CofreTabs is open source under the MIT license. The privacy claims above are
intended to be verifiable in the source: search for `fetch(` in `src/` (there is
no remote fetch), inspect `manifest.json` (two permissions, no host
permissions), and read `src/storage/vault.js` (the only database layer).
