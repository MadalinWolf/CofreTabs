// make-audio.mjs — deterministic 30s synthwave trailer bed (trailer v2).
// 128 BPM: beat = 0.46875s, bar = 1.875s, 16 bars = 30.000s exactly.
// Key: D minor. Progression: Dm–Bb–F–C (looped twice), finale resolves on Dm.
// Structure (beat-locked to the visual scenes, drops land on cut points):
//   bar 1-2   (0.000-3.750)   intro: pad, ticks, noise riser, half-beat gap
//   bar 3-7   (3.750-13.125)  DROP 1: 4/4 kick, bass 8ths, stabs, arp
//   bar 8     (13.125-15.0)   fill: kicks + snare 16ths + riser, gap
//   bar 9-13  (15.000-24.375) DROP 2: crash, full band, supersaw lead melody
//   bar 14    (24.375-26.25)  breakdown: pad + riser + snare roll, gap
//   bar 15-16 (26.250-30.0)   FINAL: biggest drop, lead +12, fade 29.5-30.0
// Accents: crashes at 3.75 / 15.0 / 26.25 (+ light crash 21.125 theme flip).
// Deterministic (LCG noise) -> bit-identical rebuilds. Output: trailer.wav
// (44.1kHz, 16-bit, stereo, exactly 30.0s).
import { writeFileSync } from 'node:fs'

const SR = 44100
const DUR = 30
const N = SR * DUR
const BPM = 128
const SPB = 60 / BPM // 0.46875s per beat
const BAR = SPB * 4 // 1.875s per bar

// deterministic noise so the render is reproducible
let lcg = 0x9e3779b9
function rnd() {
  lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0
  return (lcg / 0x100000000) * 2 - 1
}

// --- buses: drums stay dry; melodic buses get sidechained --------------------
const drums = [new Float32Array(N), new Float32Array(N)]
const bassB = [new Float32Array(N), new Float32Array(N)]
const leadB = [new Float32Array(N), new Float32Array(N)]
const padB = [new Float32Array(N), new Float32Array(N)]
const fxB = [new Float32Array(N), new Float32Array(N)]

const kicks = [] // kick times -> sidechain envelope
const lp1 = (c) => ({ y: 0, tick(x) { this.y += (x - this.y) * c; return this.y } })
const onePoleC = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR)

// --- drums -------------------------------------------------------------------
function kick(t, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.3 * SR)
  let ph = 0
  const c = onePoleC(3200)
  const tone = lp1(c)
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const f = 48 + 130 * Math.exp(-k * 40) // 178 -> 48 Hz pitch drop
    ph += (2 * Math.PI * f) / SR
    const env = Math.exp(-k * 13) * (1 - Math.exp(-k * 800))
    const click = k < 0.005 ? tone.tick(rnd()) * 0.7 * (1 - k / 0.005) : 0
    const s = (Math.sin(ph) + click) * env * vel
    drums[0][s0 + i] += s
    drums[1][s0 + i] += s
  }
  kicks.push(t)
}

function snare(t, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.22 * SR)
  const bp = lp1(onePoleC(2600))
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const n = rnd()
    const band = n - bp.tick(n) // crude highpass
    const tone = Math.sin(2 * Math.PI * 188 * k) * Math.exp(-k * 42)
    const env = Math.exp(-k * 24) * (1 - Math.exp(-k * 600))
    const s = (band * 0.85 + tone * 0.55) * env * vel * 0.85
    drums[0][s0 + i] += s * 0.92
    drums[1][s0 + i] += s * 1.0
  }
}

