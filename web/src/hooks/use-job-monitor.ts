import { useCallback, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react'
import type { CanvasJob } from '#/lib/canvas'
import { canvasWorkspace, refreshCanvas, subscribeCanvas } from '#/lib/canvas-workspace'

let clockTime = Date.now()
const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | undefined
function subscribeClock(listener: () => void) {
  clockListeners.add(listener)
  if (!clockTimer) clockTimer = setInterval(() => {
    clockTime = Date.now()
    clockListeners.forEach((notify) => notify())
  }, 1000)
  return () => {
    clockListeners.delete(listener)
    if (!clockListeners.size) { clearInterval(clockTimer); clockTimer = undefined }
  }
}

function duration(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return 'Unknown'
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function timestamp(value?: string) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function describeJob(job: CanvasJob, now: number) {
  const active = job.status === 'queued' || job.status === 'running'
  const heartbeatAt = job.heartbeatAt ? Date.parse(job.heartbeatAt) : NaN
  const heartbeatAge = now - heartbeatAt
  const stale = job.status === 'running' && Number.isFinite(heartbeatAge) && heartbeatAge > 90000
  const waiting = job.status === 'queued' && now - Date.parse(job.createdAt) > 90000
  const end = active ? now : Date.parse(job.updatedAt)
  const events = [...(job.events ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id).map((event) => ({
    ...event,
    timeLabel: timestamp(event.at),
    isError: /error|fail/i.test(event.type),
    durationLabel: event.durationMs == null ? null : event.durationMs < 1000 ? `${event.durationMs}ms` : duration(event.durationMs),
    detailsText: event.details && Object.keys(event.details).length ? JSON.stringify(event.details, null, 2) : null,
  }))
  return {
    ...job, active, stale, waiting, events,
    monitorHref: `/monitor?job=${encodeURIComponent(job.id)}`,
    statusLabel: { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }[job.status],
    elapsedLabel: duration(end - Date.parse(job.startedAt ?? job.createdAt)),
    elapsedTitle: job.status === 'queued' ? 'Waiting' : job.startedAt ? 'Execution time' : 'Time since queued',
    createdLabel: timestamp(job.createdAt),
    startedLabel: timestamp(job.startedAt),
    updatedLabel: timestamp(job.updatedAt),
    workerLabel: job.workerRegion || (job.workerId ? 'Region not recorded' : job.status === 'queued' ? 'Worker not assigned' : 'Worker not recorded'),
    workerIdLabel: job.workerId || (job.status === 'queued' ? 'Waiting for a worker' : 'Not recorded for this job'),
    heartbeatLabel: Number.isFinite(heartbeatAge) ? `${duration(heartbeatAge)} ago` : 'Not recorded',
    heartbeatTitle: active ? 'Last heartbeat' : 'Final heartbeat',
    warning: stale ? 'No heartbeat for over 90 seconds. The worker may be stalled.' : waiting ? 'Queued for over 90 seconds. A worker has not started this job yet.' : job.status === 'running' && !job.heartbeatAt ? 'This job has no heartbeat data yet. Check the event log for its last reported step.' : null,
    latestEvent: events.at(-1)?.message,
    eventLabel: `${events.length} ${events.length === 1 ? 'event' : 'events'}`,
    emptyLog: active ? 'Tracing is not yet available for this job. This view will update when the worker reports an event.' : 'Tracing was not available for this job. No event log was recorded.',
  }
}

type JobFilter = 'all' | 'active' | 'completed' | 'failed' | 'cancelled'
export function useJobMonitor() {
  const state = useSyncExternalStore(subscribeCanvas, canvasWorkspace.getState, canvasWorkspace.getInitialState)
  const now = useSyncExternalStore(subscribeClock, () => clockTime, () => clockTime)
  const [filter, setFilter] = useState<JobFilter>('all')
  const [refreshing, setRefreshing] = useState(false)
  const [widgetExpanded, setWidgetExpanded] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [focusedId] = useState(() => typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('job'))
  const focusedOnce = useRef(false)
  const focusRef = useCallback((node: HTMLDetailsElement | null) => {
    if (node && !focusedOnce.current) { node.scrollIntoView({ block: 'center' }); focusedOnce.current = true }
  }, [])
  const jobs = state.jobs.map((job) => describeJob(job, now))
  const counts = {
    all: jobs.length,
    active: jobs.filter((job) => job.active).length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    cancelled: jobs.filter((job) => job.status === 'cancelled').length,
  }
  const visibleJobs = jobs.filter((job) => filter === 'all' || (filter === 'active' ? job.active : job.status === filter))
    .sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const refresh = async () => {
    setRefreshing(true)
    try { await refreshCanvas() } finally { setRefreshing(false) }
  }
  return {
    jobs: visibleJobs,
    widgetJobs: visibleJobs.slice(0, 3),
    widgetProps: { open: widgetExpanded, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setWidgetExpanded(event.currentTarget.open) },
    loading: !state.loaded && !state.error,
    error: state.error,
    emptyLabel: state.loaded ? 'No jobs in this view yet.' : 'Job history is unavailable while reconnecting.',
    counts,
    syncLabel: state.syncedAt ? `Updated ${duration(now - state.syncedAt)} ago` : 'Connecting to your workspace…',
    refreshLabel: refreshing ? 'Refreshing…' : 'Refresh',
    refreshProps: { type: 'button' as const, onClick: refresh, disabled: refreshing, 'aria-label': 'Refresh research jobs' },
    filters: ([['all', 'All jobs'], ['active', 'Active'], ['completed', 'Completed'], ['failed', 'Failed'], ['cancelled', 'Cancelled']] as const).map(([value, label]) => ({
      id: value, label, count: counts[value],
      props: { type: 'button' as const, 'aria-pressed': filter === value, onClick: () => setFilter(value) },
    })),
    getJobProps: (job: ReturnType<typeof describeJob>) => ({
      id: `job-${job.id}`,
      ref: focusedId === job.id ? focusRef : undefined,
      open: expanded[job.id] ?? (job.active || job.status === 'failed' || focusedId === job.id),
      'data-status': job.status,
      'data-stale': job.stale || job.waiting,
      onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
        const open = event.currentTarget.open
        setExpanded((current) => current[job.id] === open ? current : { ...current, [job.id]: open })
      },
    }),
  }
}
