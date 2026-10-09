import { useEffect, useRef, useState } from 'react'
import type { CanvasMember } from '#/lib/canvas'
import { CURSOR_FADE_MS, CURSOR_INTERPOLATE_MS, dropStaleCursors, notePointer, worldPointFromTransform, type BoardCursor } from '#/lib/canvas-realtime'

type Tween = { fromX: number; fromY: number; toX: number; toY: number; started: number }

function place(tween: Tween, now: number, duration: number) {
  if (duration <= 0) return { x: tween.toX, y: tween.toY }
  const t = Math.min(1, (now - tween.started) / duration)
  return {
    x: tween.fromX + (tween.toX - tween.fromX) * t,
    y: tween.fromY + (tween.toY - tween.fromY) * t,
  }
}

export function CursorLayer({ cursors, presence }: { cursors: Record<string, BoardCursor>; presence: CanvasMember[] }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const tweens = useRef(new Map<string, Tween>())
  const [now, setNow] = useState(() => Date.now())
  const active = Object.keys(cursors).length > 0

  useEffect(() => {
    const canvas = rootRef.current?.closest('.phab-canvas')
    if (!(canvas instanceof HTMLElement)) return
    const onMove = (event: Event) => {
      if (!(event instanceof PointerEvent) || event.pointerType === 'touch') return
      const world = canvas.querySelector('.phab-canvas-world')
      if (!(world instanceof HTMLElement)) return
      const rect = canvas.getBoundingClientRect()
      const point = worldPointFromTransform(world.style.transform, event.clientX - rect.left, event.clientY - rect.top)
      if (point) notePointer(point, event.pointerType)
    }
    const onLeave = () => notePointer(null)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      const next = Date.now()
      dropStaleCursors(next)
      setNow(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])

  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const duration = reduce ? 0 : CURSOR_INTERPOLATE_MS
  const seen = new Set<string>()
  const drawn: { id: string; x: number; y: number; color: string; name: string; opacity: number }[] = []
  for (const cursor of Object.values(cursors)) {
    seen.add(cursor.id)
    const age = now - cursor.at
    if (age >= CURSOR_FADE_MS) continue
    const current = tweens.current.get(cursor.id)
    if (!current || current.toX !== cursor.x || current.toY !== cursor.y) {
      const from = current ? place(current, now, duration) : { x: cursor.x, y: cursor.y }
      tweens.current.set(cursor.id, { fromX: from.x, fromY: from.y, toX: cursor.x, toY: cursor.y, started: now })
    }
    const tween = tweens.current.get(cursor.id)!
    const point = place(tween, now, duration)
    const fadeStart = CURSOR_FADE_MS - 400
    const opacity = age <= fadeStart ? 1 : Math.max(0, (CURSOR_FADE_MS - age) / 400)
    const member = presence.find((entry) => entry.id === cursor.id)
    drawn.push({
      id: cursor.id,
      x: point.x,
      y: point.y,
      color: member?.color || '#8AA2FF',
      name: member?.name || '',
      opacity,
    })
  }
  for (const id of tweens.current.keys()) if (!seen.has(id)) tweens.current.delete(id)

  return (
    <div ref={rootRef} data-cursor-layer aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {drawn.map((cursor) => (
        <div key={cursor.id} data-cursor-id={cursor.id} style={{ position: 'absolute', left: cursor.x, top: cursor.y, opacity: cursor.opacity }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block', filter: 'drop-shadow(0 1px 1px #0008)' }}>
            <path d="M1 1 L1 13 L4.2 9.6 L7.2 15 L9.2 14.1 L6.2 8.8 L11 8.8 Z" fill={cursor.color} />
          </svg>
          {cursor.name && (
            <span style={{
              position: 'absolute',
              left: 14,
              top: 12,
              padding: '1px 5px',
              borderRadius: 6,
              background: '#1b1b1be6',
              color: cursor.color,
              fontSize: 10,
              fontWeight: 650,
              whiteSpace: 'nowrap',
            }}
            >
              {cursor.name}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