function hat(t, vel = 1, open = false) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor((open ? 0.19 : 0.055) * SR)
  const hp = lp1(onePoleC(5200))
  let prev = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const n = rnd()
    const h = 0.9 * (hp.y + n - prev) // highpass
    hp.y += (n - hp.y) * onePoleC(6000) * 0 // keep structure simple
    prev = n
    const env = Math.exp(-k * (open ? 15 : 85))
    const s = h * env * vel * 0.34
    drums[0][s0 + i] += s * 0.8
    drums[1][s0 + i] += s * 1.0
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
    const k = i / SR
    const nA = rnd()
    const nB = rnd()
    const a = nA - hpA.tick(nA) * 0.6 - pA * 0.4
    pA = nA
    const b = nB - hpB.tick(nB) * 0.6 - pB * 0.4
    pB = nB
    const env = Math.exp(-k * 2.4) * (1 - Math.exp(-k * 300))
    drums[0][s0 + i] += a * env * vel * 0.5
    drums[1][s0 + i] += b * env * vel * 0.5
  }
}

// --- bass / supersaw voices --------------------------------------------------
function bassNote(t, f, dur, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const cLP = onePoleC(420)
  let ph = 0
  let ph2 = 0
  let ph3 = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    ph += f / SR
    ph2 += (f * 1.005) / SR
    ph3 += (f * 0.995) / SR
    const env = Math.min(1, k / 0.006) * Math.min(1, (dur - k) / 0.02) * Math.exp(-k * 1.2)
    let s =
      (2 * (ph % 1) - 1) * 0.5 + (2 * (ph2 % 1) - 1) * 0.3 + (2 * (ph3 % 1) - 1) * 0.3
    s += Math.sin(2 * Math.PI * (f / 2) * k) * 0.9 // sub
    s = Math.tanh(s * 1.4)
    s *= env * vel * 0.55
    bassB[0][s0 + i] += s
    bassB[1][s0 + i] += s
  }
  // one-pole LP applied crudely via running state
  // (bassLP): rewrite pass is not needed — tanh + low content is enough
  void cLP
}

function supersaw(t, f, dur, bus, opts = {}) {
  const { voices = 7, det = 0.006, pan = 0, att = 0.008, rel = 0.06, fc = 5200, vel = 0.5 } =
    opts
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

// --- fx: risers, booms, impacts ----------------------------------------------
function riser(t, dur, vel = 1) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(dur * SR)
  const lp = lp1(onePoleC(11000))
  let ph = 0
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / SR
    const p = k / dur
    const fc = 260 * Math.pow(34, p) // 260 -> ~8.8k Hz
    const c = onePoleC(fc)
    const n = rnd()
    const hp = n - lp.tick(n)
    lp.y += (n - lp.y) * 0.0001
    ph += (180 * Math.pow(7, p)) / SR
    const s = (hp * 0.7 + Math.sin(2 * Math.PI * ph * 0.001 * k) * 0.15) * p * p * vel * 0.55
    fxB[0][s0 + i] += s * (1 - p * 0.2)
    fxB[1][s0 + i] += s * (0.8 + p * 0.2)
    void c
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
    fxB[0][s0 + i] += s
    fxB[1][s0 + i] += s
  }
}

// --- harmony: one chord per bar ----------------------------------------------
const Dm = { root: 73.42, tri: [146.83, 174.61, 220.0] } // D F A
const Bb = { root: 58.27, tri: [116.54, 146.83, 174.61] } // Bb D F
const F = { root: 87.31, tri: [174.61, 220.0, 261.63] } // F A C
const C = { root: 65.41, tri: [130.81, 164.81, 196.0] } // C E G
const CHORDS = [Dm, Dm, Bb, Bb, F, F, C, C, Dm, Dm, Bb, Bb, F, C, Dm, Dm]
const bar = (i) => i * BAR

