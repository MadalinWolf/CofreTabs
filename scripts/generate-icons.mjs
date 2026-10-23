#!/usr/bin/env node
/**
 * Generates the CofreTabs extension icons.
 *
 * The icon is drawn on a 16x16 logical grid and scaled by an integer factor so
 * every size stays pixel-crisp: 16 (1x), 32 (2x), 48 (3x) and 128 (8x).
 * A dependency-free PNG encoder is used so the build has no native toolchain.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'assets/icons');
const GRID = 16;

const COLORS = {
  transparent: [0, 0, 0, 0],
  body: [16, 22, 16, 255],
  border: [57, 255, 114, 255],
  shutter: [5, 8, 5, 255],
  shutterLine: [32, 200, 90, 255],
  label: [5, 8, 5, 255],
  glyph: [57, 255, 114, 255],
};

const T = COLORS.transparent;

function createGrid() {
  return Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => T));
}

function fillRect(grid, x, y, w, h, color) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      if (row >= 0 && row < GRID && col >= 0 && col < GRID) grid[row][col] = color;
    }
  }
}

function setPixel(grid, x, y, color) {
  if (x >= 0 && x < GRID && y >= 0 && y < GRID) grid[y][x] = color;
}

function drawIcon() {
  const grid = createGrid();

  // Floppy body with a cut top-right corner.
  for (let y = 1; y <= 14; y += 1) {
    for (let x = 2; x <= 13; x += 1) {
      if ((x === 13 && y === 1) || (x === 13 && y === 2)) continue;
      fillRect(grid, x, y, 1, 1, COLORS.body);
    }
  }

  // Outline every body cell that touches empty space.
  const snapshot = grid.map((row) => row.map((cell) => cell === COLORS.body));
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!snapshot[y][x]) continue;
      const edge =
        !snapshot[y - 1]?.[x] ||
        !snapshot[y + 1]?.[x] ||
        !snapshot[y]?.[x - 1] ||
        !snapshot[y]?.[x + 1] ||
        y === 0 ||
        y === GRID - 1 ||
        x === 0 ||
        x === GRID - 1;
      if (edge) setPixel(grid, x, y, COLORS.border);
    }
  }

  // Shutter (top-right metal slide).
  fillRect(grid, 9, 2, 4, 4, COLORS.shutter);
  fillRect(grid, 9, 2, 4, 1, COLORS.shutterLine);
  fillRect(grid, 9, 2, 1, 4, COLORS.shutterLine);
  setPixel(grid, 11, 3, COLORS.shutterLine);
  setPixel(grid, 11, 4, COLORS.shutterLine);

  // Label area.
  fillRect(grid, 4, 7, 8, 6, COLORS.label);
  fillRect(grid, 4, 12, 8, 1, COLORS.shutterLine);

  // Terminal prompt: >_
  setPixel(grid, 5, 8, COLORS.glyph);
  setPixel(grid, 6, 9, COLORS.glyph);
  setPixel(grid, 5, 10, COLORS.glyph);
  fillRect(grid, 8, 10, 3, 1, COLORS.glyph);

  // Drive activity pixel.
  setPixel(grid, 7, 13, COLORS.border);

  return grid;
}

function scaleGrid(grid, scale) {
  const size = GRID * scale;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const color = grid[Math.floor(y / scale)][Math.floor(x / scale)];
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }
  return { size, rgba };
}

// ------------------------------------------------------------------ PNG encoding

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = size * 4;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (rowLength + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowLength + 1) + 1, y * rowLength, (y + 1) * rowLength);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------------- outputs

await mkdir(OUT_DIR, { recursive: true });
const grid = drawIcon();
const sizes = [
  [16, 1],
  [32, 2],
  [48, 3],
  [128, 8],
  [512, 32],
];

for (const [size, scale] of sizes) {
  const { rgba } = scaleGrid(grid, scale);
  const png = encodePng(size, rgba);
  const name = size === 512 ? 'icon512.png' : `icon${size}.png`;
  await writeFile(resolve(OUT_DIR, name), png);
  console.log(`Wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

console.log('Icons generated from the 16x16 CofreTabs floppy grid.');
