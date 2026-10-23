# Third-party notices

CofreTabs ships no runtime dependencies and no third-party JavaScript libraries.
The extension ZIP contains only project code, project artwork and the data file
described below.

## Public Suffix List (PSL)

- **Used for:** deriving registrable domains for automatic website folders.
- **Bundled as:** `src/lib/psl-data.js` (ICANN section only; 6,949 rules at the
  recorded snapshot).
- **Source:** <https://publicsuffix.org/list/public_suffix_list.dat>
- **Project:** <https://github.com/publicsuffix/list>
- **License:** Mozilla Public License 2.0 (MPL 2.0),
  <https://mozilla.org/MPL/2.0/>.
- **Modifications:** the list is reduced to the ICANN section, normalized to
  ASCII, sorted, de-duplicated and serialized as a JavaScript string by
  `scripts/build-psl.mjs`. Private-domain rules are intentionally excluded.
- **Snapshot date:** recorded in the header of `src/lib/psl-data.js`.

The PSL data file remains available under MPL 2.0. The rest of CofreTabs is
licensed under MIT; the MPL applies to the PSL-derived data file, not to the
project as a whole.

Regenerate with:

```sh
node scripts/build-psl.mjs
# or from an offline copy:
node scripts/build-psl.mjs --source path/to/public_suffix_list.dat
```

## Development-only dependencies

These are **not** included in `dist/` or the release ZIP:

| Package | Purpose | License |
| --- | --- | --- |
| `jsdom` | DOM environment for panel UI tests | MIT |
| `fake-indexeddb` | In-memory IndexedDB for storage tests | Apache-2.0 |

Their transitive dependencies are installed via npm for development only and
are excluded by the build and packaging scripts.

## Fonts and visual assets

CofreTabs uses a CSS monospace font stack provided by the operating system. It
does not bundle or download a webfont. Icons, logo and favicon were created for
this project and are covered by the project's MIT license.

## Trademarks

Chrome, Chromium, Edge, Brave, Firefox and other browser names are trademarks of
their respective owners. CofreTabs is not affiliated with or endorsed by any
browser vendor. The Chrome Web Store name is used descriptively.

## Contributor Covenant

`CODE_OF_CONDUCT.md` is adapted from Contributor Covenant 2.1, licensed under
CC BY 4.0. See the attribution section in that file.
