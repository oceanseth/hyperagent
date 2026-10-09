import { createStore } from 'zustand/vanilla'
import { canvasBrowserSchema, canvasNoteSchema, canvasStackSchema, type CanvasBrowser, type CanvasJob, type CanvasMember, type CanvasNote, type CanvasSnapshot, type CanvasStack } from './canvas'
import type { BoardCursor } from './canvas-realtime'
import { planSchema, rootPlans, type Plan, type PlanNode } from './plan'

type Point = { x: number; y: number }
export type WorkspaceState = CanvasSnapshot & {
  notes: CanvasNote[]
  browsers: CanvasBrowser[]
  shared: boolean
  positions: Record<string, Point>
  excludedIds: string[]
  openPlanIds: string[]
  focus: { id: string; at: number } | null
  error: string | null
  loaded: boolean
  syncedAt: number | null
}
export type CanvasPresenceState = {
  presence: CanvasMember[]
  cursors: Record<string, BoardCursor>
  selfId: string | null
}
type StoreState = WorkspaceState & CanvasPresenceState
const initial: StoreState = { stacks: [], jobs: [], plans: [], notes: [], browsers: [], shared: false, boardTitle: '', positions: {}, excludedIds: [], openPlanIds: [], focus: null, error: null, loaded: false, syncedAt: null, presence: [], cursors: {}, selfId: null }
export const canvasWorkspace = createStore<StoreState>(() => initial)
let pending: Promise<void> | undefined
let subscriptions = 0
let timer: ReturnType<typeof setTimeout> | undefined
const streamedJobs = new Map<string, { job: CanvasJob; receivedAt: number }>()

// Remote snapshots must not fight an in-flight drag or a just-made local
// edit; the local change is posted on commit and the next poll converges
// every participant of a shared board.
let draggingNow = false
let lastLocalChangeAt = 0
const markLocalChange = () => { lastLocalChangeAt = Date.now() }
const holdLocal = () => draggingNow || Date.now() - lastLocalChangeAt < 3000
// A GET already in flight when something is removed still carries the old
// item. Removed IDs are dropped from snapshots for a while, and a snapshot
// requested before a clear is discarded outright.
const tombstones = new Map<string, number>()
let clearedAt = 0
const bury = (id: string) => { tombstones.set(id, Date.now()); markLocalChange() }
const buried = (id: string) => {
  const at = tombstones.get(id)
  if (at === undefined) return false
  if (Date.now() - at > 30000) { tombstones.delete(id); return false }
  return true
}
export function setCanvasDragging(value: boolean) {
  draggingNow = value
  if (!value) markLocalChange()
}

function postJson(url: string, body: unknown) {
  fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  }).catch(() => { /* the next poll reconciles */ })
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined
const pendingPatch: Record<string, Point> = {}
const pendingRemove = new Set<string>()

function rememberLayoutPoint(id: string, point: Point) {
  pendingRemove.delete(id)
  pendingPatch[id] = point
}

function forgetLayoutIds(ids: string[]) {
  for (const id of ids) {
    delete pendingPatch[id]
    pendingRemove.add(id)
  }
}

function discardLayoutWrites() {
  clearTimeout(layoutTimer)
  for (const id of Object.keys(pendingPatch)) delete pendingPatch[id]
  pendingRemove.clear()
}

function savePreferences() {
  const { positions, excludedIds } = canvasWorkspace.getState()
  try { localStorage.setItem('phab-canvas-layout', JSON.stringify({ positions, excludedIds })) } catch { /* storage may be disabled */ }
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(() => {
    const patch = { ...pendingPatch }
    const remove = [...pendingRemove]
    for (const id of Object.keys(pendingPatch)) delete pendingPatch[id]
    pendingRemove.clear()
    const extra = remove.splice(500)
    for (const id of extra) pendingRemove.add(id)
    if (Object.keys(patch).length === 0 && remove.length === 0) {
      if (extra.length) savePreferences()
      return
    }
    postJson('/api/layout', {
      ...(Object.keys(patch).length ? { patch } : {}),
      ...(remove.length ? { remove } : {}),
    })
    if (extra.length) savePreferences()
  }, 500)
}

