// make-audio-options.mjs — three audition tracks for the trailer v2 music swap.
// Same grid as trailer.wav so ANY choice stays beat-synced with the cut map:
// 128 BPM, 30.000s, crashes at 3.75/15.0/26.25, theme-flip accent at 21.125,
// whip whooshes ending at 13.59375/20.625, half-beat gaps before each drop,
// fade 29.5-30.0.
//   A — "Iron Voltage"   darksynth: D harmonic-minor riffs, power stabs, industrial
//   B — "Neon Horizon"   retrowave anthem: uplifting F-major, big lead + bells
//   C — "Grid Runner"    cyber techno: acid bassline, 4-on-floor, delayed motif
// Deterministic (same LCG) -> reproducible. Output: music-options/option-{a,b,c}.wav
import { writeFileSync, mkdirSync } from 'node:fs'

const SR = 44100
const DUR = 30
const N = SR * DUR
const BPM = 128
const SPB = 60 / BPM // 0.46875s per beat
const BAR = SPB * 4 // 1.875s per bar
const bar = (i) => i * BAR

let lcg = 0x9e3779b9
function rnd() {
  lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0
  return (lcg / 0x100000000) * 2 - 1
}

// per-option buses, reset before each arrangement
let B
function fresh() {
  B = {
    drums: [new Float32Array(N), new Float32Array(N)],
    bassB: [new Float32Array(N), new Float32Array(N)],
    leadB: [new Float32Array(N), new Float32Array(N)],
    padB: [new Float32Array(N), new Float32Array(N)],
    fxB: [new Float32Array(N), new Float32Array(N)],
    kicks: [],
  }
}
const lp1 = (c) => ({ y: 0, tick(x) { this.y += (x - this.y) * c; return this.y } })
const onePoleC = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR)

// --- drums (shared) -----------------------------------------------------------
function kick(t, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.3 * SR)
  let ph = 0
  const tone = lp1(onePoleC(3200))
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const f = 48 + 130 * Math.exp(-k * 40)
    ph += (2 * Math.PI * f) / SR
    const env = Math.exp(-k * 13) * (1 - Math.exp(-k * 800))
    const click = k < 0.005 ? tone.tick(rnd()) * 0.7 * (1 - k / 0.005) : 0
    const s = (Math.sin(ph) + click) * env * vel
    B.drums[0][s0 + i] += s
    B.drums[1][s0 + i] += s
  }
  B.kicks.push(t)
}

function snare(t, vel = 1, tail = 0.22) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(tail * SR)
  const bp = lp1(onePoleC(2600))
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const n = rnd()
    const band = n - bp.tick(n)
    const tone = Math.sin(2 * Math.PI * 188 * k) * Math.exp(-k * 42)
    const env = Math.exp(-k * (tail > 0.3 ? 11 : 24)) * (1 - Math.exp(-k * 600))
    const s = (band * 0.85 + tone * 0.55) * env * vel * 0.85
    B.drums[0][s0 + i] += s * 0.92
    B.drums[1][s0 + i] += s * 1.0
  }
}

function clap(t, vel = 1) {
  const s0 = Math.floor(t * SR)
  const taps = [0, 0.01, 0.019, 0.03]
  for (let ti = 0; ti < taps.length; ti++) {
    const off = Math.floor(taps[ti] * SR)
    const body = ti === taps.length - 1
    const len = Math.floor((body ? 0.19 : 0.05) * SR)
    const lp = lp1(onePoleC(3200))
    const hp = lp1(onePoleC(1100))
    for (let i = 0; i < len && s0 + off + i < N; i++) {
      const k = i / SR
      const y = lp.tick(rnd())
      const h = y - hp.tick(y)
      const env = Math.exp(-k * (body ? 15 : 55))
      const s = h * env * vel * (body ? 0.4 : 0.5)
      B.drums[0][s0 + off + i] += s * 0.95
      B.drums[1][s0 + off + i] += s * 1.0
    }
  }
}

function hat(t, vel = 1, open = false) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor((open ? 0.19 : 0.055) * SR)
  const hp = lp1(onePoleC(5200))
  let prev = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const n = rnd()
    const h = 0.9 * (hp.y + n - prev)
    prev = n
    const env = Math.exp(-i / SR * (open ? 15 : 85))
    const s = h * env * vel * 0.34
    B.drums[0][s0 + i] += s * 0.8
    B.drums[1][s0 + i] += s * 1.0
  }
}

function tom(t, f0 = 150, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.26 * SR)
  let ph = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const f = f0 * (0.55 + 0.45 * Math.exp(-k * 12))
    ph += (2 * Math.PI * f) / SR
    const env = Math.exp(-k * 15) * (1 - Math.exp(-k * 500))
    const s = Math.sin(ph) * env * vel * 0.7
    B.drums[0][s0 + i] += s
    B.drums[1][s0 + i] += s
  }
}

function crash(t, vel = 1, lenS = 1.7) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(lenS * SR)
  const hpA = lp1(onePoleC(6500))
  const hpB = lp1(onePoleC(6800))
  let pA = 0
  let pB = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const nA = rnd()
    const nB = rnd()
    const a = nA - hpA.tick(nA) * 0.6 - pA * 0.4
    pA = nA
    const b = nB - hpB.tick(nB) * 0.6 - pB * 0.4
    pB = nB
    const env = Math.exp(-i / SR * 2.4) * (1 - Math.exp(-i / SR * 300))
    B.drums[0][s0 + i] += a * env * vel * 0.5
    B.drums[1][s0 + i] += b * env * vel * 0.5
  }
}

