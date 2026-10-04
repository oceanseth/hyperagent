import type { CSSProperties } from 'react'
import { BRAND_BLUE, depthForSize, htreePath } from '#/lib/htree'

export function HTreeMark({ size = 24, color = BRAND_BLUE, depth, className, style }: { size?: number; color?: string; depth?: number; className?: string; style?: CSSProperties }) {
  const levels = depth ?? depthForSize(size)
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 1000 1000" aria-hidden="true">
      <path fill={color} d={htreePath(levels, 1000)} />
    </svg>
  )
}
