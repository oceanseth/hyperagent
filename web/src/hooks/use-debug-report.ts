import { useCallback, useState } from 'react'
import { canvasWorkspace } from '#/lib/canvas-workspace'

const diagnosticKeys = new Set(['model', 'provider', 'region', 'tool', 'toolName', 'error', 'errorCode', 'status', 'statusCode', 'httpStatus', 'code', 'name', 'attempt', 'maxAttempts', 'elapsedMs', 'durationMs', 'sourceCount', 'resultCount', 'retryable', 'version', 'release', 'step', 'stepCount', 'eventCount', 'finishReason', 'toolCallCount', 'toolCount', 'inputTokens', 'outputTokens', 'totalTokens', 'deadlineMs', 'contextStackCount', 'timedOut', 'cancelled'])
function safeText(value: string, limit = 500) {
  return value
    .replace(/https?:\/\/[^\s"<>]+/gi, (value) => {
      try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '[url]' }
    })
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|xai|ghp|gho)[-_][a-z0-9_-]{12,}/gi, '[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, limit)
}

function debugReport(jobId?: string) {
  const state = canvasWorkspace.getState()
  const active = state.jobs.filter((job) => job.status === 'running' || job.status === 'queued')
  const recent = state.jobs.filter((job) => job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled').slice(0, 5)
  const jobs = jobId ? state.jobs.filter((job) => job.id === jobId) : [...active, ...recent]
  return JSON.stringify({
    report: 'phab-research-debug-v1',
    generatedAt: new Date().toISOString(),
    page: `${window.location.origin}${window.location.pathname}`,
    lastSyncedAt: state.syncedAt ? new Date(state.syncedAt).toISOString() : null,
    pollingError: state.error ? safeText(state.error) : null,
    jobsOmitted: state.jobs.length - jobs.length,
    jobs: jobs.map((job) => ({
      id: job.id, status: job.status,
      createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt ?? null,
      heartbeatAt: job.heartbeatAt ?? null,
      workerId: job.workerId ?? null, workerRegion: job.workerRegion ?? null,
      stackId: job.stackId ?? null,
      tracing: job.events?.length ? 'available' : 'not yet available for this job',
      eventsOmitted: Math.max(0, (job.events?.length ?? 0) - 30),
      events: (job.events ?? []).slice(-30).map((event) => ({
        id: event.id, at: event.at, type: safeText(event.type, 80),
        message: safeText(event.message), tool: event.tool ? safeText(event.tool, 100) : undefined,
        durationMs: event.durationMs,
        details: event.details ? Object.fromEntries(Object.entries(event.details)
          .filter(([key, value]) => diagnosticKeys.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
          .map(([key, value]) => [key, typeof value === 'string' ? safeText(value, 300) : value])) : undefined,
      })),
    })),
  }, null, 2)
}

export function useDebugReport() {
  const [status, setStatus] = useState('')
  const [copying, setCopying] = useState(false)
  const [fallback, setFallback] = useState('')
  const selectReport = useCallback((node: HTMLTextAreaElement | null) => { node?.focus(); node?.select() }, [])
  const copy = async (jobId?: string) => {
    const report = debugReport(jobId)
    setCopying(true)
    setFallback('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(report)
      setStatus('Debug report copied. Paste it into your conversation.')
    } catch {
      setFallback(report)
      setStatus('Clipboard unavailable. Copy the selected report below.')
    } finally { setCopying(false) }
  }
  return {
    status,
    fallback,
    label: copying ? 'Copying…' : 'Copy debug report',
    copyProps: { type: 'button' as const, disabled: copying, onClick: () => copy(), 'aria-label': 'Copy research debug report' },
    getJobCopyProps: (id: string) => ({ type: 'button' as const, disabled: copying, onClick: () => copy(id), 'aria-label': `Copy debug report for job ${id}` }),
    fallbackProps: { ref: selectReport, value: fallback, readOnly: true, rows: 10, 'aria-label': 'Debug report to copy manually' },
  }
}