function publishedSlug() {
  const match = typeof location === 'undefined' ? null : location.pathname.match(/^\/p\/([a-z0-9]+)$/i)
  return match?.[1]
}

// Database triggers ping the board's private Supabase Realtime channel on every
// change, so open boards refresh at once instead of waiting for the next poll.
// Polling stays as the fallback; a realtime failure never breaks the canvas.
// Presence and cursors share that channel. See canvas-realtime.ts.

export function refreshCanvas() {
  pending ??= (async () => {
    try {
      const slug = publishedSlug()
      const startedAt = Date.now()
      const response = await fetch(slug ? `/api/canvas?plan=${encodeURIComponent(slug)}` : '/api/canvas', { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error('Could not load saved context. Reconnecting…')
      const snapshot = await response.json() as CanvasSnapshot
      if (startedAt < clearedAt) return
      const stacks = snapshot.stacks.map((stack) => canvasStackSchema.parse(stack)).filter((stack) => !buried(stack.id))
      const plans = (snapshot.plans ?? []).map((plan) => planSchema.parse(plan)).filter((plan) => !buried(plan.id))
      // A GET already in flight may predate a job announced by the chat stream.
      // Keep that announcement briefly until the hosted snapshot catches up.
      for (const [id, entry] of streamedJobs) {
        if (snapshot.jobs.some((job) => job.id === id) || Date.now() - entry.receivedAt > 60000) streamedJobs.delete(id)
      }
      const jobs = [...Array.from(streamedJobs.values(), (entry) => entry.job), ...snapshot.jobs]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 30)
      const notes = (snapshot.notes ?? []).flatMap((note) => {
        const parsed = canvasNoteSchema.safeParse(note)
        return parsed.success && !buried(parsed.data.id) ? [parsed.data] : []
      })
      const browsers = (snapshot.browsers ?? []).flatMap((browser) => {
        const parsed = canvasBrowserSchema.safeParse(browser)
        return parsed.success && !buried(parsed.data.id) ? [parsed.data] : []
      })
      const positions = { ...(snapshot.positions ?? {}), ...pendingPatch }
      for (const id of pendingRemove) delete positions[id]
      canvasWorkspace.setState((current) => ({
        stacks, jobs, plans,
        shared: snapshot.shared ?? current.shared,
        boardTitle: snapshot.boardTitle ?? '',
        // Server layout wins so shared boards converge; local wins briefly
        // around a drag or edit so your own hand never fights the poll.
        // Pending edits stay on top until the layout post lands.
        ...(holdLocal() ? {} : { notes, browsers, positions }),
        error: null, loaded: true, syncedAt: Date.now(),
      }))
      const topic = (snapshot as CanvasSnapshot & { realtimeTopic?: string }).realtimeTopic
      if (topic && typeof window !== 'undefined') {
        const members = snapshot.members ?? []
        void import('./canvas-realtime').then(({ connectBoardRealtime }) => connectBoardRealtime(topic, members))
      }
    } catch {
      canvasWorkspace.setState({ error: 'Could not load saved context. Reconnecting…' })
    } finally { pending = undefined }
  })()
  return pending
}

function scheduleRefresh() {
  clearTimeout(timer)
  if (!subscriptions) return
  const state = canvasWorkspace.getState()
  const active = state.jobs.some((job) => job.status === 'queued' || job.status === 'running')
    || state.browsers.some((browser) => browser.status === 'starting')
  // A shared board polls fast enough that moves made by one person appear
  // for everyone within a few seconds.
  timer = setTimeout(async () => { await refreshCanvas(); scheduleRefresh() }, active ? 2500 : state.shared ? 3000 : 10000)
}

// A subscription owns polling. It only reads remote jobs; no work depends on
// the page remaining open, and there is no effect-driven client worker.
export function subscribeCanvas(listener: () => void) {
  const unsubscribe = canvasWorkspace.subscribe(listener)
  if (++subscriptions === 1) {
    try {
      const saved = JSON.parse(localStorage.getItem('phab-canvas-layout') ?? '{}')
      const positions = Object.fromEntries(Object.entries(saved.positions ?? {}).filter(([, point]) => {
        const p = point as Point
        return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      })) as Record<string, Point>
      canvasWorkspace.setState({ positions, excludedIds: Array.isArray(saved.excludedIds) ? saved.excludedIds.filter((id: unknown) => typeof id === 'string') : [] })
    } catch { /* default layout */ }
    void refreshCanvas().then(scheduleRefresh)
  }
  return () => {
    unsubscribe()
    if (--subscriptions === 0) {
      clearTimeout(timer)
      void import('./canvas-realtime').then(({ disconnectBoardRealtime }) => disconnectBoardRealtime())
    }
  }
}

export function requestCanvasFocus(id: string) {
  canvasWorkspace.setState({ focus: { id, at: Date.now() } })
}

export function receiveCanvasJob(job: CanvasJob) {
  streamedJobs.set(job.id, { job, receivedAt: Date.now() })
  canvasWorkspace.setState((current) => ({ jobs: [job, ...current.jobs.filter((entry) => entry.id !== job.id)] }))
  scheduleRefresh()
}

export function moveCanvasArtifact(id: string, point: Point) {
  markLocalChange()
  rememberLayoutPoint(id, point)
  canvasWorkspace.setState((current) => ({ positions: { ...current.positions, [id]: point } }))
}
export const saveCanvasLayout = savePreferences

const postNote = (note: CanvasNote) =>
  postJson('/api/notes', { action: 'upsert', note: { id: note.id, label: note.label, body: note.body, x: note.x, y: note.y } })

export function createNote(point: Point) {
  const state = canvasWorkspace.getState()
  const note: CanvasNote = { id: crypto.randomUUID(), label: `Note ${state.notes.length + 1}`, body: '', x: point.x, y: point.y }
  markLocalChange()
  canvasWorkspace.setState((current) => ({ notes: [...current.notes, note] }))
  postNote(note)
  return note.id
}

export function moveNote(id: string, point: Point) {
  markLocalChange()
  canvasWorkspace.setState((current) => ({
    notes: current.notes.map((note) => note.id === id ? { ...note, x: point.x, y: point.y } : note),
  }))
}

/** Pushes a note's current state to the server (drag end, arrow-key nudge). */
export function commitNote(id: string) {
  const note = canvasWorkspace.getState().notes.find((entry) => entry.id === id)
  if (note) postNote(note)
}

const noteTimers = new Map<string, ReturnType<typeof setTimeout>>()
export function updateNoteText(id: string, body: string) {
  markLocalChange()
  canvasWorkspace.setState((current) => ({
    notes: current.notes.map((note) => note.id === id ? { ...note, body } : note),
  }))
  clearTimeout(noteTimers.get(id))
  noteTimers.set(id, setTimeout(() => { noteTimers.delete(id); commitNote(id) }, 600))
}

export function deleteNote(id: string) {
  bury(id)
  clearTimeout(noteTimers.get(id))
  noteTimers.delete(id)
  canvasWorkspace.setState((current) => ({ notes: current.notes.filter((note) => note.id !== id) }))
  postJson('/api/notes', { action: 'remove', id })
}

/** Removes the card for everyone; the server ends the KERNEL session. */
export function closeBrowser(id: string) {
  bury(id)
  forgetLayoutIds([id])
  canvasWorkspace.setState((current) => {
    const positions = { ...current.positions }
    delete positions[id]
    return { browsers: current.browsers.filter((browser) => browser.id !== id), positions }
  })
  savePreferences()
  postJson('/api/browsers', { action: 'close', id })
}

/** Hands a task to the Fly browser agent attached to this browser. Resolves to an error message, if any. */
export async function askBrowserAgent(id: string, task: string): Promise<string | undefined> {
  markLocalChange()
  try {
    const response = await fetch('/api/browsers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'agent', id, task }), signal: AbortSignal.timeout(20000),
    })
    if (response.ok) return undefined
    const body = await response.json().catch(() => ({})) as { error?: string }
    return body.error ?? 'Could not reach the browser agent.'
  } catch { return 'Could not reach the browser agent.' }
}

