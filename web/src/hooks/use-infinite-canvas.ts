import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useCanvasWorkspace } from './use-canvas-workspace'
import { canvasArtifacts, canvasWorkspace, moveCanvasArtifact, planArtifacts, saveCanvasLayout, type CanvasArtifact, type PlanArtifact } from '#/lib/canvas-workspace'

type Camera = { x: number; y: number; scale: number }
type LocalCanvasItem = {
  id: string
  kind: 'clock' | 'note'
  label: string
  anchorX: number
  anchorY: number
  x: number
  y: number
  text?: string
}
type CanvasItem = LocalCanvasItem | CanvasArtifact | PlanArtifact
type Drag = {
  pointerId: number
  element: HTMLElement
  startX: number
  startY: number
  x: number
  y: number
  itemId?: string
  scale: number
  startedOnCard: boolean
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, scale: 1 }
const INITIAL_ITEMS: LocalCanvasItem[] = [
  { id: 'clock', kind: 'clock', label: 'Local time', anchorX: 0.355, anchorY: 0.205, x: 0, y: 0 },
]
const clampScale = (scale: number) => Math.min(2, Math.max(0.35, scale))
const isInteractive = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('button, input, textarea, a, iframe, [data-canvas-content], [data-canvas-overlay]'))

export function useInfiniteCanvas() {
  const [camera, setCamera] = useState(INITIAL_CAMERA)
  const [viewport, setViewport] = useState({ width: 1440, height: 900 })
  const [localItems, setItems] = useState(INITIAL_ITEMS)
  const workspace = useCanvasWorkspace()
  const items: CanvasItem[] = [...localItems, ...workspace.artifacts, ...workspace.plans]
  const [now, setNow] = useState(() => new Date())
  const [panel, setPanel] = useState<'space' | 'search' | 'overview' | null>(null)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const nextNote = useRef(1)

  // The ref owns the lifetime of DOM subscriptions, including the non-passive
  // wheel listener needed to keep trackpad pinch inside this canvas.
  const canvasRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node
    if (!node) return
    const measure = () => setViewport({ width: node.clientWidth, height: node.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    const showStack = (stackId: string) => {
      const cards = canvasArtifacts(canvasWorkspace.getState()).filter((item) => item.stack.id === stackId)
      if (!cards.length) return
      const left = Math.min(...cards.map((item) => item.x - (item.kind === 'summary' ? 180 : 130)))
      const right = Math.max(...cards.map((item) => item.x + (item.kind === 'summary' ? 180 : 130)))
      const top = Math.min(...cards.map((item) => item.y - 240))
      const bottom = Math.max(...cards.map((item) => item.y + 240))
      const scale = Math.max(.35, Math.min(1, (node.clientWidth - 80) / (right - left), (node.clientHeight - 240) / (bottom - top)))
      setCamera({ scale, x: node.clientWidth / 2 - (left + right) / 2 * scale, y: (node.clientHeight - 90) / 2 - (top + bottom) / 2 * scale })
    }
    const showPlan = (planId: string) => {
      const cards = planArtifacts(canvasWorkspace.getState()).filter((item) => item.plan.id === planId)
      if (!cards.length) return
      const left = Math.min(...cards.map((item) => item.x - 120))
      const right = Math.max(...cards.map((item) => item.x + 120))
      const top = Math.min(...cards.map((item) => item.y - 80))
      const bottom = Math.max(...cards.map((item) => item.y + 80))
      const scale = Math.max(.35, Math.min(1, (node.clientWidth - 80) / Math.max(right - left, 400), (node.clientHeight - 240) / Math.max(bottom - top, 240)))
      setCamera({ scale, x: node.clientWidth / 2 - (left + right) / 2 * scale, y: (node.clientHeight - 90) / 2 - (top + bottom) / 2 * scale })
    }
    const showNode = (nodeId: string) => {
      const cards = planArtifacts(canvasWorkspace.getState())
      const card = cards.find((item) => item.id === nodeId)
      if (!card) {
        const plan = cards.find((item) => item.plan.states.some((state) => state.id === nodeId))
        if (plan) showPlan(plan.plan.id)
        return
      }
      const scale = 1
      setCamera({
        scale,
        x: node.clientWidth / 2 - card.x * scale,
        y: (node.clientHeight - 90) * 0.38 - card.y * scale,
      })
      setSelectedId(nodeId)
    }
    const unsubscribe = canvasWorkspace.subscribe((state, previous) => {
      const newest = [...state.stacks].reverse().find((stack) => !previous.stacks.some((entry) => entry.id === stack.id))
      if (newest) showStack(newest.id)
      const newestPlan = [...state.plans].reverse().find((plan) => !previous.plans.some((entry) => entry.id === plan.id))
      if (newestPlan) showPlan(newestPlan.id)
      if (state.focus && state.focus.at !== previous.focus?.at) showNode(state.focus.id)
    })
    const lastStack = canvasWorkspace.getState().stacks.at(-1)
    if (lastStack) showStack(lastStack.id)
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-canvas-overlay], [data-canvas-content], textarea, iframe')) return
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1
      setCamera((current) => {
        if (event.ctrlKey || event.metaKey) {
          const rect = node.getBoundingClientRect()
          const x = event.clientX - rect.left
          const y = event.clientY - rect.top
          const scale = clampScale(current.scale * Math.exp(-event.deltaY * multiplier * 0.008))
          const ratio = scale / current.scale
          return { scale, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio }
        }
        return { ...current, x: current.x - event.deltaX * multiplier, y: current.y - event.deltaY * multiplier }
      })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      window.clearInterval(timer)
      unsubscribe()
      node.removeEventListener('wheel', onWheel)
      viewportRef.current = null
    }
  }, [])

  const resetView = () => setCamera(INITIAL_CAMERA)
  const zoom = (factor: number) => setCamera((current) => {
    const scale = clampScale(current.scale * factor)
    const ratio = scale / current.scale
    return {
      scale,
      x: viewport.width / 2 - (viewport.width / 2 - current.x) * ratio,
      y: viewport.height / 2 - (viewport.height / 2 - current.y) * ratio,
    }
  })
  const beginDrag = (event: PointerEvent<HTMLElement>, item?: CanvasItem) => {
    if (event.button !== 0 || (!item && isInteractive(event.target))) return
    if (item && isInteractive(event.target)) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      x: item?.x ?? camera.x,
      y: item?.y ?? camera.y,
      scale: camera.scale,
      itemId: item?.id,
      startedOnCard: event.target instanceof Element && Boolean(event.target.closest('[data-slot="artifact-card"]')),
    }
    setSelectedId(item?.id ?? null)
    setIsDragging(true)
    if (!item) setPanel(null)
  }
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.itemId) {
      const point = { x: current.x + dx / current.scale, y: current.y + dy / current.scale }
      if (workspace.artifacts.some((item) => item.id === current.itemId) || workspace.plans.some((item) => item.id === current.itemId)) moveCanvasArtifact(current.itemId, point)
      else setItems((previous) => previous.map((item) => item.id === current.itemId
        ? { ...item, x: current.x + dx / current.scale, y: current.y + dy / current.scale }
        : item))
    } else {
      setCamera((previous) => ({ ...previous, x: current.x + dx, y: current.y + dy }))
    }
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    if (current.element.hasPointerCapture(event.pointerId)) current.element.releasePointerCapture(event.pointerId)
    const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
    if (current.startedOnCard && moved < 4 && event.type !== 'pointercancel') {
      current.element.querySelector('textarea')?.focus()
    }
    drag.current = null
    setIsDragging(false)
    saveCanvasLayout()
  }
  const centerItem = (item: CanvasItem) => {
    setCamera((current) => ({
      ...current,
      x: viewport.width / 2 - (item.anchorX * viewport.width + item.x) * current.scale,
      y: viewport.height * 0.4 - (item.anchorY * viewport.height + item.y) * current.scale,
    }))
    setSelectedId(item.id)
    setPanel(null)
  }
  const addNote = () => {
    const number = nextNote.current++
    const id = `note-${number}`
    setItems((previous) => [...previous, {
      id,
      kind: 'note',
      label: `Note ${number}`,
      text: '',
      anchorX: 0,
      anchorY: 0,
      x: (viewport.width * 0.5 - camera.x) / camera.scale,
      y: (viewport.height * 0.38 - camera.y) / camera.scale,
    }])
    setSelectedId(id)
    setPanel(null)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setPanel(null)
      setSelectedId(null)
      viewportRef.current?.focus()
      return
    }
    if (isInteractive(event.target)) return
    if (event.key === '0') resetView()
    if (event.key === '+' || event.key === '=') zoom(1.2)
    if (event.key === '-') zoom(1 / 1.2)
  }
  const getItemProps = (item: CanvasItem) => ({
    tabIndex: 0,
    role: 'group' as const,
    'aria-label': `${item.label}. Drag to move, or use arrow keys.`,
    'data-selected': selectedId === item.id,
    'data-kind': item.kind,
    style: { left: item.anchorX * viewport.width + item.x, top: item.anchorY * viewport.height + item.y } as CSSProperties,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => beginDrag(event, item),
    onFocus: () => setSelectedId(item.id),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (isInteractive(event.target)) return
      const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const delta = movement[event.key]
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? 20 : 5
      if (item.kind === 'source' || item.kind === 'summary' || item.kind === 'plan-node' || item.kind === 'plan-title') {
        moveCanvasArtifact(item.id, { x: item.x + delta[0] * step, y: item.y + delta[1] * step })
        saveCanvasLayout()
      } else {
        setItems((previous) => previous.map((entry) => (
          entry.id === item.id
            ? { ...entry, x: entry.x + delta[0] * step, y: entry.y + delta[1] * step }
            : entry
        )))
      }
    },
  })
  const getNoteProps = (item: CanvasItem) => ({
    value: item.text ?? '',
    'aria-label': item.label,
    placeholder: 'An idea worth keeping…',
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      const text = event.target.value
      setItems((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, text } : entry))
    },
  })
  const getItemButtonProps = (item: CanvasItem) => ({ onClick: () => centerItem(item), 'aria-label': `Find ${item.label}` })
  const getRemoveNoteProps = (item: CanvasItem) => ({
    'aria-label': `Delete ${item.label}`,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation(),
    onClick: () => setItems((previous) => previous.filter((entry) => entry.id !== item.id)),
  })
  const overviewPoints = items.map((item) => ({ x: item.anchorX * viewport.width + item.x, y: item.anchorY * viewport.height + item.y }))
  const overviewBounds = {
    left: Math.min(0, ...overviewPoints.map((point) => point.x)),
    right: Math.max(viewport.width, ...overviewPoints.map((point) => point.x)),
    top: Math.min(0, ...overviewPoints.map((point) => point.y)),
    bottom: Math.max(viewport.height, ...overviewPoints.map((point) => point.y)),
  }
  const getOverviewItemProps = (item: CanvasItem) => ({
    ...getItemButtonProps(item),
    style: {
      left: `${6 + (item.anchorX * viewport.width + item.x - overviewBounds.left) / (overviewBounds.right - overviewBounds.left) * 88}%`,
      top: `${10 + (item.anchorY * viewport.height + item.y - overviewBounds.top) / (overviewBounds.bottom - overviewBounds.top) * 80}%`,
    } as CSSProperties,
  })
  const togglePanel = (next: 'space' | 'search' | 'overview') => setPanel((current) => current === next ? null : next)
  const timeLabel = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return {
    workspace,
    items,
    filteredItems: items.filter((item) => `${item.label} ${item.text ?? ''}`.toLowerCase().includes(search.toLowerCase())),
    panel,
    isDragging,
    zoomLabel: `${Math.round(camera.scale * 100)}%`,
    timeLabel,
    clockTicks: Array.from({ length: 60 }, (_, index) => ({
      id: index,
      transform: `rotate(${index * 6} 60 60)`,
      path: index % 5 === 0 ? 'M60 3V11' : 'M60 4V6',
      opacity: index % 5 === 0 ? 1 : 0.45,
    })),
    hourStyle: { transform: `rotate(${(now.getHours() % 12) * 30 + now.getMinutes() * 0.5}deg)` },
    minuteStyle: { transform: `rotate(${now.getMinutes() * 6 + now.getSeconds() * 0.1}deg)` },
    secondStyle: { transform: `rotate(${now.getSeconds() * 6}deg)` },
    canvasProps: {
      ref: canvasRef,
      tabIndex: 0,
      'aria-label': 'Infinite canvas. Drag to pan. Pinch or use the zoom buttons to zoom.',
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => beginDrag(event),
      onPointerMove: moveDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
    gridStyle: { backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`, backgroundPosition: `${camera.x}px ${camera.y}px` },
    worldStyle: { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` },
    spaceButtonProps: { onClick: () => togglePanel('space'), 'aria-label': 'Your space', 'aria-expanded': panel === 'space', title: 'Your space' },
    overviewButtonProps: { onClick: () => togglePanel('overview'), 'aria-label': 'Canvas overview', 'aria-expanded': panel === 'overview', title: 'Canvas overview' },
    searchButtonProps: { onClick: () => togglePanel('search'), 'aria-label': 'Search canvas', 'aria-expanded': panel === 'search', title: 'Search canvas' },
    resetButtonProps: { onClick: resetView, 'aria-label': 'Reset view', title: 'Reset view · 0' },
    zoomInProps: { onClick: () => zoom(1.2), 'aria-label': 'Zoom in', disabled: camera.scale >= 2, title: 'Zoom in · +' },
    zoomOutProps: { onClick: () => zoom(1 / 1.2), 'aria-label': 'Zoom out', disabled: camera.scale <= 0.35, title: 'Zoom out · −' },
    addNoteProps: { onClick: addNote },
    searchInputProps: { value: search, onChange: (event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value), 'aria-label': 'Search objects and notes' },
    getItemProps,
    getNoteProps,
    getItemButtonProps,
    getRemoveNoteProps,
    getOverviewItemProps,
    selectedPlan: items.find((item) => item.id === selectedId && (item.kind === 'plan-node' || item.kind === 'plan-title')),
  }
}

export function useCanvasNote(label: string, text: string) {
  const [writing, setWriting] = useState(false)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0

  return {
    writing,
    artifactProps: {
      title: label,
      meta: words === 0 ? 'Empty note' : `${words} ${words === 1 ? 'word' : 'words'}`,
      generating: writing,
      words,
      onClick: () => fieldRef.current?.focus(),
    },
    fieldProps: {
      ref: fieldRef,
      onFocus: () => setWriting(true),
      onBlur: () => setWriting(false),
    },
  }
}
