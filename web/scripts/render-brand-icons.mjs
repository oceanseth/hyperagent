// Favicon, touch icon, OG default and SVG marks for the H-tree logo.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { BRAND_BLUE, MARK_DEPTH, htreeRaster, htreeSvg } from '../src/lib/htree.ts'
import { renderOgCard } from '../src/server/og-card.ts'

const OUT = new URL('../public/', import.meta.url).pathname
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length).copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
// Composite the mark over a solid tile (for touch icons, which get no alpha).
function tile(size, bg, markScale = 0.74, color = '#FFFFFF') {
  const inner = Math.round(size * markScale)
  const mark = htreeRaster(inner, MARK_DEPTH, color)
  const [r, g, b] = [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16), parseInt(bg.slice(5, 7), 16)]
  const out = new Uint8Array(size * size * 4)
  for (let i = 0; i < size * size; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255 }
  const off = Math.round((size - inner) / 2)
  for (let y = 0; y < inner; y++) for (let x = 0; x < inner; x++) {
    const a = mark[(y * inner + x) * 4 + 3] / 255; if (!a) continue
    const i = ((y + off) * size + (x + off)) * 4
    out[i] = Math.round(out[i] * (1 - a) + mark[(y * inner + x) * 4] * a)
    out[i + 1] = Math.round(out[i + 1] * (1 - a) + mark[(y * inner + x) * 4 + 1] * a)
    out[i + 2] = Math.round(out[i + 2] * (1 - a) + mark[(y * inner + x) * 4 + 2] * a)
  }
  return out
}
writeFileSync(OUT + 'favicon.svg', htreeSvg({ size: 32 }))
writeFileSync(OUT + 'favicon-16.png', png(16, 16, htreeRaster(16)))
writeFileSync(OUT + 'favicon-32.png', png(32, 32, htreeRaster(32)))
writeFileSync(OUT + 'apple-touch-icon.png', png(180, 180, tile(180, BRAND_BLUE)))
writeFileSync(OUT + 'icon-512.png', png(512, 512, tile(512, BRAND_BLUE)))
writeFileSync(OUT + 'og.png', renderOgCard('A little space for everything'))
for (const d of [1, 2, 3, 4, 5]) {
  writeFileSync(OUT + `brand/htree-${d}-blue.svg`, htreeSvg({ size: 1000, depth: d }))
  writeFileSync(OUT + `brand/htree-${d}-paper.svg`, htreeSvg({ size: 1000, depth: d, color: '#FFFFFF' }))
  writeFileSync(OUT + `brand/htree-${d}-ink.svg`, htreeSvg({ size: 1000, depth: d, color: '#0A0A0A' }))
}
console.log('icons written')