export type BrowserArtifact = {
  id: string; kind: 'browser'; label: string; text: string
  anchorX: number; anchorY: number; x: number; y: number
  browser: CanvasBrowser
}

// Browsers sit in a row above plans and research by default; once moved,
// their position syncs through the shared layout like every other card.
export function browserArtifacts(state: WorkspaceState): BrowserArtifact[] {
  return state.browsers.map((browser, index) => ({
    id: browser.id, kind: 'browser', label: browser.title, text: browser.url ?? '',
    anchorX: 0, anchorY: 0, browser,
    ...(state.positions[browser.id] ?? { x: 700 + index * 1060, y: -620 }),
  }))
}

export type NoteArtifact = {
  id: string; kind: 'note'; label: string; text: string
  anchorX: number; anchorY: number; x: number; y: number
  note: CanvasNote
}

export function noteArtifacts(state: WorkspaceState): NoteArtifact[] {
  return state.notes.map((note) => ({
    id: note.id, kind: 'note', label: note.label, text: note.body,
    anchorX: 0, anchorY: 0, x: note.x, y: note.y, note,
  }))
}

export function toggleOpenPlan(id: string) {
  canvasWorkspace.setState((current) => ({
    openPlanIds: current.openPlanIds.includes(id)
      ? current.openPlanIds.filter((entry) => entry !== id)
      : [...current.openPlanIds, id],
  }))
}