// --- fx ----------------------------------------------------------------------
function riser(t, dur, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const lp = lp1(onePoleC(11000))
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const p = k / dur
    const n = rnd()
    const hp = n - lp.tick(n)
    lp.y += (n - lp.y) * 0.0001
    const s = hp * p * p * vel * 0.6
    B.fxB[0][s0 + i] += s * (1 - p * 0.2)
    B.fxB[1][s0 + i] += s * (0.8 + p * 0.2)
  }
}

function boom(t, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.9 * SR)
  let ph = 0
  const lp = lp1(onePoleC(900))
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const f = 34 + 52 * Math.exp(-k * 6)
    ph += (2 * Math.PI * f) / SR
    const env = Math.exp(-k * 4.5) * (1 - Math.exp(-k * 400))
    const n = k < 0.06 ? lp.tick(rnd()) * 0.4 * (1 - k / 0.06) : 0
    const s = (Math.sin(ph) * 1.1 + n) * env * vel * 0.8
    B.fxB[0][s0 + i] += s
    B.fxB[1][s0 + i] += s
  }
}

// whip whoosh that ENDS exactly at tEnd (for the 13.59 / 20.63 whip pans)
function whoosh(tEnd, dur = 0.55, vel = 1) {
  const s0 = Math.floor((tEnd - dur) * SR)
  if (s0 < 0) return
  const len = Math.floor(dur * SR)
  let low = 0, band = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const p = k / dur
    const fc = Math.min(7500, 300 * Math.pow(24, p))
    const f1 = 2 * Math.sin((Math.PI * fc) / SR)
    const n = rnd()
    const high = n - low - 0.4 * band
    band += f1 * high
    low += f1 * band
    const tail = p > 0.95 ? (1 - p) / 0.05 : 1
    const s = band * p * p * tail * vel * 1.1
    B.fxB[0][s0 + i] += s * (1 - p * 0.3)
    B.fxB[1][s0 + i] += s * (0.7 + p * 0.3)
  }
}

// --- tonal voices -------------------------------------------------------------
function supersaw(t, f, dur, bus, opts = {}) {
  const { voices = 7, det = 0.006, pan = 0, att = 0.008, rel = 0.06, fc = 5200, vel = 0.5 } = opts
  const s0 = Math.floor(t * SR)
  const len = Math.floor((dur + rel) * SR)
  const c = onePoleC(fc)
  const ph = new Float64Array(voices)
  const fs = new Float64Array(voices)
  for (let v = 0; v < voices; v++) {
    fs[v] = f * (1 + ((v - (voices - 1) / 2) / ((voices - 1) / 2 || 1)) * det)
  }
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  let y = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    let s = 0
    for (let v = 0; v < voices; v++) {
      ph[v] += fs[v] / SR
      if (ph[v] >= 1) ph[v] -= 1
      s += 2 * ph[v] - 1
    }
    s /= voices
    y += (s - y) * c
    const env = Math.min(1, k / att) * (k < dur ? 1 : Math.max(0, 1 - (k - dur) / rel))
    const out = y * env * vel
    bus[0][s0 + i] += out * gl
    bus[1][s0 + i] += out * gr
  }
}

function bassNote(t, f, dur, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  let ph = 0, ph2 = 0, ph3 = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    ph2 += (f * 1.005) / SR
    ph3 += (f * 0.995) / SR
    const env = Math.min(1, k / 0.006) * Math.min(1, (dur - k) / 0.02) * Math.exp(-k * 1.2)
    let s = (2 * (ph % 1) - 1) * 0.5 + (2 * (ph2 % 1) - 1) * 0.3 + (2 * (ph3 % 1) - 1) * 0.3
    s += Math.sin(2 * Math.PI * (f / 2) * k) * 0.9
    s = Math.tanh(s * 1.4) * env * vel * 0.55
    B.bassB[0][s0 + i] += s
    B.bassB[1][s0 + i] += s
  }
}

// distorted staccato saw bass (option A)
function distBass(t, f, dur, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const drive = 3.4
  const c = onePoleC(Math.min(3400, f * 9 + 350))
  let ph = 0, ph2 = 0
  let y = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    ph2 += (f * 1.007) / SR
    let s = (2 * (ph % 1) - 1) * 0.62 + (2 * (ph2 % 1) - 1) * 0.45
    s += Math.sin(2 * Math.PI * (f / 2) * k) * 0.85
    s = Math.tanh(s * drive)
    y += (s - y) * c
    const env = Math.min(1, k / 0.0025) * Math.min(1, (dur - k) / 0.008) * Math.exp(-k * 0.7)
    const out = y * env * vel * 0.5
    B.bassB[0][s0 + i] += out
    B.bassB[1][s0 + i] += out
  }
}

// resonant acid bass with filter envelope (option C)
function acid(t, f, vel = 1, opts = {}) {
  const { base = 350, peak = 3600, dec = 0.2, res = 0.72, dur = SPB / 4 - 0.002, pan = 0 } = opts
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const qd = 1 / (1 + res * 2.6)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  let ph = 0, low = 0, band = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    const s = 2 * (ph % 1) - 1
    const fc = Math.min(7500, base + (peak - base) * Math.exp(-k / dec))
    const f1 = 2 * Math.sin((Math.PI * fc) / SR)
    const high = s - low - qd * band
    band += f1 * high
    low += f1 * band
    const env = Math.min(1, k / 0.002) * Math.min(1, (dur - k) / 0.01)
    const out = Math.tanh(low * 2.6) / 2.6 * env * vel * 0.62
    B.bassB[0][s0 + i] += out * gl
    B.bassB[1][s0 + i] += out * gr
  }
}