// ================================================================= arrangement
// bar 1-2 intro -----------------------------------------------------------
crash(0.0, 0.5, 2.4)
supersaw(bar(0), Dm.tri[0] / 2, BAR * 2 - 0.1, padB, {
  voices: 7, det: 0.004, fc: 2600, att: 0.8, rel: 0.5, vel: 0.5, pan: -0.15,
})
supersaw(bar(0), Dm.tri[1] / 2, BAR * 2 - 0.1, padB, {
  voices: 5, det: 0.005, fc: 2400, att: 0.9, rel: 0.5, vel: 0.42, pan: 0.2,
})
bassNote(0.0, Dm.root, 1.6, 0.5)
bassNote(bar(1), Dm.root, 1.6, 0.55)
for (let i = 0; i < 16; i++) hat(bar(1) + i * (SPB / 4), 0.06 + i * 0.012)
riser(bar(1), BAR - SPB / 4, 0.85)

// bar 3-7 DROP 1 -----------------------------------------------------------
crash(bar(2), 0.9)
boom(bar(2), 0.9)
for (let b = 2; b <= 6; b++) {
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB
    kick(t, 1)
    if (q === 1 || q === 3) snare(t, 0.85)
    hat(t, 0.4)
    hat(t + SPB / 2, 0.5, true)
  }
  // bass 8ths
  const ch = CHORDS[b]
  for (let e = 0; e < 8; e++) {
    const t = bar(b) + e * (SPB / 2)
    if (b === 6 && e >= 6) continue // breathe before fill
    bassNote(t, e === 5 ? ch.root * 1.5 : ch.root, SPB / 2 - 0.01, e % 2 === 0 ? 1 : 0.8)
  }
}
// offbeat stabs from bar 4, arp from bar 5
for (let b = 3; b <= 6; b++) {
  const ch = CHORDS[b]
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB + SPB / 2
    for (const f of ch.tri) supersaw(t, f, 0.11, leadB, { voices: 5, det: 0.009, fc: 4200, vel: 0.3, pan: (q % 2 ? 0.3 : -0.3) })
  }
}
for (let b = 4; b <= 6; b++) {
  const ch = CHORDS[b]
  const seq = [...ch.tri, ch.tri[2] * 2]
  for (let s16 = 0; s16 < 16; s16++) {
    const t = bar(b) + s16 * (SPB / 4)
    if (b === 6 && s16 >= 12) continue
    supersaw(t, seq[s16 % 4], SPB / 4 - 0.005, leadB, { voices: 3, det: 0.01, fc: 6000, vel: 0.16, pan: -0.35 })
  }
}

// bar 8 fill (13.125-15.0) ---------------------------------------------------
kick(bar(7), 1)
kick(bar(7) + SPB, 0.9)
for (let s16 = 4; s16 < 16; s16++) {
  const t = bar(7) + s16 * (SPB / 4)
  snare(t, 0.35 + (s16 - 4) * 0.055)
  if (s16 >= 8) kick(t, 0.55)
}
riser(bar(7) + SPB, BAR - SPB - SPB / 4, 1.0)

// bar 9-13 DROP 2 (15.0-24.375) ---------------------------------------------
crash(bar(8), 1.0, 2.2)
boom(bar(8), 1.0)
for (let b = 8; b <= 12; b++) {
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB
    kick(t, 1)
    if (q === 1 || q === 3) snare(t, 0.9)
    hat(t, 0.42)
    hat(t + SPB / 2, 0.55, true)
  }
  const ch = CHORDS[b]
  for (let e = 0; e < 8; e++) {
    const t = bar(b) + e * (SPB / 2)
    bassNote(t, e === 5 ? ch.root * 1.5 : ch.root, SPB / 2 - 0.01, e % 2 === 0 ? 1 : 0.82)
  }
  // stabs on offbeats
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB + SPB / 2
    for (const f of ch.tri) supersaw(t, f, 0.1, leadB, { voices: 5, det: 0.009, fc: 4400, vel: 0.26, pan: (q % 2 ? 0.3 : -0.3) })
  }
}
// pad bed under drop 2
supersaw(bar(8), Dm.tri[0] / 2, BAR * 5 - 0.2, padB, { voices: 7, det: 0.004, fc: 2200, att: 0.3, rel: 0.4, vel: 0.34, pan: -0.2 })
supersaw(bar(8), F.tri[0], BAR * 5 - 0.2, padB, { voices: 5, det: 0.005, fc: 2000, att: 0.4, rel: 0.4, vel: 0.24, pan: 0.25 })

