import type { RealtimeChannel, RealtimePresenceState } from '@supabase/supabase-js'
import type { CanvasMember } from './canvas'
import { canvasWorkspace, refreshCanvas } from './canvas-workspace'

export type BoardCursor = { id: string; x: number; y: number; at: number }

export const CURSOR_DEADZONE_PX = 4
export const CURSOR_INTERPOLATE_MS = 150
export const CURSOR_FADE_MS = 5000

/** Send rate in Hz. r = clamp(floor(40 / k^2), 2, 8), where k is how many people are present. */
export function cursorRateHz(present: number): number {
  const k = Number.isFinite(present) ? present : 1
  if (k <= 0) return 8
  return Math.min(8, Math.max(2, Math.floor(40 / (k * k))))
}

/** True only after the pointer has moved more than 4px from the last sent point. */
export function cursorPastDeadzone(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
): boolean {
  if (!previous) return false
  const dx = next.x - previous.x
  const dy = next.y - previous.y
  return dx * dx + dy * dy > CURSOR_DEADZONE_PX * CURSOR_DEADZONE_PX
}

/** Who-is-here only. Cursor coordinates never ride along in presence. */
export function presencePayload(member: CanvasMember): CanvasMember {
  return { id: member.id, name: member.name, color: member.color, kind: member.kind }
}

export function stackPresence(members: readonly CanvasMember[], selfId: string | null, limit = 5) {
  const byId = new Map<string, CanvasMember>()
  for (const member of members) {
    if (!member.id) continue
    byId.set(member.id, presencePayload(member))
  }
  const ordered = [...byId.values()].sort((a, b) => {
    if (a.id === selfId) return -1
    if (b.id === selfId) return 1
    return 0
  })
  const shown = ordered.slice(0, limit)
  return { shown, extra: ordered.length - shown.length }
}

export function rateLimitText(detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) return `${detail.message} ${rateLimitText(detail.cause)}`
  if (typeof detail === 'object') {
    return Object.values(detail as Record<string, unknown>).map((value) => rateLimitText(value)).join(' ')
  }
  return ''
}

/** A channel closed because the server said "Too many messages" should be joined again. */
export function shouldRejoinRealtime(status: string, detail: unknown): boolean {
  if (status !== 'CLOSED' && status !== 'CHANNEL_ERROR') return false
  return rateLimitText(detail).includes('Too many messages')
}

export function worldPointFromTransform(transform: string, localX: number, localY: number) {
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(transform)
  if (!match) return null
  const scale = Number(match[3])
  if (!Number.isFinite(scale) || scale === 0) return null
  return { x: (localX - Number(match[1])) / scale, y: (localY - Number(match[2])) / scale }
}

type Sender = {
  channel: RealtimeChannel
  self: CanvasMember
  presentCount: number
  lastSent: { x: number; y: number } | null
  lastSentAt: number
  announced: boolean
  pending: { x: number; y: number } | null
  timer: ReturnType<typeof setTimeout> | undefined
}

let active: RealtimeChannel | undefined
let topic: string | undefined
let generation = 0
let rejoining = false
let ignoreClose = false
let latestMembers: CanvasMember[] = []
let selfMember: CanvasMember | undefined
let sender: Sender | undefined
let hideBound = false
let boardTimer: ReturnType<typeof setTimeout> | undefined

function readCursor(message: unknown): { id: string; x: number; y: number } | null {
  const body = message && typeof message === 'object' && 'payload' in message
    ? (message as { payload: unknown }).payload
    : message
  if (!body || typeof body !== 'object') return null
  const record = body as { id?: unknown; x?: unknown; y?: unknown }
  if (typeof record.id !== 'string' || typeof record.x !== 'number' || typeof record.y !== 'number') return null
  if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null
  return { id: record.id, x: record.x, y: record.y }
}

