// cdp.mjs — CDP helper for the trailer recording browser (port 39334).
//
//   node cdp.mjs list
//   node cdp.mjs create <url>
//   node cdp.mjs activate <spec>
//   node cdp.mjs close <spec>
//   node cdp.mjs goto <spec> <url>
//   node cdp.mjs eval <spec> <expression>
//   node cdp.mjs shot <spec> <file.jpg>
//   node cdp.mjs click <spec> <x> <y>        (viewport CSS px, trusted input)
//   node cdp.mjs type <spec> <text> [delay]  (animated insertText, default 130ms)
//   node cdp.mjs key <spec> <keys>           (Escape | Enter | ArrowDown | ctrl+a ...)
//   node cdp.mjs wheel <spec> <x> <y> <deltaY>
//
// spec: id:<targetId> | <urlPrefix> | <index>
//
// Input commands dispatch via Input.* — the events are TRUSTED and reach the
// tab's renderer regardless of which OS window owns the foreground. This is
// what makes the recording immune to the user's other browser.
const PORT = 39334
const port = process.env.CDP_PORT || PORT

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function browserWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      const info = await res.json()
      return info.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('recording browser not reachable on port ' + port)
}

async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = typeof ev.data === 'string' ? JSON.parse(ev.data) : null
    if (m && m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, (m) => {
        if (m.error) return rej(new Error(method + ': ' + m.error.message))
        res(m.result)
      })
      ws.send(JSON.stringify(sessionId ? { id: mid, sessionId, method, params } : { id: mid, method, params }))
    })
  return { ws, send }
}

async function targets(send) {
  const { targetInfos } = await send('Target.getTargets')
  return targetInfos.filter((t) => t.type === 'page')
}

// Match by "id:<targetId>" (stable), then URL prefix, then numeric index.
function pick(list, spec) {
  if (spec.startsWith('id:')) return list.find((x) => x.targetId === spec.slice(3))
  const byPrefix = list.find((x) => x.url.startsWith(spec))
  if (byPrefix) return byPrefix
  const idx = Number(spec)
  return Number.isInteger(idx) ? list[idx] : undefined
}

async function resolve(send, spec) {
  const list = await targets(send)
  const t = pick(list, spec)
  if (!t) throw new Error('no target matching ' + spec)
  const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
  return { t, sessionId }
}

// key map: name -> CDP key fields
const KEYS = {
  escape:    { key: 'Escape', code: 'Escape', vk: 27 },
  enter:     { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  arrowup:   { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete:    { key: 'Delete', code: 'Delete', vk: 46 },
  tab:       { key: 'Tab', code: 'Tab', vk: 9 },
}
const MODS = { ctrl: 2, alt: 1, shift: 8, meta: 4 }

async function pressKey(sessionSend, spec) {
  // "Escape" | "ctrl+a" | "ctrl+shift+p" | "ArrowDown"
  const parts = spec.toLowerCase().split('+')
  const name = parts.pop()
  let modifiers = 0
  for (const p of parts) modifiers |= MODS[p] || 0
  const k = KEYS[name]
  const params = k
    ? { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers }
    : { key: name.toUpperCase(), code: 'Key' + name.toUpperCase(), windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0), modifiers }
  await sessionSend('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params })
  await sleep(30)
  await sessionSend('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

const [, , cmd, ...args] = process.argv

const wsUrl = await browserWsUrl()
const { ws, send } = await connect(wsUrl)

try {
  if (cmd === 'list') {
    const list = await targets(send)
    list.forEach((t, i) => console.log(`${i}\t${t.targetId}\t${t.url}\t${t.title}`))
  } else if (cmd === 'create') {
    const params = { url: args[0] }
    if (args[1] === 'newwin') { params.newWindow = true; params.background = true }
    const { targetId } = await send('Target.createTarget', params)
    console.log(targetId)
  } else if (cmd === 'activate' || cmd === 'close') {
    const list = await targets(send)
    const t = pick(list, args[0])
    if (!t) throw new Error('no target matching ' + args[0])
    if (cmd === 'activate') await send('Target.activateTarget', { targetId: t.targetId })
    else await send('Target.closeTarget', { targetId: t.targetId })
    console.log('ok', t.url)
  } else if (cmd === 'goto') {
    const { t, sessionId } = await resolve(send, args[0])
    await send('Page.navigate', { url: args[1] }, sessionId)
    console.log('navigating', t.targetId, '->', args[1])
  } else if (cmd === 'eval' || cmd === 'evalfile' || cmd === 'shot') {
    const { sessionId } = await resolve(send, args[0])
    let expression = args[1]
    if (cmd === 'evalfile') {
      const { readFileSync } = await import('node:fs')
      expression = readFileSync(args[1], 'utf8')
    }
    const result = cmd === 'shot'
      ? await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true }, sessionId)
      : await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (cmd !== 'shot') {
      console.log(JSON.stringify(result?.result?.value ?? result, null, 2))
    } else {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(args[1], Buffer.from(result.data, 'base64'))
      console.log('wrote', args[1])
    }
  } else if (cmd === 'click') {
    const { sessionId } = await resolve(send, args[0])
    const [x, y] = [Number(args[1]), Number(args[2])]
    const base = { x, y, button: 'none', pointerType: 'mouse' }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base }, sessionId)
    await sleep(60)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, sessionId)
    await sleep(50)
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, sessionId)
    console.log('clicked', x, y)
  } else if (cmd === 'type') {
    const { sessionId } = await resolve(send, args[0])
    const text = args[1]
    const delay = Number(args[2] || 130)
    for (const ch of text) {
      await send('Input.insertText', { text: ch }, sessionId)
      await sleep(delay)
    }
    console.log('typed', JSON.stringify(text))
  } else if (cmd === 'key') {
    const { sessionId } = await resolve(send, args[0])
    for (const k of args.slice(1)) {
      await pressKey((m, p) => send(m, p, sessionId), k)
      await sleep(80)
    }
    console.log('keys', args.slice(1).join(' '))
  } else if (cmd === 'wheel') {
    const { sessionId } = await resolve(send, args[0])
    const [x, y, dy] = [Number(args[1]), Number(args[2]), Number(args[3])]
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' }, sessionId)
    console.log('wheeled', x, y, dy)
  } else {
    console.log('commands: list | create | activate | close | goto | eval | shot | click | type | key | wheel')
  }
} finally {
  ws.close()
}