export function toggleContextStack(id: string) {
  canvasWorkspace.setState((current) => {
    const selected = contextIds(current)
    const next = selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected.slice(-19), id]
    return { excludedIds: current.stacks.filter((stack) => !next.includes(stack.id)).map((stack) => stack.id) }
  })
  savePreferences()
}
export function contextIds({ stacks, excludedIds }: WorkspaceState) {
  return stacks.filter((stack) => !excludedIds.includes(stack.id)).slice(-20).map((stack) => stack.id)
}
export function selectedContextIds() {
  return contextIds(canvasWorkspace.getState())
}

export type CanvasArtifact = {
  id: string; kind: 'source' | 'summary'; label: string; text: string
  anchorX: number; anchorY: number; x: number; y: number
  stack: CanvasStack; source?: CanvasStack['sources'][number]
}

export function canvasArtifacts(state: WorkspaceState): CanvasArtifact[] {
  return state.stacks.flatMap((stack, stackIndex) => {
    const startX = 180 + stackIndex * 1500
    const columns = Math.min(3, stack.sources.length)
    const rows = Math.max(1, Math.ceil(stack.sources.length / 3))
    const sources: CanvasArtifact[] = stack.sources.map((source, index) => ({
      id: source.id, kind: 'source', label: source.title, text: source.description ?? '', stack, source,
      anchorX: 0, anchorY: 0,
      ...(state.positions[source.id] ?? { x: startX + index % 3 * 285, y: 280 + Math.floor(index / 3) * 360 }),
    }))
    return [...sources, {
      id: stack.id, kind: 'summary', label: stack.title, text: stack.markdown, stack,
      anchorX: 0, anchorY: 0,
      ...(state.positions[stack.id] ?? { x: startX + columns * 285 + 155, y: 280 + (rows - 1) * 180 }),
    }]
  })
}

export type PlanArtifact = {
  id: string
  kind: 'plan-title' | 'plan-node'
  label: string
  text: string
  anchorX: number
  anchorY: number
  x: number
  y: number
  plan: Plan
  node?: PlanNode
}

function layoutPlan(plan: Plan, origin: Point, positions: Record<string, Point>): PlanArtifact[] {
  const title: PlanArtifact = {
    id: plan.id, kind: 'plan-title', label: plan.name, text: plan.description, plan,
    anchorX: 0, anchorY: 0,
    ...(positions[plan.id] ?? { x: origin.x, y: origin.y }),
  }
  const nodes = plan.states.map((node, index) => ({
    id: node.id, kind: 'plan-node' as const, label: node.name, text: node.context, plan, node,
    anchorX: 0, anchorY: 0,
    ...(positions[node.id] ?? { x: origin.x + index * 230, y: origin.y + 150 }),
  }))
  return [title, ...nodes]
}

