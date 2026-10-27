// capture-frames.mjs — drives headless Chrome over CDP, seeks the deterministic
// trailer renderer to each of 900 frames (30fps × 30s) and screenshots it.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9335
const PAGE = 'file:///D:/PROJECTS/CofreTabs/docs/trailer/trailer.html'
const FRAMES = 900
const FPS = 30
const OUT = 'frames'
const W = 1920, H = 1080

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = process.env.TEMP + '\\trailer-cdp-' + Date.now()
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const t = list.find((x) => x.type === 'page')
      if (t) return t
    } catch {}
    await sleep(250)
  }
  throw new Error('chrome did not expose a target')
}

async function run() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const t = await target()
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, (m) => {
        if (m.error) return rej(new Error(method + ': ' + m.error.message))
        const ex = m.result && m.result.exceptionDetails
        if (ex) return rej(new Error(method + ' page exception: ' + (ex.exception && ex.exception.description || ex.text)))
        res(m.result)
      })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })

  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: PAGE })

  // wait for the renderer's asset-ready promise (images decoded)
  const ready = await send('Runtime.evaluate', {
    expression: 'window.__ready.then(() => true)',
    awaitPromise: true,
    returnByValue: true,
  })
  if (!ready.result.value) throw new Error('renderer not ready')

  const t0 = Date.now()
  const smoke = process.argv.includes('--smoke')
  const CUES = [0.3, 1.5, 3.4, 5.5, 6.8, 8.6, 12.0, 14.5, 16.2, 18.6, 21.2, 23.9, 26.2, 28.6]
  if (smoke) {
    rmSync('frames-smoke', { recursive: true, force: true })
    mkdirSync('frames-smoke', { recursive: true })
    for (let i = 0; i < CUES.length; i++) {
      await send('Runtime.evaluate', { expression: `window.__seek(${CUES[i]})`, returnByValue: true })
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true })
      writeFileSync(`frames-smoke/smoke_${String(i).padStart(2, '0')}_t${CUES[i]}.jpg`, Buffer.from(shot.data, 'base64'))
    }
    console.log(`smoke: ${CUES.length} frames written`)
    ws.close()
    return
  }
  for (let f = 0; f < FRAMES; f++) {
    const time = f / FPS
    await send('Runtime.evaluate', { expression: `window.__seek(${time})`, returnByValue: true })
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true })
    writeFileSync(`${OUT}/frame_${String(f).padStart(4, '0')}.jpg`, Buffer.from(shot.data, 'base64'))
    if (f % 90 === 0) console.log(`frame ${f}/${FRAMES} (${time.toFixed(1)}s) — ${((Date.now() - t0) / 1000).toFixed(0)}s elapsed`)
  }
  const secs = (Date.now() - t0) / 1000
  console.log(`captured ${FRAMES} frames in ${secs.toFixed(0)}s (${(FRAMES / secs).toFixed(1)} fps)`)
  ws.close()
}

try { await run() } finally { chrome.kill() }
