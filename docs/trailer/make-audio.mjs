// make-audio.mjs — deterministic 30s synthwave trailer bed for the CofreTabs
// trailer. 96 BPM (beat = 0.625s, bar = 2.5s, 12 bars = 30.0s exactly), A
// minor, Am–F–C–G. Structure (beat-locked to the visual scenes):
//   bar 1-2   (0.0-5.0)   intro: pad, sparse hats, riser into the drop
//   bar 3-4   (5.0-10.0)  DROP: kick + bass, snare backbeat from bar 4
//   bar 5-8   (10.0-20.0) full groove + arp lead
//   bar 9     (20.0-22.5) breakdown: pad + delayed lead
//   bar 10    (22.5-25.0) build: snare roll + noise riser
//   bar 11-12 (25.0-30.0) final impact, full band, fade out 29-30
// Output: trailer.wav (44.1kHz, 16-bit, stereo, exactly 30.0s).
import { writeFileSync } from 'node:fs'

const SR = 44100
const DUR = 30
const N = SR * DUR
const BPM = 96
const SPB = 60 / BPM          // 0.625s per beat
const BAR = SPB * 4           // 2.5s per bar
const beat = (b) => b * SPB   // beat index -> seconds

// --- buses (drums stay dry; melodic buses get sidechained) ------------------
const drums = [new Float32Array(N), new Float32Array(N)]
const bassB = [new Float32Array(N), new Float32Array(N)]
const padB  = [new Float32Array(N), new Float32Array(N)]
const leadB = [new Float32Array(N), new Float32Array(N)]

// deterministic noise stream (mulberry32) so re-runs produce identical audio
let _s = 0xC0F7AB1E
function prnd() {
  _s = (_s + 0x6D2B79F5) | 0
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// write `len` seconds of generator output into a bus at `start` seconds
function add(bus, start, len, gen, gl = 1, gr = 1) {
  const s0 = Math.max(0, Math.round(start * SR))
  const s1 = Math.min(N, s0 + Math.round(len * SR))
  for (let i = s0; i < s1; i++) {
    const v = gen((i - s0) / SR, i)
    bus[0][i] += v * gl
    bus[1][i] += v * gr
  }
}

// --- drums -----------------------------------------------------------------
function kick(t0, gain = 1) {
  add(drums, t0, 0.42, (t) => {
    // pitch sweep 160 -> 45 Hz, closed form phase integral
    const phase = 45 * t + (115 * (1 - Math.exp(-28 * t))) / 28
    const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 7)
    const click = (prnd() * 2 - 1) * Math.exp(-t * 400) * 0.4
    return (body * 0.95 + click) * gain
  })
}

function snare(t0, gain = 1) {
  let last = 0
  add(drums, t0, 0.26, (t) => {
    const x = prnd() * 2 - 1
    const hp = x - last          // differencing = cheap high-pass
    last = x
    const n = hp * Math.exp(-t * 24) * 0.55
    const tone = Math.sin(2 * Math.PI * 191 * t) * Math.exp(-t * 20) * 0.35
    return (n + tone) * gain
  })
}

function hat(t0, gain = 1) {
  let last = 0
  add(drums, t0, 0.07, (t) => {
    const x = prnd() * 2 - 1
    const hp = x - last
    last = x
    return hp * Math.exp(-t * 90) * 0.35 * gain
  })
}

function crash(t0, gain = 1) {
  let last = 0
  add(drums, t0, 1.6, (t) => {
    const x = prnd() * 2 - 1
    const hp = x - last * 0.85
    last = x
    return hp * Math.exp(-t * 3.2) * 0.28 * gain
  })
}

function impact(t0, gain = 1) {
  add(drums, t0, 1.4, (t) => {
    const phase = 33 * t + (45 * (1 - Math.exp(-12 * t))) / 12
    const sub = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 3.4)
    const rumble = (prnd() * 2 - 1) * Math.exp(-t * 9) * 0.25
    return (sub + rumble) * 0.9 * gain
  })
}

function riser(t0, len, gain = 1) {
  let last = 0
  add(drums, t0, len, (t) => {
    const p = t / len
    const x = prnd() * 2 - 1
    const hp = x - last
    last = x
    const noise = hp * Math.pow(p, 1.7) * 0.5
    const f = 260 + 2300 * p * p
    const chirp = Math.sin(2 * Math.PI * f * t) * Math.pow(p, 2) * 0.18
    return (noise + chirp) * gain
  })
}

// --- sidechain envelope from the kick pattern ------------------------------
const SC = new Float32Array(N)
function buildSidechain(kicks) {
  SC.fill(1)
  for (const k of kicks) {
    const s0 = Math.round(k * SR)
    const s1 = Math.min(N, s0 + Math.round(0.3 * SR))
    for (let i = s0; i < s1; i++) {
      const t = (i - s0) / SR
      const d = 0.24 + 0.76 * (1 - Math.exp(-t * 16))
      if (d < SC[i]) SC[i] = d
    }
  }
}