// pulse-wave riff/stab voice (options A/B)
function sq(t, f, dur, bus, opts = {}) {
  const { vel = 0.35, duty = 0.42, fc = 3600, drive = 2.2, att = 0.003, rel = 0.04, pan = 0 } = opts
  const s0 = Math.floor(t * SR)
  const len = Math.floor((dur + rel) * SR)
  const c = onePoleC(fc)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  let ph = 0, y = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    const s = ph % 1 < duty ? 1 : -1
    y += (s - y) * c
    const env = Math.min(1, k / att) * (k < dur ? 1 : Math.max(0, 1 - (k - dur) / rel))
    const out = (Math.tanh(y * drive) / drive) * env * vel
    bus[0][s0 + i] += out * gl
    bus[1][s0 + i] += out * gr
  }
}

// bright retro pluck (options B/C)
function pluck(t, f, dur, bus, opts = {}) {
  const { vel = 0.25, pan = 0, fc0 = 5200 } = opts
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  let ph = 0, y = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    const s = ph % 1 < 0.5 ? 1 : -1
    const fc = 700 + fc0 * Math.exp(-k * 9)
    y += (s - y) * onePoleC(fc)
    const env = Math.exp(-k * 10) * (1 - Math.exp(-k * 900))
    const out = Math.tanh(y * 1.4) * env * vel
    bus[0][s0 + i] += out * gl
    bus[1][s0 + i] += out * gr
  }
}

// FM bell sparkle (option B)
function bell(t, f, dur, bus, opts = {}) {
  const { vel = 0.22, pan = 0.1 } = opts
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const gl = Math.cos(((pan + 1) * Math.PI) / 4)
  const gr = Math.sin(((pan + 1) * Math.PI) / 4)
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const idx = 3.4 * Math.exp(-k * 5.5)
    const s = Math.sin(2 * Math.PI * f * k + idx * Math.sin(2 * Math.PI * 2.01 * f * k))
    const out = s * Math.exp(-k * 2.6) * vel
    bus[0][s0 + i] += out * gl
    bus[1][s0 + i] += out * gr
  }
}

// ping-pong echo applied in place to a bus
function pingpong(bus, delaySec, fb) {
  const d = Math.floor(delaySec * SR)
  const snapL = Float32Array.from(bus[0])
  const snapR = Float32Array.from(bus[1])
  for (let rep = 1; rep <= 3; rep++) {
    const g = Math.pow(fb, rep)
    const off = d * rep
    for (let i = 0; i + off < N; i++) {
      bus[0][i + off] += snapR[i] * g
      bus[1][i + off] += snapL[i] * g
    }
  }
}

// --- chords -------------------------------------------------------------------
const Dm = { root: 73.42, tri: [146.83, 174.61, 220.0] }
const Bb = { root: 58.27, tri: [116.54, 146.83, 174.61] }
const F = { root: 87.31, tri: [174.61, 220.0, 261.63] }
const C = { root: 65.41, tri: [130.81, 164.81, 196.0] }
const Gm = { root: 49.0, tri: [98.0, 116.54, 146.83] }
const A = { root: 55.0, tri: [110.0, 138.59, 164.81] }
const semi = (f, s) => f * Math.pow(2, s / 12)