// lead melody: phrase time 0-20 beats over 15.0-24.375
const MEL = [
  [0.0, 440.0, 1.0], [1.0, 587.33, 0.5], [1.5, 698.46, 0.5], [2.0, 659.25, 1.0], [3.0, 587.33, 1.0],
  [4.0, 523.25, 1.0], [5.0, 440.0, 0.5], [5.5, 587.33, 0.5], [6.0, 698.46, 1.75],
  [8.0, 587.33, 1.0], [9.0, 698.46, 0.5], [9.5, 587.33, 0.5], [10.0, 466.16, 1.0], [11.0, 587.33, 1.0],
  [12.0, 698.46, 1.0], [13.0, 587.33, 0.5], [13.5, 523.25, 0.5], [14.0, 466.16, 1.75],
  [16.0, 440.0, 1.0], [17.0, 523.25, 0.5], [17.5, 440.0, 0.5], [18.0, 349.23, 1.0], [19.0, 440.0, 1.0],
]
for (const [b, f, d] of MEL) {
  const t = bar(8) + b * SPB
  supersaw(t, f, d * SPB - 0.02, leadB, { voices: 7, det: 0.007, fc: 5000, vel: 0.4, pan: 0.05 })
  supersaw(t, f * 0.5, d * SPB - 0.02, leadB, { voices: 5, det: 0.005, fc: 3600, vel: 0.22, pan: -0.1 })
}

// theme-flip accent 21.125s
crash(21.125, 0.55, 1.2)
boom(21.125, 0.6)

// bar 14 breakdown (24.375-26.25) --------------------------------------------
supersaw(bar(13), C.tri[0], BAR - 0.05, padB, { voices: 7, det: 0.005, fc: 2400, att: 0.25, rel: 0.4, vel: 0.5, pan: 0 })
supersaw(bar(13), C.tri[2], BAR - 0.05, padB, { voices: 5, det: 0.006, fc: 2200, att: 0.3, rel: 0.4, vel: 0.34, pan: 0.2 })
bassNote(bar(13), C.root, 1.7, 0.7)
riser(bar(13) + SPB, BAR - SPB - SPB / 8, 1.0)
for (let s16 = 8; s16 < 16; s16++) {
  const t = bar(13) + s16 * (SPB / 4)
  const step = s16 >= 14 ? 2 : 1 // tighten into 32nds
  if (s16 % step === 0) snare(t, 0.4 + (s16 - 8) * 0.07)
}