function readLeaveId(message: unknown): string | null {
  const body = message && typeof message === 'object' && 'payload' in message
    ? (message as { payload: unknown }).payload
    : message
  if (!body || typeof body !== 'object') return null
  const id = (body as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function membersFromPresence(state: RealtimePresenceState<CanvasMember>): CanvasMember[] {
  const members: CanvasMember[] = []
  for (const [key, metas] of Object.entries(state)) {
    const meta = metas?.[0]
    if (!key) continue
    members.push(presencePayload({
      id: key,
      name: typeof meta?.name === 'string' ? meta.name : '',
      color: typeof meta?.color === 'string' ? meta.color : '',
      kind: meta?.kind === 'agent' ? 'agent' : 'human',
    }))
  }
  return members
}

function applyPresence(state: RealtimePresenceState<CanvasMember>) {
  const presence = membersFromPresence(state)
  if (sender) sender.presentCount = Math.max(1, presence.length)
  const present = new Set(presence.map((member) => member.id))
  canvasWorkspace.setState((current) => {
    const cursors = { ...current.cursors }
    for (const id of Object.keys(cursors)) if (!present.has(id)) delete cursors[id]
    return { presence, cursors }
  })
}

function applyCursor(message: unknown) {
  const point = readCursor(message)
  if (!point || point.id === selfMember?.id) return
  canvasWorkspace.setState((current) => ({
    cursors: { ...current.cursors, [point.id]: { ...point, at: Date.now() } },
  }))
}

function applyLeave(message: unknown) {
  const id = readLeaveId(message)
  if (!id || id === selfMember?.id) return
  canvasWorkspace.setState((current) => {
    if (!current.cursors[id]) return current
    const cursors = { ...current.cursors }
    delete cursors[id]
    return { cursors }
  })
}

function flushCursor(now = Date.now()) {
  const current = sender
  if (!current?.pending) return
  const interval = 1000 / cursorRateHz(current.presentCount)
  const wait = current.lastSentAt === 0 ? 0 : interval - (now - current.lastSentAt)
  if (wait > 0) {
    clearTimeout(current.timer)
    current.timer = setTimeout(() => flushCursor(), wait)
    return
  }
  const point = current.pending
  current.pending = null
  current.lastSent = point
  current.lastSentAt = now
  current.announced = true
  void current.channel.send({
    type: 'broadcast',
    event: 'cursor',
    payload: { id: current.self.id, x: point.x, y: point.y },
  })
}

/** Drops cursors that have had no event for 5 seconds. */
export function dropStaleCursors(now = Date.now()) {
  const current = canvasWorkspace.getState()
  const cursors: Record<string, BoardCursor> = {}
  let dropped = false
  for (const [id, cursor] of Object.entries(current.cursors)) {
    if (now - cursor.at >= CURSOR_FADE_MS) dropped = true
    else cursors[id] = cursor
  }
  if (dropped) canvasWorkspace.setState({ cursors })
}

/** Pointer position in canvas world coordinates. Touch never sends. Null means leave. */
export function notePointer(point: { x: number; y: number } | null, pointerType?: string) {
  const current = sender
  if (!current) return
  if (point === null) {
    clearTimeout(current.timer)
    current.pending = null
    current.lastSent = null
    current.lastSentAt = 0
    if (!current.announced) return
    current.announced = false
    void current.channel.send({
      type: 'broadcast',
      event: 'cursor-leave',
      payload: { id: current.self.id },
    })
    return
  }
  if (pointerType === 'touch') return
  if (!current.lastSent) {
    current.lastSent = point
    return
  }
  if (!cursorPastDeadzone(current.lastSent, point)) return
  current.pending = point
  flushCursor()
}

function armSender(channel: RealtimeChannel, self: CanvasMember) {
  clearTimeout(sender?.timer)
  sender = {
    channel, self, presentCount: 1, lastSent: null, lastSentAt: 0, announced: false, pending: null, timer: undefined,
  }
}

function disarmSender() {
  clearTimeout(sender?.timer)
  sender = undefined
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    notePointer(null)
    void active?.untrack()
    return
  }
  if (selfMember && active) void active.track(presencePayload(selfMember))
}

function onPageHide() {
  notePointer(null)
  void active?.untrack()
}

function bindHide() {
  if (hideBound || typeof window === 'undefined') return
  hideBound = true
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
}

function unbindHide() {
  if (!hideBound || typeof window === 'undefined') return
  hideBound = false
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pagehide', onPageHide)
}

function rejoin(nextTopic: string) {
  if (rejoining) return
  rejoining = true
  ignoreClose = true
  generation += 1
  const leaving = active
  active = undefined
  disarmSender()
  void leaving?.unsubscribe()
  window.setTimeout(() => {
    ignoreClose = false
    rejoining = false
    void openChannel(nextTopic, latestMembers)
  }, 400)
}

function onChannelClosed(status: string, detail: unknown, nextTopic: string) {
  if (ignoreClose) return
  if (shouldRejoinRealtime(status, detail)) rejoin(nextTopic)
}

async function openChannel(nextTopic: string, members: CanvasMember[]) {
  const gen = ++generation
  try {
    ignoreClose = true
    const leaving = active
    active = undefined
    disarmSender()
    void leaving?.unsubscribe()
    const { supabase } = await import('../utils/supabase')
    if (gen !== generation) return
    await supabase.realtime.setAuth()
    if (gen !== generation) return
    const { data } = await supabase.auth.getSession()
    if (gen !== generation) return
    const userId = data.session?.user?.id
    const self = userId ? members.find((member) => member.id === userId) : undefined
    selfMember = self ? presencePayload(self) : undefined
    canvasWorkspace.setState({ selfId: selfMember?.id ?? null, presence: [], cursors: {} })
    const channel = supabase.channel(nextTopic, {
      config: {
        private: true,
        broadcast: { self: false },
        ...(selfMember ? { presence: { key: selfMember.id } } : {}),
      },
    })
    channel.on('broadcast', { event: 'board-changed' }, () => {
      clearTimeout(boardTimer)
      boardTimer = setTimeout(() => { void refreshCanvas() }, 250)
    })
    if (selfMember) {
      channel.on('presence', { event: 'sync' }, () => {
        applyPresence(channel.presenceState<CanvasMember>())
      })
      channel.on('broadcast', { event: 'cursor' }, (message) => applyCursor(message))
      channel.on('broadcast', { event: 'cursor-leave' }, (message) => applyLeave(message))
      bindHide()
    }
    const withClose = channel as RealtimeChannel & { _onClose?: (callback: (payload: unknown) => void) => void }
    withClose._onClose?.((payload) => onChannelClosed('CLOSED', payload, nextTopic))
    channel.subscribe((status, err) => {
      if (gen !== generation) return
      if (status === 'SUBSCRIBED' && selfMember) {
        void channel.track(presencePayload(selfMember))
        armSender(channel, selfMember)
      }
      if (status === 'CHANNEL_ERROR') onChannelClosed(status, err, nextTopic)
    })
    if (gen !== generation) {
      void channel.unsubscribe()
      return
    }
    active = channel
    ignoreClose = false
  } catch {
    if (gen === generation) {
      topic = undefined
      ignoreClose = false
    }
  }
}

export function connectBoardRealtime(nextTopic: string, members: CanvasMember[]) {
  latestMembers = members
  if (!nextTopic || nextTopic === topic || typeof window === 'undefined') return
  topic = nextTopic
  void openChannel(nextTopic, members)
}

export function disconnectBoardRealtime() {
  generation += 1
  ignoreClose = true
  topic = undefined
  rejoining = false
  selfMember = undefined
  clearTimeout(boardTimer)
  const leaving = active
  active = undefined
  disarmSender()
  unbindHide()
  void leaving?.unsubscribe()
  canvasWorkspace.setState({ presence: [], cursors: {}, selfId: null })
}
