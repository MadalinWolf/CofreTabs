// setup.mjs — prepares the trailer recording build of CofreTabs.
//
// 1. Copies the released v1.1.0 extension to C:\Users\dinum\Extensions\CofreTabs-TRAILER
// 2. Patches ONLY the copy (never the repo / release folder):
//    - manifest: adds a keyboard command (Ctrl+Shift+P) + host_permissions so
//      the panel can be opened deterministically during recording. The real
//      product opens it from the toolbar icon; the command runs the exact same
//      toggleOrInjectPanel() code path.
//    - service worker: one listener that forwards the command to that function.
// 3. Drops the throwaway seed page (seed.html + seed.js) used once to populate
//    realistic demo data through the real Vault API. MV3 CSP forbids inline
//    scripts on extension pages, hence the external seed.js.
//
// NOTE: modern Chrome assigns unpacked extensions a random ID per profile
// install (path-derived IDs are gone), so the extension is loaded once via
// chrome://extensions "Load unpacked" into the recording profile.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const SRC = 'C:\\Users\\dinum\\Extensions\\CofreTabs-v1.1.0'
const DST = 'C:\\Users\\dinum\\Extensions\\CofreTabs-TRAILER'

if (!existsSync(SRC + '\\manifest.json')) throw new Error('source extension not found: ' + SRC)
rmSync(DST, { recursive: true, force: true })
cpSync(SRC, DST, { recursive: true })

// --- manifest patch ----------------------------------------------------------
const manifestPath = DST + '\\manifest.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.commands = {
  'toggle-panel': {
    suggested_key: { default: 'Ctrl+Shift+P' },
    description: 'Toggle the CofreTabs panel',
  },
}
manifest.host_permissions = ['<all_urls>']
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

// --- service worker patch ----------------------------------------------------
const swPath = DST + '\\src\\background\\service-worker.js'
let sw = readFileSync(swPath, 'utf8')
if (!sw.includes('chrome.commands')) {
  sw += `
// --- trailer recording build only: keyboard command -> same toggle path -----
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-panel') {
      getActiveTab()
        .then((tab) => toggleOrInjectPanel(tab))
        .catch((error) => logError('command', error));
    }
  });
}
`
  writeFileSync(swPath, sw)
}

// --- seed page ---------------------------------------------------------------
writeFileSync(DST + '\\seed.html', `<!doctype html>
<meta charset="utf-8">
<title>cofretabs trailer seed</title>
<body style="font-family:monospace;background:#0d1117;color:#39ff72;padding:24px">
<pre id="log">seeding local vault...</pre>
<script type="module" src="./seed.js"></script>
</body>`)
cpSync(new URL('./seed.js', import.meta.url), DST + '\\seed.js')

console.log('recording extension ready at', DST)
console.log('load it once via chrome://extensions -> Load unpacked, then run seed.html')
