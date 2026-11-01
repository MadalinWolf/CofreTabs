// extract-frames.mjs — pulls the exact footage windows the renderer needs,
// one JPEG per 30fps frame, into frames/<entry>/fNNNN.jpg, and writes
// frames/manifest.js for trailer.html.
//
// The cut map lives ONLY in trailer.html (const CUTS) — this script parses it
// out so the two can never drift. Entry ids like c12a/c17b map to source clips
// c12/c17 (a split entry = a jump cut inside one clip).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG = 'C:\\Users\\dinum\\AppData\\Local\\Temp\\ffmpeg-essentials\\ffmpeg-9.0.2-essentials_build\\bin\\ffmpeg.exe'
const ROOT = 'D:\\PROJECTS\\CofreTabs\\docs\\trailer-v2'
const CLIPS = join(ROOT, 'clips')
const FRAMES = join(ROOT, 'frames')
const BEAT = 60 / 128

// --- parse CUTS from trailer.html ------------------------------------------
const html = readFileSync(join(ROOT, 'trailer.html'), 'utf8')
const m = html.match(/const CUTS = \[([\s\S]*?)\n\]/)
if (!m) throw new Error('could not find CUTS table in trailer.html')
const CUTS = Function(`return [${m[1]}]`)()
console.log(`cut map: ${CUTS.length} entries`)

// --- clean + extract --------------------------------------------------------
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

// entry id -> clip filename stem. Old retake-2 files (c09-panel-close etc.)
// share prefixes with the kept names, so resolution is explicit, never globbed.
const CLIP_STEM = {
  c01: 'c01-idle', c02: 'c02-panel-open', c03: 'c03-save', c04: 'c04-search',
  c05: 'c05-clear', c06: 'c06-favorite', c07: 'c07-trash', c08: 'c08-open-tab',
  c09: 'c09-escape', c10: 'c10-library', c11: 'c11-scroll', c12: 'c12-note',
  c13: 'c13-move', c14: 'c14-theme', c15: 'c15-folders', c16: 'c16-folder',
  c17: 'c17-restore', c18: 'c18-search', c19: 'c19-clear', c20: 'c20-finale',
}

const manifest = {}
for (const c of CUTS) {
  let src = CLIP_STEM[c.id.replace(/[ab]$/, '')]
  if (!src) src = c.id
  const srcFile = join(CLIPS, src + '.mp4')
  if (!existsSync(srcFile)) throw new Error('missing clip: ' + srcFile)

  const span = (c.b1 - c.b0) * BEAT
  const start = Math.max(0, c.tIn - 0.3)
  const end = c.tIn + span + 0.3
  const outDir = join(FRAMES, c.id)
  mkdirSync(outDir, { recursive: true })

  execFileSync(FFMPEG, [
    '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3),
    '-i', srcFile, '-vf', 'fps=30', '-q:v', '3',
    join(outDir, 'f%04d.jpg'),
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const count = readdirSync(outDir).filter((f) => f.endsWith('.jpg')).length
  if (count < 2) throw new Error(`extract produced ${count} frames for ${c.id}`)
  manifest[c.id] = { src, start: +start.toFixed(3), count, fps: 30 }
  console.log(`  ${c.id.padEnd(5)} <- ${src}.mp4  [${start.toFixed(2)}s..${end.toFixed(2)}s]  ${count} frames`)
}

writeFileSync(join(FRAMES, 'manifest.js'), 'window.__MANIFEST = ' + JSON.stringify(manifest) + '\n')
const total = Object.values(manifest).reduce((s, m2) => s + m2.count, 0)
console.log(`manifest.js written — ${total} frames total`)