// ============================================================ OPTION A — darksynth
function arrangeA() {
  // D minor, riff-driven, power stabs, industrial fills. Progression Dm Dm Bb Bb F F C C Dm Dm Bb Bb F C Dm Dm
  const CH = [Dm, Dm, Bb, Bb, F, F, C, C, Dm, Dm, Bb, Bb, F, C, Dm, Dm]
  const Csh = 277.18 // C# — harmonic-minor colour

  // intro: dark drone + industrial hits + riser
  boom(0, 0.6)
  crash(0, 0.45, 2.2)
  supersaw(bar(0), Dm.root, BAR * 2 - 0.1, B.padB, { voices: 5, det: 0.005, fc: 950, att: 0.7, rel: 0.4, vel: 0.5, pan: -0.1 })
  supersaw(bar(0), Dm.root * 2, BAR * 2 - 0.1, B.padB, { voices: 3, det: 0.008, fc: 1400, att: 0.9, rel: 0.4, vel: 0.28, pan: 0.15 })
  tom(1.406, 130, 0.35)
  snare(1.875, 0.16, 0.3)
  tom(2.344, 105, 0.4)
  snare(2.813, 0.22, 0.3)
  for (let i = 0; i < 16; i++) hat(bar(1) + i * (SPB / 4), 0.05 + i * 0.013)
  riser(bar(1), BAR - SPB / 4, 0.9)

  const RIFF = [0, 0, 12, 0, 0, 12, 0, 6, 0, 0, 12, 0, 0, 6, 12, 0] // semitone offsets per 16th
  const bassBar = (b, vel) => {
    const ch = CH[b]
    for (let s16 = 0; s16 < 16; s16++) {
      if (b === 6 && s16 >= 14) continue // breathe before fill
      if (b === 12 && s16 >= 14) continue
      const t = bar(b) + s16 * (SPB / 4)
      distBass(t, semi(ch.root * 2, RIFF[s16]), SPB / 4 - 0.004, (s16 % 4 === 0 ? vel : vel * 0.8))
    }
  }
  const groove = (b, v = 1) => {
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB
      kick(t, v)
      if (q === 1 || q === 3) snare(t, 0.9 * v, 0.24)
      hat(t, 0.4)
      hat(t + SPB / 2, 0.5, true)
    }
  }

  // DROP 1 (3.75-13.125)
  crash(bar(2), 0.9)
  boom(bar(2), 0.95)
  for (let b = 2; b <= 6; b++) {
    groove(b)
    bassBar(b, 0.85)
  }
  // power stabs from bar 4 (offbeat 8ths): root + fifth pulse chords
  for (let b = 3; b <= 6; b++) {
    const ch = CH[b]
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB + SPB / 2
      sq(t, ch.root * 4, 0.1, B.leadB, { vel: 0.3, pan: q % 2 ? 0.3 : -0.3 })
      sq(t, semi(ch.root * 4, 7), 0.1, B.leadB, { vel: 0.24, pan: q % 2 ? 0.3 : -0.3 })
    }
  }

  // FILL (13.125-15.0)
  kick(bar(7), 1)
  kick(bar(7) + SPB, 0.9)
  tom(bar(7) + SPB * 2, 150, 0.6)
  tom(bar(7) + SPB * 2.5, 120, 0.65)
  for (let s16 = 4; s16 < 16; s16++) {
    const t = bar(7) + s16 * (SPB / 4)
    snare(t, 0.35 + (s16 - 4) * 0.055, 0.18)
    if (s16 >= 8) kick(t, 0.55)
  }
  riser(bar(7) + SPB, BAR - SPB - SPB / 4, 1.0)
  whoosh(13.59375, 0.55, 0.55) // whip into the library reveal

  // DROP 2 (15.0-24.375): riff + octave lead stabs + dissonant clusters
  crash(bar(8), 1.0, 2.2)
  boom(bar(8), 1.05)
  const RIFF_A = [[0, 0.2, 0], [0.75, 0.12, 0], [1.5, 0.22, 3], [2.5, 0.12, 0], [3.25, 0.45, 5]]
  const RIFF_B = [[0, 0.16, 0], [1, 0.16, 7], [2, 0.16, 0], [2.5, 0.3, 10], [3.5, 0.4, 0]]
  for (let b = 8; b <= 12; b++) {
    groove(b, 1.02)
    bassBar(b, 0.95)
    const ch = CH[b]
    const riff = b % 2 === 0 ? RIFF_A : RIFF_B
    for (const [beat, len, st] of riff) {
      const t = bar(b) + beat * SPB
      const f = semi(ch.root * 4, st)
      sq(t, f, len, B.leadB, { vel: 0.4, fc: 3000, pan: -0.1 })
      sq(t, semi(f, 12), len, B.leadB, { vel: 0.3, fc: 4200, pan: 0.15 })
    }
    if (b === 10 || b === 12) {
      sq(bar(b), ch.root * 4, 0.12, B.leadB, { vel: 0.26, fc: 5200, pan: 0.35 })
      sq(bar(b), semi(ch.root * 4, 1), 0.12, B.leadB, { vel: 0.22, fc: 5200, pan: -0.35 }) // minor-2nd cluster
    }
  }
  supersaw(bar(8), Dm.root, BAR * 5 - 0.2, B.padB, { voices: 5, det: 0.005, fc: 1050, att: 0.25, rel: 0.4, vel: 0.34, pan: -0.15 })

  whoosh(20.625, 0.5, 0.5) // whip into the theme flip
  crash(21.125, 0.55, 1.2) // theme-flip accent
  boom(21.125, 0.6)

  // BREAKDOWN (24.375-26.25)
  supersaw(bar(13), C.root, BAR - 0.05, B.padB, { voices: 5, det: 0.006, fc: 1200, att: 0.2, rel: 0.35, vel: 0.5, pan: 0 })
  distBass(bar(13), C.root * 2, 1.6, 0.6)
  riser(bar(13) + SPB, BAR - SPB - SPB / 8, 1.0)
  for (let s16 = 8; s16 < 16; s16++) {
    const t = bar(13) + s16 * (SPB / 4)
    const step = s16 >= 14 ? 2 : 1
    if (s16 % step === 0) snare(t, 0.4 + (s16 - 8) * 0.07, 0.16)
  }

  // FINAL (26.25-30.0): riff +12, everything in
  crash(bar(14), 1.0, 2.6)
  boom(bar(14), 1.15)
  for (let b = 14; b <= 15; b++) {
    groove(b, 1.08)
    for (let s16 = 0; s16 < 16; s16++) hat(bar(b) + s16 * (SPB / 4), s16 % 2 ? 0.1 : 0.22)
    bassBar(b, 1.0)
    const ch = CH[b]
    const riff = b % 2 === 0 ? RIFF_A : RIFF_B
    for (const [beat, len, st] of riff) {
      const t = bar(b) + beat * SPB
      const f = semi(ch.root * 4, st)
      sq(t, f, len, B.leadB, { vel: 0.46, fc: 3200, pan: -0.1 })
      sq(t, semi(f, 12), len, B.leadB, { vel: 0.36, fc: 4600, pan: 0.15 })
    }
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB
      sq(t, ch.root * 4, 0.11, B.leadB, { vel: 0.3, pan: q % 2 ? 0.3 : -0.3 })
      sq(t, semi(ch.root * 4, 7), 0.11, B.leadB, { vel: 0.25, pan: q % 2 ? 0.3 : -0.3 })
    }
  }
  tom(bar(15) + SPB * 2, 140, 0.6)
  tom(bar(15) + SPB * 2.5, 110, 0.7)
  // final sustained power chord into the fade
  sq(29.0, Dm.root * 4, 0.5, B.leadB, { vel: 0.34, fc: 2600, rel: 0.4, pan: -0.2 })
  sq(29.0, semi(Dm.root * 4, 7), 0.5, B.leadB, { vel: 0.3, fc: 2600, rel: 0.4, pan: 0.2 })
  sq(29.0, Dm.root * 8, 0.5, B.leadB, { vel: 0.24, fc: 4000, rel: 0.4, pan: 0 })
  void Csh
}

