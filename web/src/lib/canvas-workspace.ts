import { createStore } from 'zustand/vanilla'
import { canvasNoteSchema, canvasStackSchema, type CanvasJob, type CanvasNote, type CanvasSnapshot, type CanvasStack } from './canvas'
import { planSchema, rootPlans, type Plan, type PlanNode } from './plan'

type Point = { x: number; y: number }
export type WorkspaceState = CanvasSnapshot & {
  notes: CanvasNote[]
  shared: boolean
  positions: Record<string, Point>
  excludedIds: string[]
  openPlanIds: string[]
  focus: { id: string; at: number } | null
  error: string | null
  loaded: boolean
  syncedAt: number | null
}
const initial: WorkspaceState = { stacks: [], jobs: [], plans: [], notes: [], shared: false, boardTitle: '', positions: {}, excludedIds: [], openPlanIds: [], focus: null, error: null, loaded: false, syncedAt: null }
export const canvasWorkspace = createStore<WorkspaceState>(() => initial)
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
function savePreferences() {
  const { positions, excludedIds } = canvasWorkspace.getState()
  try { localStorage.setItem('phab-canvas-layout', JSON.stringify({ positions, excludedIds })) } catch { /* storage may be disabled */ }
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(() => postJson('/api/layout', { positions: canvasWorkspace.getState().positions }), 500)
}

function publishedSlug() {
  const match = typeof location === 'undefined' ? null : location.pathname.match(/^\/p\/([a-z0-9]+)$/i)
  return match?.[1]
}

export function refreshCanvas() {
  pending ??= (async () => {
    try {
      const slug = publishedSlug()
      const response = await fetch(slug ? `/api/canvas?plan=${encodeURIComponent(slug)}` : '/api/canvas', { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error('Could not load saved context. Reconnecting…')
      const snapshot = await response.json() as CanvasSnapshot
      const stacks = snapshot.stacks.map((stack) => canvasStackSchema.parse(stack))
      const plans = (snapshot.plans ?? []).map((plan) => planSchema.parse(plan))
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
        return parsed.success ? [parsed.data] : []
      })
      canvasWorkspace.setState((current) => ({
        stacks, jobs, plans,
        shared: snapshot.shared ?? current.shared,
        boardTitle: snapshot.boardTitle ?? '',
        // Server layout wins so shared boards converge; local wins briefly
        // around a drag or edit so your own hand never fights the poll.
        ...(holdLocal() ? {} : {
          notes,
          positions: { ...current.positions, ...(snapshot.positions ?? {}) },
        }),
        error: null, loaded: true, syncedAt: Date.now(),
      }))
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
  return () => { unsubscribe(); if (--subscriptions === 0) clearTimeout(timer) }
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
  markLocalChange()
  clearTimeout(noteTimers.get(id))
  noteTimers.delete(id)
  canvasWorkspace.setState((current) => ({ notes: current.notes.filter((note) => note.id !== id) }))
  postJson('/api/notes', { action: 'remove', id })
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