// --- note helpers ----------------------------------------------------------
const NOTE = { A1: 55, F1: 43.65, C2: 65.41, G1: 49.0 }
// bar chord map (12 bars): Am F C G x3
const ROOTS = [NOTE.A1, NOTE.F1, NOTE.C2, NOTE.G1]
const VOICE = {
  0: [220, 261.63, 329.63],   // Am: A3 C4 E4
  1: [174.61, 220, 261.63],   // F:  F3 A3 C4
  2: [196, 261.63, 329.63],   // C:  G3 C4 E4
  3: [196, 246.94, 293.66],   // G:  G3 B3 D4
}
const chordOf = (barIdx) => ROOTS[barIdx % 4]

function bassNote(t0, len, freq, gain = 1) {
  let lp1 = 0, lp2 = 0
  const a = 1 - Math.exp((-2 * Math.PI * 520) / SR)
  add(bassB, t0, len, (t) => {
    const ph = (freq * t) % 1
    const saw = 2 * ph - 1
    let y = lp1 + a * (saw - lp1); lp1 = y
    y = lp2 + a * (y - lp2); lp2 = y
    const atk = Math.min(1, t * 120)
    const rel = len - t < 0.02 ? Math.max(0, (len - t) / 0.02) : 1
    return y * atk * rel * gain
  })
}

function padChord(t0, len, tones, gain = 1) {
  for (let ti = 0; ti < tones.length; ti++) {
    const f = tones[ti]
    const spread = ti === 1 ? 0.35 : ti === 0 ? -0.5 : 0.6
    for (const det of [-6, 7]) {
      let lp = 0
      const a = 1 - Math.exp((-2 * Math.PI * 1500) / SR)
      const fd = f * Math.pow(2, det / 1200)
      add(padB, t0, len, (t) => {
        const ph = (fd * t) % 1
        const saw = 2 * ph - 1
        lp = lp + a * (saw - lp)
        const atk = 1 - Math.exp(-t * 4)
        const rel = len - t < 0.5 ? Math.max(0, (len - t) / 0.5) : 1
        return lp * atk * rel * gain
      }, 1 - Math.max(0, spread) * 0.7, 1 - Math.max(0, -spread) * 0.7)
    }
  }
}

function pluck(t0, freq, gain = 1) {
  let lp = 0
  const a = 1 - Math.exp((-2 * Math.PI * 2600) / SR)
  add(leadB, t0, 0.3, (t) => {
    const ph = (freq * t) % 1
    const saw = 2 * ph - 1
    const sq = ph < 0.5 ? 1 : -1
    lp = lp + a * ((saw * 0.7 + sq * 0.3) - lp)
    const env = Math.exp(-t * 11) * Math.min(1, t * 400)
    return lp * env * gain
  })
}

// ============================================================================
// ARRANGEMENT
// ============================================================================
const kicks = []
const kickTimes = []
const hatTimes = []

// Intro bars 1-2 (0-5s): pad every bar, hats from beat 4 (2.5s), riser 4-5
for (let bar = 0; bar < 2; bar++) {
  padChord(bar * BAR, BAR, VOICE[bar % 4], 0.05)
}
for (let b = 4; b < 8; b += 2) hatTimes.push({ t: beat(b), g: 0.5 })
riser(4.0, 1.0, 0.8)

// Groove bars 3-8 (5-20s): kick 4-on-floor from 5.0, snare backbeat from 7.5,
// hats eighths from 5.0, bass eighths all groove bars
for (let bar = 2; bar < 8; bar++) {
  const t0 = bar * BAR
  const root = chordOf(bar)
  padChord(t0, BAR, VOICE[bar % 4], 0.045)
  for (let q = 0; q < 4; q++) {
    const kt = t0 + q * SPB
    kick(kt, 1)
    kicks.push(kt); kickTimes.push(kt)
  }
  if (bar >= 3) { snare(t0 + SPB, 0.9); snare(t0 + 3 * SPB, 0.9) }
  for (let e = 0; e < 8; e++) {
    hatTimes.push({ t: t0 + e * (SPB / 2), g: e % 2 === 0 ? 0.9 : 0.55 })
    const oct = e === 7 ? 2 : 1
    bassNote(t0 + e * (SPB / 2), SPB / 2 * 0.92, root * oct, 0.5)
  }
}
crash(5.0, 1)
crash(10.0, 0.7)
crash(15.0, 0.7)
impact(5.0, 1)

// Lead arp: bars 5-8 (10-20s)
const ARP = { 0: [0, 3, 7, 12], 1: [0, 4, 7, 12], 2: [0, 4, 7, 11], 3: [0, 4, 7, 11] }
for (let bar = 4; bar < 8; bar++) {
  const t0 = bar * BAR
  const root = chordOf(bar) * 4 // arp in octave 4-5
  const pat = ARP[bar % 4]
  for (let e = 0; e < 8; e++) {
    const semi = pat[e % 4] + (e >= 4 ? 12 : 0)
    pluck(t0 + e * (SPB / 2), root * Math.pow(2, semi / 12), 0.5)
  }
}

