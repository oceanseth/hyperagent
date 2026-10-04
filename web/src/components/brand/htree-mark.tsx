import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { BRAND_BLUE, MARK_DEPTH, htreePath, htreeSvg } from '#/lib/htree'

// Paper Shaders' dithering, loaded on first hover so the mark costs nothing until then.
const Dithering = lazy(() => import('@paper-design/shaders-react').then((m) => ({ default: m.Dithering })))

const DITHER_FADE_MS = 320

export function HTreeMark({ size = 24, color = BRAND_BLUE, depth, className, style, dither = false }: { size?: number; color?: string; depth?: number; className?: string; style?: CSSProperties; dither?: boolean }) {
  const levels = depth ?? MARK_DEPTH
  const ref = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Hovering the surrounding link (mark + wordmark) counts as hovering the mark.
  useEffect(() => {
    const target = dither ? (ref.current?.closest('a') ?? ref.current) : null
    if (!target) return
    const enter = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      setMounted(true)
      setHovered(true)
    }
    const leave = () => setHovered(false)
    target.addEventListener('pointerenter', enter)
    target.addEventListener('pointerleave', leave)
    return () => {
      target.removeEventListener('pointerenter', enter)
      target.removeEventListener('pointerleave', leave)
    }
  }, [dither])

  // Unmount the WebGL canvas once the fade-out finishes so idle marks run no shader.
  useEffect(() => {
    if (hovered || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), DITHER_FADE_MS)
    return () => window.clearTimeout(timer)
  }, [hovered, mounted])

  const mask = useMemo(() => `url("data:image/svg+xml,${encodeURIComponent(htreeSvg({ size: 1000, depth: levels, color: '#000' }))}") 0 0 / 100% 100% no-repeat`, [levels])
  const svg = (
    <svg className={dither ? undefined : className} style={dither ? undefined : style} width={size} height={size} viewBox="0 0 1000 1000" aria-hidden="true">
      <path fill={color} d={htreePath(levels, 1000)} />
    </svg>
  )
  if (!dither) return svg

  return (
    <span ref={ref} className={['htree-mark', className].filter(Boolean).join(' ')} data-dither={hovered} style={{ width: size, height: size, ...style }}>
      {svg}
      {mounted && (
        <Suspense fallback={null}>
          <Dithering
            className="htree-mark-dither"
            style={{ mask, WebkitMask: mask }}
            colorBack="#00000000"
            colorFront="#7FA2FF"
            shape="warp"
            type="4x4"
            size={1}
            scale={0.5}
            speed={0.35}
            minPixelRatio={2}
          />
        </Suspense>
      )}
    </span>
  )
}