// ============================================================ OPTION B — retrowave
function arrangeB() {
  // uplifting: F C Dm Bb, big anthem lead, bells, gated chords
  const CH = [F, F, C, C, Dm, Dm, Bb, Bb, F, F, C, C, Bb, C, Dm, F]

  // intro: bright pad + pluck arp + bells
  crash(0, 0.45, 2.2)
  supersaw(bar(0), F.tri[0], BAR * 2 - 0.1, B.padB, { voices: 7, det: 0.004, fc: 3600, att: 0.7, rel: 0.5, vel: 0.48, pan: -0.2 })
  supersaw(bar(0), F.tri[1], BAR * 2 - 0.1, B.padB, { voices: 5, det: 0.005, fc: 3200, att: 0.85, rel: 0.5, vel: 0.34, pan: 0.25 })
  const arpSeq = [F.tri[0], F.tri[1], F.tri[2], F.tri[0] * 2]
  for (let s16 = 0; s16 < 16; s16++) {
    const t = bar(1) + s16 * (SPB / 4)
    pluck(t, arpSeq[s16 % 4] * 2, SPB / 4, B.leadB, { vel: 0.1 + s16 * 0.008, pan: s16 % 2 ? 0.3 : -0.3 })
  }
  bell(bar(1) + SPB * 2, F.tri[2] * 2, 1.0, B.leadB, { vel: 0.16, pan: 0.2 })
  bell(bar(1) + SPB * 3, F.tri[1] * 2, 0.8, B.leadB, { vel: 0.14, pan: -0.2 })
  riser(bar(1), BAR - SPB / 4, 0.85)

  const groove = (b, v = 1) => {
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB
      kick(t, v)
      if (q === 1 || q === 3) snare(t, 0.85 * v, 0.34)
      hat(t, 0.42)
      hat(t + SPB / 2, 0.55, true)
    }
  }
  const bass8 = (b, v = 1) => {
    const ch = CH[b]
    for (let e = 0; e < 8; e++) {
      const t = bar(b) + e * (SPB / 2)
      if (b === 6 && e >= 6) continue
      bassNote(t, e === 5 ? ch.root * 1.5 : ch.root, SPB / 2 - 0.01, (e % 2 === 0 ? 1 : 0.8) * v)
    }
  }
  const gated = (b, v = 0.26) => {
    const ch = CH[b]
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB + SPB / 2
      for (const f of ch.tri) supersaw(t, f, 0.11, B.leadB, { voices: 5, det: 0.009, fc: 4600, vel: v, pan: q % 2 ? 0.3 : -0.3 })
    }
  }

  // DROP 1 (3.75-13.125): arp + bass + groove
  crash(bar(2), 0.9)
  boom(bar(2), 0.9)
  for (let b = 2; b <= 6; b++) {
    groove(b)
    bass8(b)
    const ch = CH[b]
    const seq = [ch.tri[0], ch.tri[1], ch.tri[2], ch.tri[0] * 2]
    for (let s16 = 0; s16 < 16; s16++) {
      if (b === 6 && s16 >= 12) continue
      pluck(bar(b) + s16 * (SPB / 4), seq[s16 % 4] * 2, SPB / 4, B.leadB, { vel: 0.15, pan: s16 % 2 ? 0.32 : -0.32 })
    }
    if (b >= 4) gated(b, 0.22)
  }
  // bell counter-melody over bars 5-6
  for (const [b, f] of [[0.5, 880], [1.5, 784], [2.5, 698.46], [3.5, 880]]) {
    bell(bar(5) + b * SPB, f, 0.7, B.leadB, { vel: 0.15, pan: 0.25 })
    bell(bar(6) + b * SPB, f * 0.891, 0.7, B.leadB, { vel: 0.13, pan: -0.25 })
  }

  // FILL (13.125-15.0)
  kick(bar(7), 1)
  kick(bar(7) + SPB, 0.9)
  for (let s16 = 4; s16 < 16; s16++) {
    const t = bar(7) + s16 * (SPB / 4)
    snare(t, 0.35 + (s16 - 4) * 0.055, 0.18)
    if (s16 >= 8) kick(t, 0.55)
  }
  riser(bar(7) + SPB, BAR - SPB - SPB / 4, 1.0)
  whoosh(13.59375, 0.55, 0.5)

  // DROP 2 (15.0-24.375): the anthem
  crash(bar(8), 1.0, 2.2)
  boom(bar(8), 1.0)
  const MEL = [
    [0.0, 523.25, 1.0], [1.0, 587.33, 0.5], [1.5, 523.25, 0.5], [2.0, 440.0, 1.0], [3.0, 523.25, 1.0],
    [4.0, 659.26, 1.5], [5.5, 587.33, 0.5], [6.0, 523.25, 1.9],
    [8.0, 587.33, 1.0], [9.0, 698.46, 0.5], [9.5, 659.26, 0.5], [10.0, 587.33, 1.0], [11.0, 523.25, 1.0],
    [12.0, 466.16, 1.0], [13.0, 523.25, 0.5], [13.5, 587.33, 0.5], [14.0, 659.26, 1.9],
    [16.0, 698.46, 1.0], [17.0, 659.26, 0.5], [17.5, 587.33, 0.5], [18.0, 523.25, 1.0], [19.0, 523.25, 1.0],
  ]
  for (let b = 8; b <= 12; b++) {
    groove(b, 1.02)
    bass8(b, 1.02)
    gated(b, 0.24)
  }
  supersaw(bar(8), F.tri[0] / 2, BAR * 5 - 0.2, B.padB, { voices: 7, det: 0.004, fc: 2800, att: 0.3, rel: 0.4, vel: 0.34, pan: -0.2 })
  for (const [b, f, d] of MEL) {
    const t = bar(8) + b * SPB
    supersaw(t, f, d * SPB - 0.02, B.leadB, { voices: 7, det: 0.007, fc: 5400, vel: 0.42, pan: 0.05 })
    supersaw(t, f * 0.5, d * SPB - 0.02, B.leadB, { voices: 5, det: 0.005, fc: 3600, vel: 0.22, pan: -0.1 })
  }
  // bell sparkle on phrase ends (phrase beats are absolute from bar 8 = 15.0s)
  bell(bar(8) + 7 * SPB, 1046.5, 1.2, B.leadB, { vel: 0.16, pan: 0.3 })
  bell(bar(8) + 15 * SPB, 987.77, 1.2, B.leadB, { vel: 0.14, pan: -0.3 })
  bell(bar(8) + 19 * SPB, 1046.5, 1.4, B.leadB, { vel: 0.16, pan: 0.3 })

  whoosh(20.625, 0.5, 0.45)
  crash(21.125, 0.55, 1.2) // theme-flip accent
  boom(21.125, 0.6)
  bell(21.125, 1318.5, 1.0, B.leadB, { vel: 0.14, pan: 0 })

  // BREAKDOWN (24.375-26.25)
  supersaw(bar(13), Bb.tri[0], BAR - 0.05, B.padB, { voices: 7, det: 0.005, fc: 2600, att: 0.25, rel: 0.4, vel: 0.5, pan: 0 })
  supersaw(bar(13), Bb.tri[2], BAR - 0.05, B.padB, { voices: 5, det: 0.006, fc: 2300, att: 0.3, rel: 0.4, vel: 0.32, pan: 0.2 })
  bassNote(bar(13), Bb.root, 1.7, 0.65)
  bell(bar(13) + SPB, Bb.tri[1] * 2, 1.2, B.leadB, { vel: 0.18, pan: -0.2 })
  bell(bar(13) + SPB * 2, C.tri[0] * 2, 1.2, B.leadB, { vel: 0.18, pan: 0.2 })
  riser(bar(13) + SPB, BAR - SPB - SPB / 8, 1.0)
  for (let s16 = 8; s16 < 16; s16++) {
    const t = bar(13) + s16 * (SPB / 4)
    const step = s16 >= 14 ? 2 : 1
    if (s16 % step === 0) snare(t, 0.4 + (s16 - 8) * 0.07, 0.16)
  }

  // FINAL (26.25-30.0): melody +12, full band, resolve on F
  crash(bar(14), 1.0, 2.6)
  boom(bar(14), 1.1)
  for (let b = 14; b <= 15; b++) {
    groove(b, 1.05)
    for (let s16 = 0; s16 < 16; s16++) hat(bar(b) + s16 * (SPB / 4), s16 % 2 ? 0.1 : 0.24)
    bass8(b, 1.05)
    gated(b, 0.3)
  }
  const FIN = [
    [0.0, 698.46, 1.0], [1.0, 659.26, 0.5], [1.5, 587.33, 0.5], [2.0, 523.25, 1.0], [3.0, 587.33, 1.0],
    [4.0, 783.99, 1.25], [5.5, 880.0, 0.5], [6.0, 1046.5, 1.45],
  ]
  for (const [b, f, d] of FIN) {
    const t = bar(14) + b * SPB
    supersaw(t, f, Math.min(d * SPB - 0.02, 29.5 - t), B.leadB, { voices: 7, det: 0.008, fc: 5600, vel: 0.46, pan: 0.05 })
    supersaw(t, f * 0.5, Math.min(d * SPB - 0.02, 29.5 - t), B.leadB, { voices: 5, det: 0.005, fc: 3800, vel: 0.24, pan: -0.1 })
  }
  bell(bar(15) + 6 * SPB, 1568.0, 1.6, B.leadB, { vel: 0.16, pan: 0.2 })
  // final F-major swell into the fade
  for (const f of F.tri) supersaw(29.0, f, 0.5, B.padB, { voices: 5, det: 0.005, fc: 3000, att: 0.1, rel: 0.4, vel: 0.3, pan: 0.1 })
}

