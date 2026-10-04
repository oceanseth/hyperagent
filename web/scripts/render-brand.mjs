// Renders Hyperagent brand assets: H-tree fractal sigil (SVG) and 4x4 Bayer-dithered
// fields (PNG) that mirror @paper-design/shaders-react <Dithering type="4x4" />.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../public/brand/', import.meta.url).pathname;

// ---------- minimal PNG encoder ----------
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- Bayer 4x4 ordered dithering ----------
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function dither({ w, h, field, back, front, size = 4, alphaBack = 255, name }) {
  const b = hex(back), f = hex(front); const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.min(1, Math.max(0, field(x / w, y / h)));
    const t = (BAYER4[Math.floor(y / size) % 4][Math.floor(x / size) % 4] + 0.5) / 16;
    const on = v > t; const c = on ? f : b; const i = (y * w + x) * 4;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = on ? 255 : alphaBack;
  }
  writeFileSync(OUT + name, png(w, h, out)); console.log('wrote', name);
}

// shader "sphere" shape: lit ball, soft falloff
const sphere = (u, v) => { const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy) / 0.46; if (r > 1) return 0.06 * (1 - Math.min(1, (r - 1) * 3)); const z = Math.sqrt(1 - r * r); const l = (-dx * 1.3 - dy * 1.6 + z * 0.9) / 1.4; return 0.15 + 0.85 * Math.max(0, l); };
// shader "ripple" shape
const ripple = (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5); return 0.5 + 0.5 * Math.cos(r * 60 - 1) * (1 - Math.min(1, r * 1.6)); };
// Julia set escape-time field, c = -0.8 + 0.156i
const julia = (u, v) => { let zx = (u - 0.5) * 3.2, zy = (v - 0.5) * 3.2; const cx = -0.8, cy = 0.156; let n = 0; while (n < 48 && zx * zx + zy * zy < 4) { const t = zx * zx - zy * zy + cx; zy = 2 * zx * zy + cy; zx = t; n++; } return n >= 48 ? 1 : Math.pow(n / 48, 0.6) * 0.75; };
const circle = (fn, pad = 0.02) => (u, v) => (Math.hypot(u - 0.5, v - 0.5) > 0.5 - pad ? 0 : fn(u, v));

const W = 1024;
dither({ w: W, h: W, field: sphere, back: '#0A0A0A', front: '#FFCC00', name: 'dither-sphere-yellow.png' });
dither({ w: W, h: W, field: sphere, back: '#0A0A0A', front: '#FFFFFF', name: 'dither-sphere-white.png' });
dither({ w: W, h: W, field: ripple, back: '#0A0A0A', front: '#FFCC00', name: 'dither-ripple-yellow.png' });
dither({ w: W, h: W, field: circle(julia), back: '#0A0A0A', front: '#FFCC00', alphaBack: 0, name: 'dither-julia-yellow.png' });
dither({ w: W, h: W, field: circle(julia), back: '#FFFFFF', front: '#0A0A0A', alphaBack: 0, name: 'dither-julia-ink.png' });
dither({ w: 1600, h: 480, field: (u, v) => sphere(u * 1600 / 480 - 1.17, v), back: '#0A0A0A', front: '#FFCC00', size: 3, name: 'dither-banner.png' });

// ---------- H-tree fractal sigil (SVG) ----------
function htree(depth, size = 1000) {
  const segs = [];
  const rec = (x, y, len, d) => {
    const h = len / 2;
    segs.push([x - h, y, x + h, y]);             // crossbar
    segs.push([x - h, y - h, x - h, y + h]);     // left stem
    segs.push([x + h, y - h, x + h, y + h]);     // right stem
    if (d === 0) return;
    const nl = len / Math.SQRT2;
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) rec(x + sx * h, y + sy * h, nl, d - 1);
  };
  rec(size / 2, size / 2, size * 0.5, depth);
  return segs;
}
function hsvg(depth, stroke, strokeWidth, size = 1000) {
  const d = htree(depth, size).map(([a, b, c, e]) => `M${a.toFixed(1)} ${b.toFixed(1)}L${c.toFixed(1)} ${e.toFixed(1)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none"><path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="square"/></svg>`;
}
for (const [depth, sw] of [[2, 44], [3, 34], [4, 22], [5, 12]]) {
  writeFileSync(OUT + `htree-${depth}-ink.svg`, hsvg(depth, '#0A0A0A', sw));
  writeFileSync(OUT + `htree-${depth}-paper.svg`, hsvg(depth, '#FFFFFF', sw));
  writeFileSync(OUT + `htree-${depth}-yellow.svg`, hsvg(depth, '#FFCC00', sw));
  console.log('wrote htree depth', depth);
}
