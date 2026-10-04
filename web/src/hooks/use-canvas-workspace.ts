import { useState, useSyncExternalStore } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { MouseEvent, PointerEvent, WheelEvent } from 'react'
import { browserArtifacts, canvasArtifacts, canvasWorkspace, contextIds, noteArtifacts, planArtifacts, planConnections, removeStack, selectedContextIds, subscribeCanvas, toggleContextStack, type CanvasArtifact } from '#/lib/canvas-workspace'

export function useCanvasWorkspace() {
  const state = useSyncExternalStore(subscribeCanvas, canvasWorkspace.getState, canvasWorkspace.getInitialState)
  const artifacts = canvasArtifacts(state)
  const plans = planArtifacts(state)
  const noteItems = noteArtifacts(state)
  const browserItems = browserArtifacts(state)
  const researchConnections = artifacts.filter((item) => item.kind === 'source').map((item) => {
    const summary = artifacts.find((entry) => entry.id === item.stack.id)!
    const x1 = item.x + 130
    const x2 = summary.x - 180
    const bend = Math.max(50, (x2 - x1) * 0.45)
    return { id: item.id, kind: 'research' as const, path: `M${x1},${item.y} C${x1 + bend},${item.y} ${x2 - bend},${summary.y} ${x2},${summary.y}` }
  })
  return {
    ...state, artifacts, plans, noteItems, browserItems,
    connections: [...researchConnections, ...planConnections(plans)],
    contextCount: contextIds(state).length,
    activeJobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    visibleJobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running').concat(state.jobs.filter((job) => job.status === 'failed')).slice(0, 4),
  }
}

export function useResearchCard(item: CanvasArtifact) {
  const included = useSyncExternalStore(canvasWorkspace.subscribe, () => selectedContextIds().includes(item.stack.id), () => false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [embeddable, setEmbeddable] = useState<boolean | undefined>()
  const source = item.source
  const pdfUrl = source?.pdfUrl ?? (source && /\.pdf$/i.test(new URL(source.url).pathname) ? source.url : undefined)
  const url = pdfUrl ?? source?.url
  const hostname = source ? new URL(source.url).hostname.replace(/^www\./, '') : ''
  const stopPointer = (event: PointerEvent<HTMLElement>) => event.stopPropagation()
  const pdfPreview = pdfUrl ? new URL(pdfUrl) : undefined
  if (pdfPreview) pdfPreview.hash = 'toolbar=0&navpanes=0&view=FitH'
  const status = item.stack.status ?? 'complete'
  const openViewer = () => {
    setViewerOpen(true)
    if (pdfUrl && embeddable === undefined) checkEmbeddable(pdfUrl, setEmbeddable)
  }
  return {
    included, source, hostname, pdfUrl,
    viewerState: embeddable === undefined ? 'checking' : embeddable ? 'ready' : 'blocked',
    working: status === 'working',
    failed: status === 'failed',
    status,
    statusLabel: status === 'working' ? 'Still working' : status === 'failed' ? 'Partial result' : 'Complete',
    statusText: item.stack.statusText ?? (status === 'working' ? 'New sources and findings will appear as the work continues.' : status === 'failed' ? 'The worker stopped before finishing. Available findings are kept here.' : null),
    pdfPreview: pdfPreview?.href,
    openLabel: pdfUrl ? 'Open PDF' : 'View source',
    contextLabel: included ? 'In context' : 'Use as context',
    sourceLabel: pdfUrl ? 'PDF DOCUMENT' : source?.imageUrl ? 'VISUAL REFERENCE' : 'SOURCE',
    sourceCountLabel: `${item.stack.sources.length} ${item.stack.sources.length === 1 ? 'source' : 'sources'}`,
    summaryProps: { 'data-canvas-content': true, onPointerDown: stopPointer },
    previewProps: pdfUrl
      ? { 'data-canvas-content': true, role: 'button', tabIndex: 0, 'aria-label': `View ${item.label}`, onPointerDown: stopPointer, onClick: openViewer }
      : { 'data-canvas-content': true, onPointerDown: stopPointer },
    openProps: pdfUrl
      ? { href: url, 'aria-label': `View ${item.label}`, onPointerDown: stopPointer, onClick: (event: MouseEvent) => { event.preventDefault(); openViewer() } }
      : { href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${item.label}`, onPointerDown: stopPointer },
    viewerProps: { open: viewerOpen, onOpenChange: setViewerOpen },
    viewerScopeProps: { onPointerDown: stopPointer, onWheel: (event: WheelEvent<HTMLElement>) => event.stopPropagation() },
    removeProps: {
      'aria-label': `Remove ${item.stack.title} and its sources from the canvas`, title: 'Remove from canvas',
      onPointerDown: stopPointer, onClick: () => removeStack(item.stack.id),
    },
    contextProps: {
      type: 'button' as const, 'aria-pressed': included, 'aria-label': `${included ? 'Remove' : 'Include'} ${item.stack.title} ${included ? 'from' : 'in'} context`,
      onPointerDown: stopPointer, onClick: () => toggleContextStack(item.stack.id),
    },
  }
}

function checkEmbeddable(url: string, done: Dispatch<SetStateAction<boolean | undefined>>) {
  fetch(`/api/embeddable?url=${encodeURIComponent(url)}`)
    .then((response) => response.json() as Promise<{ embeddable: boolean }>)
    .then((result) => done(result.embeddable))
    .catch(() => done(false))
}