// ============================================================ OPTION C — techno
function arrangeC() {
  // club: 4-on-floor, acid bassline, delayed pluck motif. Roots D D Bb Bb G G A A D D Bb Bb G A D D
  const ROOTS = [Dm, Dm, Bb, Bb, Gm, Gm, A, A, Dm, Dm, Bb, Bb, Gm, A, Dm, Dm]

  // intro: drone + kick pump-in + riser
  boom(0, 0.55)
  crash(0, 0.4, 2.0)
  supersaw(bar(0), Dm.root, BAR * 2 - 0.1, B.padB, { voices: 5, det: 0.004, fc: 750, att: 0.8, rel: 0.4, vel: 0.5, pan: -0.1 })
  supersaw(bar(0), Dm.root * 2, BAR * 2 - 0.1, B.padB, { voices: 3, det: 0.006, fc: 1100, att: 1.0, rel: 0.4, vel: 0.26, pan: 0.15 })
  kick(bar(1) + SPB, 0.85)
  kick(bar(1) + SPB * 2, 0.9)
  kick(bar(1) + SPB * 3, 0.95)
  for (let q = 2; q < 4; q++) hat(bar(1) + q * SPB + SPB / 2, 0.4, true)
  for (let i = 0; i < 16; i++) hat(bar(1) + i * (SPB / 4), 0.05 + i * 0.01)
  riser(bar(1), BAR - SPB / 4, 0.95)

  const ACD = [0, 0, 12, 0, 0, 7, 0, 12, 0, 0, 12, 0, 7, 0, 12, 0] // 303 pattern (semitones)
  const acidBar = (b, base, peak, vel) => {
    const root = ROOTS[b].root * 2
    for (let s16 = 0; s16 < 16; s16++) {
      if (b === 6 && s16 >= 14) continue
      if (b === 12 && s16 >= 14) continue
      const acc = s16 % 4 === 0
      acid(bar(b) + s16 * (SPB / 4), semi(root, ACD[s16]), vel * (acc ? 1 : 0.82), {
        base, peak: acc ? peak : peak * 0.7, dec: 0.16, pan: s16 % 2 ? 0.12 : -0.12,
      })
    }
  }
  const groove = (b, v = 1, clapsToo = false) => {
    for (let q = 0; q < 4; q++) {
      const t = bar(b) + q * SPB
      kick(t, v)
      if (q === 1 || q === 3) {
        clap(t, 0.55 * v)
        if (clapsToo) snare(t, 0.5 * v, 0.2)
      }
      hat(t + SPB / 2, 0.55, true)
      hat(t, 0.16)
      hat(t + SPB / 4, 0.1)
    }
  }

  // DROP 1 (3.75-13.125)
  crash(bar(2), 0.9)
  boom(bar(2), 0.95)
  const CUTS_D1 = [1800, 1800, 2600, 3200, 4200]
  for (let b = 2; b <= 6; b++) {
    groove(b)
    acidBar(b, 300, CUTS_D1[b - 2], 0.8)
    supersaw(bar(b), ROOTS[b].root, BAR - 0.05, B.padB, { voices: 3, det: 0.004, fc: b % 2 ? 700 : 850, att: 0.3, rel: 0.3, vel: 0.26, pan: b % 2 ? -0.15 : 0.15 })
  }

  // FILL (13.125-15.0)
  kick(bar(7), 1)
  kick(bar(7) + SPB, 0.9)
  for (let s16 = 4; s16 < 16; s16++) {
    const t = bar(7) + s16 * (SPB / 4)
    clap(t, 0.3 + (s16 - 4) * 0.05)
    if (s16 >= 8) kick(t, 0.55)
  }
  acidBar(7, 500, 6000, 0.85)
  riser(bar(7) + SPB, BAR - SPB - SPB / 4, 1.0)
  whoosh(13.59375, 0.55, 0.55)

  // DROP 2 (15.0-24.375): acid wide open + delayed pluck motif
  crash(bar(8), 1.0, 2.2)
  boom(bar(8), 1.05)
  const MOTIF = [0, 3, 6, 8, 11, 14] // 16th hits per bar
  for (let b = 8; b <= 12; b++) {
    groove(b, 1.02, true)
    acidBar(b, 350, 5200, 0.92)
    supersaw(bar(b), ROOTS[b].root, BAR - 0.05, B.padB, { voices: 3, det: 0.005, fc: 800, att: 0.25, rel: 0.3, vel: 0.28, pan: b % 2 ? -0.15 : 0.15 })
    const tri = ROOTS[b].tri
    const seq = [tri[0] * 2, tri[1] * 2, tri[2] * 2, tri[0] * 4]
    for (let mi = 0; mi < MOTIF.length; mi++) {
      pluck(bar(b) + MOTIF[mi] * (SPB / 4), seq[mi % 4], SPB / 3, B.leadB, { vel: 0.2, pan: mi % 2 ? 0.35 : -0.35 })
    }
  }
  pingpong(B.leadB, SPB * 0.75, 0.38)

  whoosh(20.625, 0.5, 0.5)
  crash(21.125, 0.55, 1.2) // theme-flip accent
  boom(21.125, 0.65)

  // BREAKDOWN (24.375-26.25): kick out, acid filter sweep, roll
  acid(bar(13), A.root * 2, 1.0, { base: 250, peak: 7000, dec: 1.1, dur: BAR - 0.1 })
  supersaw(bar(13), A.root, BAR - 0.05, B.padB, { voices: 5, det: 0.005, fc: 900, att: 0.2, rel: 0.35, vel: 0.42, pan: 0 })
  riser(bar(13) + SPB, BAR - SPB - SPB / 8, 1.0)
  for (let s16 = 8; s16 < 16; s16++) {
    const t = bar(13) + s16 * (SPB / 4)
    const step = s16 >= 14 ? 2 : 1
    if (s16 % step === 0) clap(t, 0.35 + (s16 - 8) * 0.07)
  }

  // FINAL (26.25-30.0): everything, motif +12, acid open
  crash(bar(14), 1.0, 2.6)
  boom(bar(14), 1.15)
  for (let b = 14; b <= 15; b++) {
    groove(b, 1.08, true)
    for (let s16 = 0; s16 < 16; s16++) hat(bar(b) + s16 * (SPB / 4), s16 % 2 ? 0.1 : 0.24)
    acidBar(b, 400, 6500, 1.0)
    supersaw(bar(b), ROOTS[b].root, BAR - 0.05, B.padB, { voices: 5, det: 0.005, fc: 950, att: 0.2, rel: 0.3, vel: 0.3, pan: 0 })
    const tri = ROOTS[b].tri
    const seq = [tri[0] * 4, tri[1] * 4, tri[2] * 4, tri[0] * 8]
    for (let mi = 0; mi < MOTIF.length; mi++) {
      pluck(bar(b) + MOTIF[mi] * (SPB / 4), seq[mi % 4], SPB / 3, B.leadB, { vel: 0.22, pan: mi % 2 ? 0.35 : -0.35 })
    }
  }
  pingpong(B.leadB, SPB * 0.75, 0.4)
  tom(bar(15) + SPB * 2, 140, 0.55)
  tom(bar(15) + SPB * 2.5, 110, 0.65)
  // final sustained sub + crash into the fade
  bassNote(29.0, Dm.root, 0.9, 0.9)
  supersaw(29.0, Dm.root * 2, 0.5, B.padB, { voices: 3, det: 0.005, fc: 900, att: 0.1, rel: 0.4, vel: 0.3, pan: 0 })
}

