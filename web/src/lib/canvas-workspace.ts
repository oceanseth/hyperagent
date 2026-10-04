import { createStore } from 'zustand/vanilla'
import { canvasStackSchema, type CanvasJob, type CanvasSnapshot, type CanvasStack } from './canvas'
import { planSchema, rootPlans, type Plan, type PlanNode } from './plan'

type Point = { x: number; y: number }
export type WorkspaceState = CanvasSnapshot & {
  positions: Record<string, Point>
  excludedIds: string[]
  openPlanIds: string[]
  focus: { id: string; at: number } | null
  error: string | null
  loaded: boolean
  syncedAt: number | null
}
const initial: WorkspaceState = { stacks: [], jobs: [], plans: [], positions: {}, excludedIds: [], openPlanIds: [], focus: null, error: null, loaded: false, syncedAt: null }
export const canvasWorkspace = createStore<WorkspaceState>(() => initial)
let pending: Promise<void> | undefined
let subscriptions = 0
let timer: ReturnType<typeof setTimeout> | undefined
const streamedJobs = new Map<string, { job: CanvasJob; receivedAt: number }>()

function savePreferences() {
  const { positions, excludedIds } = canvasWorkspace.getState()
  try { localStorage.setItem('phab-canvas-layout', JSON.stringify({ positions, excludedIds })) } catch { /* storage may be disabled */ }
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
      canvasWorkspace.setState({
        stacks, jobs, plans,
        error: null, loaded: true, syncedAt: Date.now(),
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

export function requestCanvasFocus(id: string) {
  canvasWorkspace.setState({ focus: { id, at: Date.now() } })
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