// bar 15-16 FINAL (26.25-30.0) -----------------------------------------------
crash(bar(14), 1.0, 2.6)
boom(bar(14), 1.1)
for (let b = 14; b <= 15; b++) {
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB
    kick(t, 1.05)
    if (q === 1 || q === 3) snare(t, 1)
    hat(t, 0.45)
    hat(t + SPB / 2, 0.6, true)
  }
  const ch = CHORDS[b]
  for (let e = 0; e < 8; e++) {
    const t = bar(b) + e * (SPB / 2)
    bassNote(t, e === 5 ? ch.root * 1.5 : ch.root, SPB / 2 - 0.01, e % 2 === 0 ? 1.05 : 0.85)
  }
  // 16th arp, wide
  const seq = [...ch.tri, ch.tri[2] * 2]
  for (let s16 = 0; s16 < 16; s16++) {
    supersaw(bar(b) + s16 * (SPB / 4), seq[s16 % 4], SPB / 4 - 0.004, leadB, { voices: 3, det: 0.01, fc: 6200, vel: 0.2, pan: s16 % 2 ? 0.4 : -0.4 })
  }
  for (let q = 0; q < 4; q++) {
    const t = bar(b) + q * SPB + SPB / 2
    for (const f of ch.tri) supersaw(t, f, 0.1, leadB, { voices: 5, det: 0.009, fc: 4600, vel: 0.3, pan: (q % 2 ? 0.3 : -0.3) })
  }
}
supersaw(bar(14), Dm.tri[0] / 2, BAR * 2 - 0.1, padB, { voices: 7, det: 0.004, fc: 2400, att: 0.15, rel: 0.3, vel: 0.4, pan: -0.15 })
// lead +12: phrase beats 24-32 (the C bars + resolution), ending on D6
const FINALE = MEL.filter(([b]) => b >= 16).map(([b, f, d]) => [b - 16, f, d]).concat([
  [4.0, 783.99, 1.25], [5.5, 698.46, 0.5], [6.0, 659.25, 1.0], [7.0, 587.33, 1.0],
])
for (const [b, f, d] of FINALE) {
  const tt = bar(14) + b * SPB
  supersaw(tt, f * 2, Math.min(d * SPB - 0.02, 29.5 - tt), leadB, { voices: 7, det: 0.008, fc: 5400, vel: 0.45, pan: 0.05 })
  supersaw(tt, f, Math.min(d * SPB - 0.02, 29.5 - tt), leadB, { voices: 5, det: 0.005, fc: 4000, vel: 0.25, pan: -0.1 })
}

// ================================================================== sidechain
const duck = new Float32Array(N).fill(1)
for (const t of kicks) {
  const s0 = Math.floor(t * SR)
  const len = Math.floor(0.27 * SR)
  for (let i = 0; i < len && s0 + i < N; i++) {
    const k = i / len
    const g = 0.3 + (0.7 * (1 - Math.exp(-4.6 * k))) / (1 - Math.exp(-4.6))
    if (g < duck[s0 + i]) duck[s0 + i] = g
  }
}

// ================================================================== mixdown
const master = [new Float32Array(N), new Float32Array(N)]
for (let i = 0; i < N; i++) {
  const d = duck[i]
  for (let c = 0; c < 2; c++) {
    master[c][i] =
      drums[c][i] * 1.0 +
      bassB[c][i] * d * 0.95 +
      leadB[c][i] * d * 0.8 +
      padB[c][i] * d * 0.55 +
      fxB[c][i] * 0.85
  }
}

// half-beat gaps right before each drop (silence = impact)
const GAPS = [3.75, 15.0, 26.25]
for (const g of GAPS) {
  const s0 = Math.floor((g - SPB / 2) * SR)
  const s1 = Math.floor(g * SR)
  const fade = Math.floor(0.012 * SR)
  for (let i = s0; i < s1 && i < N; i++) {
    const ramp = i < s0 + fade ? 1 - (i - s0) / fade : 0
    master[0][i] *= ramp
    master[1][i] *= ramp
  }
}
// fade out 29.5-30.0
for (let i = Math.floor(29.5 * SR); i < N; i++) {
  const k = (i - 29.5 * SR) / (0.5 * SR)
  master[0][i] *= 1 - k
  master[1][i] *= 1 - k
}

// soft clip + normalize
let peak = 0
for (let i = 0; i < N; i++) {
  for (let c = 0; c < 2; c++) {
    master[c][i] = Math.tanh(master[c][i] * 1.25) / 1.25
    const a = Math.abs(master[c][i])
    if (a > peak) peak = a
  }
}
const norm = 0.92 / peak

// WAV: 44.1kHz 16-bit stereo
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
writeFileSync(new URL('./trailer.wav', import.meta.url), Buffer.concat([header, data]))
console.log(
  `trailer.wav: ${DUR}s @ ${BPM}BPM (${CHORDS.length} bars), peak=${peak.toFixed(3)}, rms=${Math.sqrt(rms / (N * 2)).toFixed(3)}`
)
