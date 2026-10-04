import { BRAND_BLUE, depthForSize, htreePath } from '#/lib/htree'

export function HTreeMark({ size = 24, color = BRAND_BLUE, depth, className }: { size?: number; color?: string; depth?: number; className?: string }) {
  const levels = depth ?? depthForSize(size)
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 1000 1000" aria-hidden="true">
      <path fill={color} d={htreePath(levels, 1000)} />
    </svg>
  )
}
