# Security Policy

## Supported versions

CofreTabs is pre-publication. The current release candidate is:

| Version | Supported |
| --- | --- |
| 1.0.x | Yes (release candidate) |
| < 1.0 | No |

Once published, security fixes will target the latest minor release.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report privately through the contact form at <https://madwolfstudios.com/>,
including:

- affected version or commit;
- browser and operating system;
- steps to reproduce;
- impact (data exposure, code execution, permission bypass, etc.);
- any proof of concept, kept minimal and free of real personal data.

If a private channel is unavailable, open a minimal public issue asking for a
private contact method — without exploit details.

You can expect an acknowledgement as soon as practical. This is a small studio
project, so please allow reasonable time before public disclosure. Please do not
test against other people's data, and do not run denial-of-service or
destructive tests.

## Scope

In scope:

- extension code in this repository (`src/`, `manifest.json`, build scripts);
- bypasses of the local-only/privacy model;
- injection or XSS through saved titles, URLs, notes, folder names or imported
  backups;
- unintended network requests;
- permission or CSP weaknesses;
- backup import validation bypasses;
- data loss bugs in save/restore/delete/import flows.

Out of scope:

- vulnerabilities in Chromium, the browser or the operating system;
- attacks requiring a compromised browser profile or local malware;
- social engineering;
- missing features that are documented limitations;
- reports based only on automated scanner output without a demonstrated impact.

## Security design notes

- The extension requests only `activeTab` and `scripting`. There are no host
  permissions and no always-on content scripts.
- The panel is injected only after a toolbar click. The service worker validates
  that the sender tab URL matches the requested save URL and rejects stale saves.
- All page-derived and imported strings are treated as untrusted. UI code uses
  `textContent`/DOM creation, never `innerHTML`.
- The build fails on `eval`, `new Function`, `document.write`, `innerHTML =`,
  remote `fetch`, `chrome.storage` and out-of-scope Chrome APIs.
- Backups are validated in full before any write. Unknown newer schema versions
  are refused.
- Favicons are stored only when they are inline `data:image/*` values, and only
  those values are rendered.
- No telemetry, accounts, remote config or third-party scripts exist.

## Dependency policy

There are no runtime dependencies. Development-only dependencies (`jsdom`,
`fake-indexeddb`) are not shipped in the extension ZIP. The build and packaging
scripts use only Node's standard library.