// Breakdown bar 9 (20-22.5): pad + slow lead, no drums; reverse swell 21.5-22.5
padChord(20, 2.5, VOICE[0], 0.06)
for (let e = 0; e < 4; e++) pluck(20 + e * SPB, 220 * Math.pow(2, [0, 7, 3, 12][e] / 12), 0.45)
riser(21.6, 0.9, 0.5)

// Build bar 10 (22.5-25): kick on quarters from 22.5, snare roll accelerating
padChord(22.5, 2.5, VOICE[1], 0.05)
for (let q = 0; q < 4; q++) { const kt = 22.5 + q * SPB; kick(kt, 0.85); kicks.push(kt); kickTimes.push(kt) }
const roll = []
for (let t = 23.75; t < 24.375 - 1e-6; t += 0.3125) roll.push(t)
for (let t = 24.375; t < 24.6875 - 1e-6; t += 0.15625) roll.push(t)
for (let t = 24.6875; t < 24.98 - 1e-6; t += 0.078125) roll.push(t)
roll.forEach((t, i) => snare(t, 0.35 + (0.6 * i) / roll.length))
riser(23.4, 1.6, 0.9)

// Final bars 11-12 (25-30): full band, impact, fade handled on master
for (let bar = 10; bar < 12; bar++) {
  const t0 = bar * BAR
  const root = chordOf(bar)
  padChord(t0, BAR, VOICE[bar % 4], 0.05)
  for (let q = 0; q < 4; q++) { const kt = t0 + q * SPB; kick(kt, 1); kicks.push(kt); kickTimes.push(kt) }
  snare(t0 + SPB, 0.9); snare(t0 + 3 * SPB, 0.9)
  for (let e = 0; e < 8; e++) {
    hatTimes.push({ t: t0 + e * (SPB / 2), g: e % 2 === 0 ? 0.9 : 0.55 })
    if (bar === 10 || e < 6) bassNote(t0 + e * (SPB / 2), (SPB / 2) * 0.92, root * (e === 7 ? 2 : 1), 0.5)
  }
  if (bar === 10) {
    const pat = ARP[bar % 4]
    for (let e = 0; e < 8; e++) {
      const semi = pat[e % 4] + (e >= 4 ? 12 : 0)
      pluck(t0 + e * (SPB / 2), root * 4 * Math.pow(2, semi / 12), 0.5)
    }
  }
}
crash(25.0, 1.1)
impact(25.0, 1.1)
// final chord sustain into the fade
padChord(27.5, 2.5, VOICE[0], 0.055)

// hats (all queued times)
for (const h of hatTimes) if (h.t < DUR) hat(h.t, h.g)

buildSidechain(kicks)

// --- ping-pong delay on the lead -------------------------------------------
const leadOut = [new Float32Array(N), new Float32Array(N)]
leadOut[0].set(leadB[0]); leadOut[1].set(leadB[1])
const d1 = Math.round((SPB / 2) * SR)
const fb = [0.5, 0.3, 0.18, 0.1]
for (let k = 1; k <= 4; k++) {
  const off = d1 * k
  const g = fb[k - 1]
  const dest = k % 2 === 1 ? 1 : 0
  for (let i = off; i < N; i++) leadOut[dest][i] += leadB[0][i - off] * g
}

// --- mix --------------------------------------------------------------------
const out = [new Float32Array(N), new Float32Array(N)]
for (let i = 0; i < N; i++) {
  const sc = SC[i]
  const t = i / SR
  for (let c = 0; c < 2; c++) {
    let v = drums[c][i] * 0.9
    v += bassB[c][i] * sc * 1.15
    v += padB[c][i] * (0.5 + 0.5 * sc)
    v += leadOut[c][i] * (0.42 + 0.58 * sc) * 0.62
    // master fade in/out
    let m = 1
    if (t < 0.25) m = t / 0.25
    if (t > 29) m = Math.max(0, (30 - t) / 1) ** 1.5
    out[c][i] = Math.tanh(v * 1.05) * m
  }
}

// normalize to -1 dBFS
let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(out[0][i]), Math.abs(out[1][i]))
const norm = 0.891 / Math.max(peak, 1e-9)

// --- WAV writer (16-bit PCM stereo) ----------------------------------------
const buf = Buffer.alloc(44 + N * 4)
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8)
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28)
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40)
let rms = 0
for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, out[0][i] * norm))
  const r = Math.max(-1, Math.min(1, out[1][i] * norm))
  buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4)
  buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4)
  rms += l * l
}
writeFileSync('trailer.wav', buf)
console.log(`trailer.wav written: ${DUR}s, ${SR}Hz stereo, peak=${(0.891).toFixed(2)}, rms=${Math.sqrt(rms / N).toFixed(3)}`)
