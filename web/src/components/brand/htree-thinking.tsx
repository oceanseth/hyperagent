import { useMemo, type CSSProperties } from 'react'
import { BRAND_BLUE, htreeSegments, mixHex, round } from '#/lib/htree'

// The "thinking" indicator: the H-tree growing level by level from a single H,
// like the classic fractal construction, then fading to start over. Each
// segment is a rect that scales out from its own center along its axis, so the
// tree looks like it is branching rather than fading in. Timing lives in
// styles.css under .htree-thinking; this component only lays out the geometry
// and the per-level colors.

// Textbook H-tree proportions (child arm = parent / √2) so the growth reads as
// the fractal itself, not the compact brand mark.
const THINK_OPTIONS = { ratio: Math.SQRT1_2, core: 0.12, taper: 0.8, margin: 0.03 }

export const THINKING_DEPTH = 4

/** Deepest level the CSS has keyframes for (see styles.css). */
const MAX_LEVEL = 5

export function HTreeThinking({
  size = 16,
  depth = THINKING_DEPTH,
  from = BRAND_BLUE,
  to = '#A9C0FF',
  label = 'Thinking',
  className,
  style,
}: {
  size?: number
  depth?: number
  /** Color of the root H. Defaults to brand blue. */
  from?: string
  /** Color of the outermost tips. Defaults to a pale blue that reads on the dark canvas. */
  to?: string
  /** Accessible label; pass an empty string to render purely decorative. */
  label?: string
  className?: string
  style?: CSSProperties
}) {
  const levels = Math.min(depth, MAX_LEVEL)
  const segments = useMemo(() => htreeSegments(levels, 1000, THINK_OPTIONS), [levels])
  const colors = useMemo(() => Array.from({ length: levels + 1 }, (_, l) => mixHex(from, to, levels === 0 ? 0 : l / levels)), [from, to, levels])

  return (
    <svg
      className={['htree-thinking', className].filter(Boolean).join(' ')}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 1000 1000"
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      data-levels={levels}
    >
      {segments.map((s, i) => (
        <rect
          key={i}
          x={round(s.x)}
          y={round(s.y)}
          width={round(s.w)}
          height={round(s.h)}
          fill={colors[s.level]}
          data-level={s.level}
          data-axis={s.horizontal ? 'x' : 'y'}
        />
      ))}
    </svg>
  )
}
