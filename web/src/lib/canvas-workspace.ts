import { createStore } from 'zustand/vanilla'
import { canvasStackSchema, type CanvasJob, type CanvasSnapshot, type CanvasStack } from './canvas'

type Point = { x: number; y: number }
export type WorkspaceState = CanvasSnapshot & {
  positions: Record<string, Point>
  excludedIds: string[]
  error: string | null
  loaded: boolean
}
const initial: WorkspaceState = { stacks: [], jobs: [], positions: {}, excludedIds: [], error: null, loaded: false }
export const canvasWorkspace = createStore<WorkspaceState>(() => initial)
let pending: Promise<void> | undefined
let subscriptions = 0
let timer: ReturnType<typeof setTimeout> | undefined
const streamedJobs = new Map<string, { job: CanvasJob; receivedAt: number }>()

function savePreferences() {
  const { positions, excludedIds } = canvasWorkspace.getState()
  try { localStorage.setItem('phab-canvas-layout', JSON.stringify({ positions, excludedIds })) } catch { /* storage may be disabled */ }
}

export function refreshCanvas() {
  pending ??= (async () => {
    try {
      const response = await fetch('/api/canvas', { cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error('Could not load saved context. Reconnecting…')
      const snapshot = await response.json() as CanvasSnapshot
      const stacks = snapshot.stacks.map((stack) => canvasStackSchema.parse(stack))
      // A GET already in flight may predate a job announced by the chat stream.
      // Keep that announcement briefly until the hosted snapshot catches up.
      for (const [id, entry] of streamedJobs) {
        if (snapshot.jobs.some((job) => job.id === id) || Date.now() - entry.receivedAt > 60000) streamedJobs.delete(id)
      }
      const jobs = [...Array.from(streamedJobs.values(), (entry) => entry.job), ...snapshot.jobs]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, 30)
      canvasWorkspace.setState({
        stacks, jobs,
        error: null, loaded: true,
      })
    } catch {
      canvasWorkspace.setState({ error: 'Could not load saved context. Reconnecting…' })
    } finally { pending = undefined }
  })()
  return pending
}

function scheduleRefresh() {
  clearTimeout(timer)
  if (!subscriptions) return
  const active = canvasWorkspace.getState().jobs.some((job) => job.status === 'queued' || job.status === 'running')
  timer = setTimeout(async () => { await refreshCanvas(); scheduleRefresh() }, active ? 2500 : 10000)
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

export function receiveCanvasJob(job: CanvasJob) {
  streamedJobs.set(job.id, { job, receivedAt: Date.now() })
  canvasWorkspace.setState((current) => ({ jobs: [job, ...current.jobs.filter((entry) => entry.id !== job.id)] }))
  scheduleRefresh()
}

export function moveCanvasArtifact(id: string, point: Point) {
  canvasWorkspace.setState((current) => ({ positions: { ...current.positions, [id]: point } }))
}
export const saveCanvasLayout = savePreferences

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
