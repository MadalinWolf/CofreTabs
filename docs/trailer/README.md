# CofreTabs — 30s trailer (synthwave)

Deterministic trailer pipeline: every frame is a pure function of time, so the
video is re-renderable byte-for-byte on any machine that has Chrome + ffmpeg
plus the source footage in `../trailer-v2/clips/` (committed).

## Outputs

| File | What |
|:--|:--|
| `cofretabs-trailer-1080p30.mp4` | H.264 + AAC, 1920×1080, 30fps, 30.0s — primary upload (stores, YouTube, X/Reddit) |
| `cofretabs-trailer-1080p30.webm` | VP9 + Opus, same timing — for listings that want WebM |
| `../trailer-v2/trailer.wav` | The synthwave bed (128 BPM, F major retrowave anthem "Neon Horizon", beat-locked to the scenes) |

## How it works (v2 — real footage in Chrome)

All pipeline files live in `../trailer-v2/`.

1. **Footage** — `setup.mjs` builds a recording copy of the extension
   (`CofreTabs-TRAILER`, patched with a keyboard command so the panel opens
   deterministically; the repo is never touched). `prep3.ps1` measures the live
   UI (panel / library / folder / editor coordinates → `coords3.json`) and
   verifies every fragile interaction path before recording. Then
   `record-retake3.ps1` + `record-retake3b.ps1` drive each scene over CDP
   (`cdp.mjs`) while ffmpeg `gdigrab` records the 1920×1080 desktop region —
   all input goes through CDP, so nothing depends on OS window focus. Every
   scene has a post-condition check; failed scenes never ship.
2. **Music** — `make-audio-options.mjs` synthesises three complete 30s
   arrangements from scratch (darksynth / retrowave anthem / cyber techno) as
   auditions; `make-audio.mjs` re-renders them and promotes the shipped pick —
   option B "Neon Horizon" — to `trailer.wav`. 128 BPM → beat = 0.46875s;
   crashes land on beats 8/32/56 (3.75 / 15.0 / 26.25s), theme-flip accent at
   21.125s, whip whooshes at 13.594 / 20.625s — so every choice stays
   beat-synced with the cut map.
3. **Cut map** — `trailer.html` holds `const CUTS`: 22 entries, each pinned to
   a beat window and a footage second (`tIn`) chosen so key actions hit
   musical accents — library reveal on drop 2 at 15.0s, dark→light theme flip
   on the light crash at 21.125s, trash-restore toast before drop 3. CMD-style
   text overlays, zoom punches, whip pans, glitches and flashes all derive
   from the same beat map.
4. **Render** — `extract-frames.mjs` parses `CUTS` and pulls the exact footage
   windows into `frames/<id>/fNNNN.jpg` (+ `frames/manifest.js`);
   `capture-frames.mjs` drives headless Chrome over CDP, seeks
   `window.__seek(t)` to each of 900 frames (30fps × 30s) and screenshots it
   into `rendered/`.
5. **Encode** — ffmpeg assembles frames + WAV:

```powershell
ffmpeg -y -framerate 30 -i rendered\frame_%04d.jpg -i trailer.wav -af volume=-2dB `
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.1 `
  -c:a aac -b:a 192k -ar 44100 -shortest -movflags +faststart cofretabs-trailer-1080p30.mp4

ffmpeg -y -framerate 30 -i rendered\frame_%04d.jpg -i trailer.wav -af volume=-2dB `
  -c:v libvpx-vp9 -crf 30 -b:v 0 -pix_fmt yuv420p -row-mt 1 -deadline good -cpu-used 2 `
  -c:a libopus -b:a 160k -ar 48000 -shortest cofretabs-trailer-1080p30.webm
```

## Verify

- ffprobe both files: ≈30.0s, 1920×1080, 30/1 fps, h264+aac / vp9+opus.
- Full decode to null with no errors.
- `volumedetect` on the audio: mean ≈ −12 dB, peak ≤ 0 dB (soft-clipped master).
- A 1fps contact sheet of the encoded MP4 reviewed frame by frame
  (`../trailer-v2/review/sheet30-*.jpg`).

## Copy / claims

All text on screen is verified against the v1.1.0 release: the real tagline,
real features (save panel, library, search, folders, favorites, notes, trash,
dark/light themes), local-only behaviour, MIT license, and the GitHub URL.
"Chrome 102+ · Edge · Brave · Vivaldi · Opera" matches `README.md`
(Chromium browsers with Manifest V3 support — not store availability).

## v1 history

The v1 pipeline (synthwave neon-type scenes over three static screenshots,
96 BPM A minor) is kept in this folder for history: `trailer.html`,
`make-audio.mjs`, `capture-frames.mjs`, `trailer.wav` and `assets/` here are
the v1 versions. The current outputs are produced entirely by `../trailer-v2`.

`frames/`, `frames-smoke/` and `check-*.jpg` are scratch artifacts (gitignored);
same for `frames/`, `rendered/`, `review/` and calibration screenshots in
`../trailer-v2/`.
