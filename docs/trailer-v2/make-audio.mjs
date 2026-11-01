// make-audio.mjs — regenerates the SHIPPED trailer v2 bed: option B
// "Neon Horizon" (retrowave anthem, F major) from make-audio-options.mjs.
// That script is the single source of truth for all three audition tracks;
// this wrapper re-renders them and promotes option B to ./trailer.wav.
// 128 BPM, exactly 30.000s — same beat grid + accent map as the cut map:
// crashes at 3.75/15.0/26.25, theme-flip accent 21.125, whip whooshes at
// 13.59375/20.625, gaps before drops, fade 29.5-30.0.
import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const gen = fileURLToPath(new URL('./make-audio-options.mjs', import.meta.url))
const r = spawnSync(process.execPath, [gen], { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)

const src = fileURLToPath(new URL('./music-options/option-b.wav', import.meta.url))
const dst = fileURLToPath(new URL('./trailer.wav', import.meta.url))
copyFileSync(src, dst)
console.log('trailer.wav <- option-b.wav (Neon Horizon)')
