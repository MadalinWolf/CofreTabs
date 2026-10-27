# CofreTabs — 30s trailer (synthwave)

Deterministic trailer pipeline: every frame is a pure function of time, so the
video is re-renderable byte-for-byte on any machine that has Chrome + ffmpeg.

## Outputs

| File | What |
|:--|:--|
| `cofretabs-trailer-1080p30.mp4` | H.264 + AAC, 1920×1080, 30fps, 30.0s — primary upload (stores, YouTube, X/Reddit) |
| `cofretabs-trailer-1080p30.webm` | VP9 + Opus, same timing — for listings that want WebM |
| `trailer.wav` | The synthwave bed (96 BPM, A minor, beat-locked to the scenes) |

## How it works

1. `make-audio.mjs` synthesises the 30s music bed from scratch (kick/snare/hats,
   sidechained bass, pad, ping-pong arp lead, risers/impacts) → `trailer.wav`.
   Beat = 0.625s, bar = 2.5s, 12 bars = exactly 30.0s.
2. `trailer.html` renders any frame `t` on a canvas via `window.__seek(t)` —
   retro sun, perspective grid, mountains, neon type, VHS scanlines/glitches,
   and the three real screenshots from `assets/` (v1.1.0 UI captures).
   Scene cuts sit on bar/beat boundaries, so visuals hit with the music.
3. `capture-frames.mjs` drives headless Chrome over CDP: seeks 900 frames
   (30fps) and screenshots each → `frames/frame_0000.jpg … frame_0899.jpg`.
   `node capture-frames.mjs --smoke` captures 14 cue frames instead (fast QA).
4. ffmpeg assembles frames + WAV:

```powershell
ffmpeg -y -framerate 30 -i frames\frame_%04d.jpg -i trailer.wav `
  -af volume=-2dB -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p `
  -profile:v high -level 4.1 -c:a aac -b:a 192k -ar 44100 `
  -shortest -movflags +faststart cofretabs-trailer-1080p30.mp4
```

## Copy / claims

All text on screen is verified against the v1.1.0 release: the real tagline,
real features (save panel, library, search, folders, favorites, notes, trash,
dark/light themes), local-only behaviour, MIT license, and the GitHub URL.
"Chrome 102+ · Edge · Brave · Vivaldi · Opera" matches `README.md`
(Chromium browsers with Manifest V3 support — not store availability).

## Regenerating

```powershell
node make-audio.mjs        # 1. music
node capture-frames.mjs    # 2. frames (needs Chrome, ~2.5 min)
# 3. ffmpeg command above (needs ffmpeg on PATH or full path)
```

`frames/`, `frames-smoke/` and `check-*.jpg` are scratch artifacts (gitignored).
