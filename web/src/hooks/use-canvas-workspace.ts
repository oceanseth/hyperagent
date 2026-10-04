import { useSyncExternalStore } from 'react'
import type { PointerEvent } from 'react'
import { canvasArtifacts, canvasWorkspace, contextIds, selectedContextIds, subscribeCanvas, toggleContextStack, type CanvasArtifact } from '#/lib/canvas-workspace'

export function useCanvasWorkspace() {
  const state = useSyncExternalStore(subscribeCanvas, canvasWorkspace.getState, canvasWorkspace.getInitialState)
  const artifacts = canvasArtifacts(state)
  const connections = artifacts.filter((item) => item.kind === 'source').map((item) => {
    const summary = artifacts.find((entry) => entry.id === item.stack.id)!
    const x1 = item.x + 130
    const x2 = summary.x - 180
    const bend = Math.max(50, (x2 - x1) * 0.45)
    return { id: item.id, path: `M${x1},${item.y} C${x1 + bend},${item.y} ${x2 - bend},${summary.y} ${x2},${summary.y}` }
  })
  return {
    ...state, artifacts, connections,
    contextCount: contextIds(state).length,
    activeJobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    visibleJobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running').concat(state.jobs.filter((job) => job.status === 'failed')).slice(0, 4),
  }
}

export function useResearchCard(item: CanvasArtifact) {
  const included = useSyncExternalStore(canvasWorkspace.subscribe, () => selectedContextIds().includes(item.stack.id), () => false)
  const source = item.source
  const url = source?.pdfUrl ?? source?.url
  const hostname = source ? new URL(source.url).hostname.replace(/^www\./, '') : ''
  const stopPointer = (event: PointerEvent<HTMLElement>) => event.stopPropagation()
  const pdfPreview = source?.pdfUrl ? new URL(source.pdfUrl) : undefined
  if (pdfPreview) pdfPreview.hash = 'toolbar=0&navpanes=0&view=FitH'
  return {
    included, source, hostname,
    pdfPreview: pdfPreview?.href,
    openLabel: source?.pdfUrl ? 'Open PDF' : 'View source',
    contextLabel: included ? 'In context' : 'Use as context',
    sourceLabel: source?.pdfUrl ? 'PDF DOCUMENT' : source?.imageUrl ? 'VISUAL REFERENCE' : 'SOURCE',
    sourceCountLabel: `${item.stack.sources.length} ${item.stack.sources.length === 1 ? 'source' : 'sources'}`,
    summaryProps: { 'data-canvas-content': true, onPointerDown: stopPointer },
    previewProps: { 'data-canvas-content': true, onPointerDown: stopPointer },
    openProps: { href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${item.label}`, onPointerDown: stopPointer },
    contextProps: {
      type: 'button' as const, 'aria-pressed': included, 'aria-label': `${included ? 'Remove' : 'Include'} ${item.stack.title} ${included ? 'from' : 'in'} context`,
      onPointerDown: stopPointer, onClick: () => toggleContextStack(item.stack.id),
    },
  }
}
