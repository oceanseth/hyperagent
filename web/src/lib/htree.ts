// The Hyperagent mark: an H-tree fractal. One H whose four tips each grow a
// smaller, rotated H. Every segment is axis-aligned with square caps, so the
// whole mark is a list of rectangles that any renderer (SVG, PNG, canvas) can
// fill without a path library.

export const BRAND_BLUE = '#1A4FD6'

export type Rect = { x: number; y: number; w: number; h: number }

export type HTreeOptions = {
  /** Root stroke width as a fraction of the root arm length. */
  core?: number
  /** Stroke multiplier per level, so branches thin out toward the tips. */
  taper?: number
  /** Empty border as a fraction of size. */
  margin?: number
  /** Child arm length relative to the parent. 1/√2 is the textbook H-tree; smaller keeps the tips as clusters. */
  ratio?: number
}

/** The mark is one H whose tips each grow a single smaller H. Deeper trees exist as brand candidates but crowd the mark. */
export const MARK_DEPTH = 1

export type Segment = Rect & { level: number; horizontal: boolean }

/** Every segment of the tree, tagged with its level and orientation, so animations can grow the tree level by level. */
export function htreeSegments(depth: number, size = 1000, options: HTreeOptions = {}): Segment[] {
  // Deep trees need thinner, faster-tapering branches or the tips turn solid.
  const core = options.core ?? (depth <= 2 ? 0.22 : depth === 3 ? 0.18 : 0.14)
  const taper = options.taper ?? (depth <= 2 ? 0.7 : 0.55)
  const margin = options.margin ?? 0.04
  const ratio = options.ratio ?? 0.42
  // Each level adds half-arm * ratio^level to the extent, plus half the last
  // stroke, so size the root arm so the deepest tips land inside the margin.
  let reach = 0
  for (let level = 0; level <= depth; level++) reach += ratio ** level
  const rootArm = (size / 2 - size * margin) / (reach + core * taper ** depth)
  const rootLen = rootArm * 2
  const segments: Segment[] = []

  const line = (x1: number, y1: number, x2: number, y2: number, sw: number, level: number, horizontal: boolean) => {
    const h = sw / 2
    segments.push({
      x: Math.min(x1, x2) - h,
      y: Math.min(y1, y2) - h,
      w: Math.abs(x2 - x1) + sw,
      h: Math.abs(y2 - y1) + sw,
      level,
      horizontal,
    })
  }

  const grow = (cx: number, cy: number, len: number, horizontal: boolean, level: number) => {
    const sw = rootLen * core * taper ** level
    const half = len / 2
    if (horizontal) {
      line(cx - half, cy, cx + half, cy, sw, level, true)
      line(cx - half, cy - half, cx - half, cy + half, sw, level, false)
      line(cx + half, cy - half, cx + half, cy + half, sw, level, false)
    } else {
      line(cx, cy - half, cx, cy + half, sw, level, false)
      line(cx - half, cy - half, cx + half, cy - half, sw, level, true)
      line(cx - half, cy + half, cx + half, cy + half, sw, level, true)
    }
    if (level >= depth) return
    const next = len * ratio
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) grow(cx + sx * half, cy + sy * half, next, !horizontal, level + 1)
  }

  grow(size / 2, size / 2, rootLen, true, 0)
  return segments
}

export function htreeRects(depth: number, size = 1000, options: HTreeOptions = {}): Rect[] {
  return htreeSegments(depth, size, options).map(({ x, y, w, h }) => ({ x, y, w, h }))
}

export function htreePath(depth: number, size = 1000, options?: HTreeOptions) {
  return htreeRects(depth, size, options)
    .map((r) => `M${round(r.x)} ${round(r.y)}h${round(r.w)}v${round(r.h)}h${round(-r.w)}z`)
    .join('')
}

export function htreeSvg({ size = 1000, depth, color = BRAND_BLUE, options }: { size?: number; depth?: number; color?: string; options?: HTreeOptions }) {
  const levels = depth ?? MARK_DEPTH
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path fill="${color}" d="${htreePath(levels, size, options)}"/></svg>`
}

/** Coverage-sampled RGBA raster of the mark, transparent background. */
export function htreeRaster(size: number, depth = MARK_DEPTH, color = BRAND_BLUE, options?: HTreeOptions, samples = 4) {
  const rects = htreeRects(depth, size, options)
  const cover = new Float32Array(size * size)
  const s = samples
  const step = 1 / s
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(size, Math.ceil(r.x + r.w))
    const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(size, Math.ceil(r.y + r.h))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let hit = 0
        for (let sy = 0; sy < s; sy++) {
          const py = y + (sy + 0.5) * step
          if (py < r.y || py >= r.y + r.h) continue
          for (let sx = 0; sx < s; sx++) {
            const px = x + (sx + 0.5) * step
            if (px >= r.x && px < r.x + r.w) hit++
          }
        }
        const i = y * size + x
        cover[i] = Math.max(cover[i], hit / (s * s))
      }
    }
  }
  const [cr, cg, cb] = hexToRgb(color)
  const rgba = new Uint8Array(size * size * 4)
  for (let i = 0; i < cover.length; i++) {
    rgba[i * 4] = cr
    rgba[i * 4 + 1] = cg
    rgba[i * 4 + 2] = cb
    rgba[i * 4 + 3] = Math.round(cover[i] * 255)
  }
  return rgba
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Linear blend of two hex colors, t in [0, 1]. */
export function mixHex(a: string, b: string, t: number) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

export const round = (n: number) => Math.round(n * 100) / 100
