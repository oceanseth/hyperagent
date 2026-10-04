import { deflateSync } from 'node:zlib'
import { BRAND_BLUE, hexToRgb, htreeRects, MARK_DEPTH } from '#/lib/htree'

// 5x7 glyphs, bit 4 is the leftmost pixel. The card renders the title in
// capitals so a share link unfurls without a native font dependency.
const FONT: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01111, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b01111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01111, 0b10000, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  "'": [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
}

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c >>> 0
}

function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const typeBuf = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const WIDTH = 1200
const HEIGHT = 630

function poster(title: string) {
  const text = title.toUpperCase().replace(/[^A-Z0-9 .'&-]/g, ' ').replace(/\s+/g, ' ').trim()
  return text || 'SHARED CANVAS'
}

function wrap(text: string, maxChars: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const piece = word.slice(0, maxChars)
    const next = line ? `${line} ${piece}` : piece
    if (line && next.length > maxChars) {
      lines.push(line)
      line = piece
    } else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

export function renderOgCard(title: string) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3)
  const bg = Buffer.alloc(WIDTH * 3)
  for (let x = 0; x < WIDTH; x++) {
    bg[x * 3] = 27
    bg[x * 3 + 1] = 27
    bg[x * 3 + 2] = 27
  }
  for (let y = 0; y < HEIGHT; y++) bg.copy(rgb, y * WIDTH * 3)

  const ink = { r: 242, g: 242, b: 237 }
  const mute = { r: 168, g: 168, b: 160 }
  const fill = (x0: number, y0: number, w: number, h: number, color: { r: number; g: number; b: number }) => {
    const x1 = Math.min(WIDTH, x0 + w)
    const y1 = Math.min(HEIGHT, y0 + h)
    for (let y = Math.max(0, y0); y < y1; y++) {
      for (let x = Math.max(0, x0); x < x1; x++) {
        const i = (y * WIDTH + x) * 3
        rgb[i] = color.r
        rgb[i + 1] = color.g
        rgb[i + 2] = color.b
      }
    }
  }
  const draw = (text: string, x: number, y: number, scale: number, color: { r: number; g: number; b: number }) => {
    let cursor = x
    for (const ch of text) {
      const glyph = FONT[ch] ?? FONT[' ']
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy] & (1 << (4 - gx))) fill(cursor + gx * scale, y + gy * scale, scale, scale, color)
        }
      }
      cursor += 6 * scale
    }
  }
  const widthOf = (text: string, scale: number) => Math.max(0, text.length * 6 * scale - scale)

  const [br, bgc, bb] = hexToRgb(BRAND_BLUE)
  const blue = { r: br, g: bgc, b: bb }
  const markSize = 520
  for (const r of htreeRects(MARK_DEPTH, markSize)) fill(Math.round(r.x) + 40, Math.round(r.y) + 55, Math.round(r.w), Math.round(r.h), blue)
  const left = 560
  const region = WIDTH - left - 40

  const lines = wrap(poster(title), 14)
  const longest = Math.max(1, ...lines.map((line) => line.length))
  const scale = Math.max(6, Math.min(11, Math.floor(region / (longest * 6))))
  const lineGap = 10 * scale
  const block = lines.length * 7 * scale + (lines.length - 1) * (lineGap - 7 * scale)
  let y = Math.round((HEIGHT - block) / 2) - 10
  draw('HYPERAGENT', left + Math.round((region - widthOf('HYPERAGENT', 4)) / 2), y - 52, 4, blue)
  for (const line of lines) {
    draw(line, left + Math.round((region - widthOf(line, scale)) / 2), y, scale, ink)
    y += lineGap
  }
  const foot = 'HYPERAGENT.LOL'
  draw(foot, left + Math.round((region - widthOf(foot, 4)) / 2), HEIGHT - 78, 4, mute)

  const stride = WIDTH * 3
  const raw = Buffer.alloc((stride + 1) * HEIGHT)
  for (let row = 0; row < HEIGHT; row++) {
    raw[(stride + 1) * row] = 0
    rgb.copy(raw, (stride + 1) * row + 1, row * stride, (row + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(WIDTH, 0)
  ihdr.writeUInt32BE(HEIGHT, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = deflateSync(raw, { level: 6 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
