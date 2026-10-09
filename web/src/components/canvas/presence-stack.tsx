import { BoardAvatar } from '#/components/canvas/board-avatar'
import { stackPresence } from '#/lib/canvas-realtime'
import type { CanvasMember } from '#/lib/canvas'

export function PresenceStack({ members, selfId }: { members: CanvasMember[]; selfId: string | null }) {
  const { shown, extra } = stackPresence(members, selfId)
  if (shown.length === 0) return null
  return (
    <div
      data-presence-stack
      role="list"
      aria-label="Who is here"
      style={{
        position: 'absolute',
        zIndex: 2,
        left: 368,
        top: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 'calc(100% - 368px - 440px)',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {shown.map((member) => (
        <span key={member.id} role="listitem" data-presence-id={member.id} data-self={member.id === selfId ? 'true' : 'false'}>
          <BoardAvatar name={member.name} color={member.color || '#8AA2FF'} kind={member.kind} />
        </span>
      ))}
      {extra > 0 && (
        <span data-presence-extra style={{ color: '#c8c8c4', fontSize: 12, fontWeight: 650 }}>
          +{extra}
        </span>
      )}
    </div>
  )
}