export function planArtifacts(state: WorkspaceState): PlanArtifact[] {
  const openPlanIds = state.openPlanIds
  const roots = rootPlans(state.plans)
  const byId = new Map(state.plans.map((plan) => [plan.id, plan]))
  const placed: PlanArtifact[] = []
  roots.forEach((plan, planIndex) => {
    placed.push(...layoutPlan(plan, { x: 220 + planIndex * 220, y: -80 }, state.positions))
    const openChildren = plan.states.filter((node) => node.childPlanId && openPlanIds.includes(node.childPlanId))
    openChildren.forEach((node, childIndex) => {
      const child = byId.get(node.childPlanId!)
      if (!child) return
      const parent = placed.find((item) => item.id === node.id)
      placed.push(...layoutPlan(child, {
        x: (parent?.x ?? 220) - 80,
        y: (parent?.y ?? 70) + 210 + childIndex * 40,
      }, state.positions))
    })
  })
  return placed
}

export function planConnections(items: PlanArtifact[]) {
  const byId = new Map(items.filter((item) => item.kind === 'plan-node').map((item) => [item.id, item]))
  return items.flatMap((item) => {
    if (item.kind !== 'plan-title') return []
    return item.plan.edges.flatMap((edge) => {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      if (!from || !to) return []
      const x1 = from.x + 90
      const x2 = to.x - 90
      const bend = Math.max(28, (x2 - x1) * 0.4)
      return [{ id: `${edge.from}-${edge.to}`, kind: 'plan' as const, path: `M${x1},${from.y} C${x1 + bend},${from.y} ${x2 - bend},${to.y} ${x2},${to.y}` }]
    })
  })
}

/** Empties the board for everyone on it. Resolves to an error message, if any. */
export async function clearCanvas(): Promise<string | undefined> {
  clearedAt = Date.now()
  markLocalChange()
  for (const timer of noteTimers.values()) clearTimeout(timer)
  noteTimers.clear()
  discardLayoutWrites()
  canvasWorkspace.setState({ stacks: [], plans: [], notes: [], browsers: [], positions: {}, excludedIds: [], openPlanIds: [], focus: null })
  try { localStorage.removeItem('phab-canvas-layout') } catch { /* storage may be disabled */ }
  try {
    const response = await fetch('/api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      return body.error ?? 'Could not clear the canvas.'
    }
    lastLocalChangeAt = 0
    void refreshCanvas()
    return undefined
  } catch { return 'Could not clear the canvas.' }
}

/** Removes a research stack and its sources for everyone; a job still writing it is cancelled. */
export function removeStack(id: string) {
  bury(id)
  const stack = canvasWorkspace.getState().stacks.find((entry) => entry.id === id)
  const dropped = [id, ...(stack?.sources.map((source) => source.id) ?? [])]
  forgetLayoutIds(dropped)
  canvasWorkspace.setState((current) => {
    const positions = { ...current.positions }
    for (const entry of dropped) delete positions[entry]
    return {
      stacks: current.stacks.filter((entry) => entry.id !== id),
      excludedIds: current.excludedIds.filter((entry) => entry !== id),
      positions,
    }
  })
  savePreferences()
  postJson('/api/remove', { kind: 'stack', id })
}

/** Removes a plan and its nested child plans for everyone. */
export function removePlan(id: string) {
  const state = canvasWorkspace.getState()
  const byId = new Map(state.plans.map((plan) => [plan.id, plan]))
  const ids = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const next = queue.shift()!
    if (ids.has(next)) continue
    ids.add(next)
    for (const node of byId.get(next)?.states ?? []) if (node.childPlanId) queue.push(node.childPlanId)
  }
  const dropped: string[] = []
  for (const entry of ids) {
    bury(entry)
    dropped.push(entry)
    for (const node of byId.get(entry)?.states ?? []) dropped.push(node.id)
  }
  forgetLayoutIds(dropped)
  canvasWorkspace.setState((current) => {
    const positions = { ...current.positions }
    for (const entry of dropped) delete positions[entry]
    return {
      plans: current.plans.filter((plan) => !ids.has(plan.id)),
      openPlanIds: current.openPlanIds.filter((entry) => !ids.has(entry)),
      positions,
    }
  })
  savePreferences()
  postJson('/api/remove', { kind: 'plan', id })
}
