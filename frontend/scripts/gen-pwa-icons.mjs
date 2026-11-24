/**
 * gen-pwa-icons.mjs
 * Generates the PWA PNG icons for the guest site using only Node built-ins
 * (no dependencies). Draws an elegant two-interlocking-rings mark on a deep
 * sage background, matching the site palette (sage-700 on ivory/gold).
 *
 *   node scripts/gen-pwa-icons.mjs
 *
 * Writes public/icon-192.png, public/icon-512.png and
 * public/apple-touch-icon.png (180x180).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public');

// --- Minimal PNG encoder ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Artwork ---------------------------------------------------------------

// sage-700 #354835 background; ivory-50 #FDFBF7 and gold #E2D19E rings.
const BG = [0x35, 0x48, 0x35, 0xff];
const RING_A = [0xfd, 0xfb, 0xf7, 0xff];
const RING_B = [0xe2, 0xd1, 0x9e, 0xff];

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const cx1 = size * 0.44;
  const cx2 = size * 0.56;
  const cy = size * 0.5;
  const radius = size * 0.3;
  const thickness = Math.max(2, Math.round(size * 0.045));
  const inner = radius - thickness;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = Math.hypot(x + 0.5 - cx1, y + 0.5 - cy);
      const d2 = Math.hypot(x + 0.5 - cx2, y + 0.5 - cy);
      const in1 = d1 <= radius && d1 >= inner;
      const in2 = d2 <= radius && d2 >= inner;
      const i = (y * size + x) * 4;
      const col = in1 || in2 ? (in1 ? RING_A : RING_B) : BG;
      px[i] = col[0];
      px[i + 1] = col[1];
      px[i + 2] = col[2];
      px[i + 3] = col[3];
    }
  }
  return encodePng(size, px);
}

// --- Write -----------------------------------------------------------------

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(outDir, name), drawIcon(size));
  console.log(`Generated public/${name} (${size}x${size})`);
}

// Sanity: every PNG must start with the magic bytes.
for (const [name] of targets) {
  const buf = fs.readFileSync(path.join(outDir, name));
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error(`Bad PNG magic: ${name}`);
  }
}
console.log('All icons verified as valid PNGs.');