// --- per-option finalize: sidechain, mixdown, gaps, fade, normalize, wav -------
function finalize(outPath, gains = {}) {
  const { bass = 0.95, lead = 0.8, pad = 0.55, fx = 0.85 } = gains
  const duck = new Float32Array(N).fill(1)
  for (const t of B.kicks) {
    const s0 = Math.floor(t * SR)
    const len = Math.floor(0.27 * SR)
    for (let i = 0; i < len && s0 + i < N; i++) {
      const k = i / len
      const g = 0.3 + (0.7 * (1 - Math.exp(-4.6 * k))) / (1 - Math.exp(-4.6))
      if (g < duck[s0 + i]) duck[s0 + i] = g
    }
  }
  const master = [new Float32Array(N), new Float32Array(N)]
  for (let i = 0; i < N; i++) {
    const d = duck[i]
    for (let c = 0; c < 2; c++) {
      master[c][i] =
        B.drums[c][i] * 1.0 + B.bassB[c][i] * d * bass + B.leadB[c][i] * d * lead +
        B.padB[c][i] * d * pad + B.fxB[c][i] * fx
    }
  }
  for (const g of [3.75, 15.0, 26.25]) {
    const s0 = Math.floor((g - SPB / 2) * SR)
    const s1 = Math.floor(g * SR)
    const fadeN = Math.floor(0.012 * SR)
    for (let i = s0; i < s1 && i < N; i++) {
      const ramp = i < s0 + fadeN ? 1 - (i - s0) / fadeN : 0
      master[0][i] *= ramp
      master[1][i] *= ramp
    }
  }
  for (let i = Math.floor(29.5 * SR); i < N; i++) {
    const k = (i - 29.5 * SR) / (0.5 * SR)
    master[0][i] *= 1 - k
    master[1][i] *= 1 - k
  }
  let peak = 0
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 2; c++) {
      master[c][i] = Math.tanh(master[c][i] * 1.25) / 1.25
      const a = Math.abs(master[c][i])
      if (a > peak) peak = a
    }
  }
  const norm = 0.92 / peak
  const data = Buffer.alloc(N * 4)
  let rms = 0
  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, master[c][i] * norm))
      data.writeInt16LE(Math.round(v * 32767), i * 4 + c * 2)
      rms += v * v
    }
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(outPath, Buffer.concat([header, data]))
  console.log(`${outPath}: peak=${peak.toFixed(3)} rms=${Math.sqrt(rms / (N * 2)).toFixed(3)}`)
}

// --- render the three options --------------------------------------------------
mkdirSync(new URL('./music-options/', import.meta.url), { recursive: true })
const out = (name) => new URL(`./music-options/${name}`, import.meta.url)

fresh(); lcg = 0x9e3779b9; arrangeA(); finalize(out('option-a.wav'), { bass: 1.05, lead: 0.72, pad: 0.45, fx: 0.9 })
fresh(); lcg = 0x9e3779b9; arrangeB(); finalize(out('option-b.wav'), { bass: 0.9, lead: 0.85, pad: 0.6, fx: 0.85 })
fresh(); lcg = 0x9e3779b9; arrangeC(); finalize(out('option-c.wav'), { bass: 1.0, lead: 0.75, pad: 0.5, fx: 0.9 })
console.log('done')
