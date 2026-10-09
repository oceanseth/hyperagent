import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { BoardAvatar } from '#/components/canvas/board-avatar'

const WINDOW_MS = 120_000

type AgentActivity = {
  id: string
  name: string
  color: string
  kind: 'agent'
  x: number | null
  y: number | null
  action: string
  at: string
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readActivity(value: unknown): AgentActivity | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.action !== 'string') return undefined
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    color: typeof row.color === 'string' ? row.color : '',
    kind: 'agent',
    x: finite(row.x),
    y: finite(row.y),
    action: row.action,
    at: typeof row.at === 'string' ? row.at : new Date().toISOString(),
  }
}

function fresh(agents: AgentActivity[], now: number) {
  return agents.filter((agent) => {
    const at = Date.parse(agent.at)
    return Number.isFinite(at) && now - at < WINDOW_MS && now - at >= -5_000
  })
}

export function AgentActivity() {
  const anchor = useRef<HTMLDivElement>(null)
  const [agents, setAgents] = useState<AgentActivity[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [world, setWorld] = useState<HTMLElement | null>(null)
  const bound = useRef('')

  useEffect(() => {
    let stop = false
    let channel: RealtimeChannel | undefined
    const apply = (incoming: AgentActivity) => {
      setAgents((current) => [...current.filter((entry) => entry.id !== incoming.id), incoming])
    }
    const load = async () => {
      try {
        const response = await fetch('/api/canvas', { cache: 'no-store' })
        if (!response.ok || stop) return
        const data = await response.json() as { agents?: unknown; realtimeTopic?: unknown }
        if (stop) return
        const listed = Array.isArray(data.agents) ? data.agents.flatMap((entry) => {
          const activity = readActivity(entry)
          return activity ? [activity] : []
        }) : []
        setAgents(listed)
        const topic = typeof data.realtimeTopic === 'string' ? data.realtimeTopic : ''
        if (!topic || topic === bound.current) return
        bound.current = topic
        const { supabase } = await import('#/utils/supabase')
        await supabase.realtime.setAuth().catch(() => undefined)
        if (stop) return
        channel = supabase.channel(topic, { config: { private: true } })
        channel.on('broadcast', { event: 'agent-activity' }, (message) => {
          const activity = readActivity(message?.payload)
          if (activity) apply(activity)
        })
        if (channel.state === 'closed') void channel.subscribe()
      } catch {
        // The next poll retries. A missed socket still leaves the canvas poll.
      }
    }
    void load()
    const poll = window.setInterval(() => { void load() }, 2000)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stop = true
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [])

  useEffect(() => {
    const found = anchor.current?.closest('.phab-canvas')?.querySelector('.phab-canvas-world')
    if (found instanceof HTMLElement) setWorld(found)
  }, [])

  const shown = fresh(agents, now)
  const markers = shown.filter((agent) => agent.x != null && agent.y != null)

  return (
    <>
      <div
        ref={anchor}
        data-agent-activity
        role="list"
        aria-label="Agents working"
        style={{
          position: 'absolute',
          zIndex: 2,
          left: 560,
          top: 0,
          bottom: 0,
          display: shown.length ? 'flex' : 'none',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {shown.map((agent) => (
          <span key={agent.id} role="listitem" data-agent-id={agent.id} data-agent-action={agent.action}>
            <BoardAvatar name={agent.name} color={agent.color || '#8AA2FF'} kind="agent" />
          </span>
        ))}
      </div>
      {world && createPortal(
        <div data-agent-markers aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {markers.map((agent) => (
            <div
              key={agent.id}
              data-agent-marker
              data-agent-id={agent.id}
              data-agent-action={agent.action}
              style={{ position: 'absolute', left: agent.x ?? 0, top: agent.y ?? 0 }}
            >
              <BoardAvatar name={agent.name} color={agent.color || '#8AA2FF'} kind="agent" />
              <span style={{
                display: 'block',
                marginTop: 4,
                padding: '1px 6px',
                borderRadius: 6,
                background: '#1b1b1be6',
                color: agent.color || '#8AA2FF',
                fontSize: 11,
                fontWeight: 650,
                whiteSpace: 'nowrap',
              }}
              >
                {agent.action}
              </span>
            </div>
          ))}
        </div>,
        world,
      )}
    </>
  )
}
