import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Check, Crosshair, Eraser, Grid2X2, Info, Minus, PanelLeft, Plus, Search, Share2, StickyNote, X } from 'lucide-react'
import { ArtifactCard } from '#/components/assistant-ui/elements/artifact-card'
import { field, paper } from '#/components/assistant-ui/elements/surfaces'
import { useCanvasNote, useInfiniteCanvas } from '#/hooks/use-infinite-canvas'
import { cn } from '#/lib/utils'
import { BrowserCard } from './browser-card'
import { ResearchCard } from './research-cards'
import { MonitorWidget } from './monitor-widget'
import { HTreeMark } from '#/components/brand/htree-mark'
import { SettingsDialog } from './settings-dialog'
import { WelcomeDialog } from './welcome-dialog'
import { clearCanvas, refreshCanvas } from '#/lib/canvas-workspace'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'
import { PlanCard, PlanInspector } from './plan-graph'
import './canvas.css'

// A shared board lives at /s/<code>. The wordmark must not send people to /
// or the address bar stops being the link they can hand to someone else.
function boardHref() {
  if (typeof window === 'undefined') return '/'
  return /^\/s\/[a-z0-9]{4,32}$/i.test(window.location.pathname) ? window.location.pathname : '/'
}

export function InfiniteCanvas({ children }: { children: ReactNode }) {
  const canvas = useInfiniteCanvas()
  const [scooterPlaying, setScooterPlaying] = useState(false)
  const [scooterPlaybackId, setScooterPlaybackId] = useState(0)

  return (
    <div className="phab-canvas" data-dragging={canvas.isDragging} {...canvas.canvasProps}>
      <div className="phab-canvas-grid" style={canvas.gridStyle} />

      <header className="phab-canvas-toolbar" data-canvas-overlay>
        <div className="phab-canvas-toolbar-left">
          <a className="phab-wordmark" href={boardHref()} aria-label="hyperagent home" onClick={(event) => {
            if ((event.target as HTMLElement).closest('.htree-mark')) {
              event.preventDefault()
              setScooterPlaybackId((id) => id + 1)
              setScooterPlaying(true)
            }
          }}>
            <HTreeMark size={24} dither />
            <span>hyperagent</span>
          </a>
          <span className="phab-toolbar-divider" />
          <button className="phab-icon-button" {...canvas.spaceButtonProps}><PanelLeft size={17} strokeWidth={1.5} /></button>
          {canvas.workspace.contextCount > 0 && <span className="phab-context-badge">{canvas.workspace.contextCount} in context</span>}
        </div>
        <div className="phab-canvas-toolbar-right">
          <AccountLink />
          {canvas.workspace.shared && canvas.workspace.boardTitle && <BoardTitle title={canvas.workspace.boardTitle} />}
          <ShareButton shared={canvas.workspace.shared} />
          <a className="phab-monitor-link" href="/about" target="_blank" rel="noopener noreferrer" title="What is hyperagent?"><Info size={15} /><span>About</span></a>
          <a className="phab-monitor-link" href="/monitor" target="_blank" rel="noopener noreferrer"><Activity size={15} /><span>Activity</span></a>
          <button className="phab-icon-button" {...canvas.overviewButtonProps}><Grid2X2 size={17} strokeWidth={1.5} /></button>
          <button className="phab-icon-button" {...canvas.resetButtonProps}><Crosshair size={19} strokeWidth={1.5} /></button>
          <span className="phab-toolbar-divider" />
          <button className="phab-icon-button" {...canvas.searchButtonProps}><Search size={18} strokeWidth={1.5} /></button>
          <ClearCanvasDialog itemCount={canvas.items.length} shared={canvas.workspace.shared} />
          <SettingsDialog />
        </div>
      </header>

      <div className="phab-canvas-world" style={canvas.worldStyle}>
        <svg className="phab-canvas-connections" aria-hidden="true">{canvas.workspace.connections.map((connection) => <path key={connection.id} d={connection.path} data-kind={connection.kind} />)}</svg>
        {canvas.items.map((item) => (
          <div className="phab-canvas-object" key={item.id} {...canvas.getItemProps(item)}>
            {item.kind === 'note' && (
              <CanvasNote
                label={item.label}
                text={item.text ?? ''}
                noteProps={canvas.getNoteProps(item)}
                removeProps={canvas.getRemoveNoteProps(item)}
              />
            )}
            {(item.kind === 'source' || item.kind === 'summary') && <ResearchCard item={item} />}
            {(item.kind === 'plan-title' || item.kind === 'plan-node') && <PlanCard item={item} />}
            {item.kind === 'browser' && <BrowserCard item={item} />}
          </div>
        ))}
      </div>

      {canvas.workspace.error && <div className="phab-sync-status" role="status">{canvas.workspace.error}</div>}
      {canvas.selectedPlan && 'plan' in canvas.selectedPlan && <PlanInspector item={canvas.selectedPlan} />}
      <MonitorWidget />
      <WelcomeDialog />

      {scooterPlaying && (
        <div data-canvas-overlay style={{ position: 'fixed', zIndex: 100, right: 20, bottom: 20, width: 320, padding: 12, borderRadius: 14, background: '#171717', border: '1px solid #ffffff22', boxShadow: '0 12px 40px #0009' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, color: '#f2f2ed', fontSize: 13 }}>
            <span>Scooter — Hyper Hyper</span>
            <button className="phab-icon-button" aria-label="Stop Hyper Hyper" onClick={() => setScooterPlaying(false)}><X size={15} /></button>
          </div>
          <iframe key={scooterPlaybackId} title="Scooter — Hyper Hyper" width="100%" height="180" src="https://www.youtube.com/embed/F7aKqJsuPDg?autoplay=1" allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen style={{ display: 'block', border: 0, borderRadius: 8 }} />
        </div>
      )}

      {canvas.panel === 'space' && (
        <aside className="phab-canvas-panel phab-space-panel" data-canvas-overlay>
          <div className="phab-panel-eyebrow">YOUR SPACE</div>
          <h2>A place for your ideas.</h2>
          <p>Make a little room for whatever comes next.</p>
          <button className="phab-add-note" {...canvas.addNoteProps}><Plus size={15} /> Add a note</button>
          <div className="phab-panel-list">
            {canvas.items.map((item) => <button key={item.id} {...canvas.getItemButtonProps(item)}><span className="phab-item-dot" data-kind={item.kind} /><span>{item.label}</span><span className="phab-item-arrow">↗</span></button>)}
          </div>
          <div className="phab-panel-footnote">Drag to explore. Pinch to zoom.</div>
        </aside>
      )}

      {canvas.panel === 'search' && (
        <aside className="phab-canvas-panel phab-search-panel" data-canvas-overlay>
          <div className="phab-search-input"><Search size={16} /><input autoFocus placeholder="Find something in your space…" {...canvas.searchInputProps} /><kbd>esc</kbd></div>
          <div className="phab-panel-list">
            {canvas.filteredItems.map((item) => <button key={item.id} {...canvas.getItemButtonProps(item)}><span className="phab-item-dot" data-kind={item.kind} /><span>{item.label}</span><span className="phab-item-arrow">↗</span></button>)}
            {canvas.filteredItems.length === 0 && <p className="phab-search-empty">Nothing here yet. Try another search.</p>}
          </div>
        </aside>
      )}

      {canvas.panel === 'overview' && (
        <aside className="phab-canvas-panel phab-overview-panel" data-canvas-overlay>
          <div className="phab-panel-eyebrow">YOUR CANVAS</div>
          <div className="phab-mini-map">{canvas.items.map((item) => <button key={item.id} className="phab-mini-map-dot" data-kind={item.kind} {...canvas.getOverviewItemProps(item)} />)}</div>
          <p>Choose an object to jump to it.</p>
        </aside>
      )}

      <div className="phab-canvas-zoom" data-canvas-overlay>
        <button className="phab-icon-button phab-quick-note" title="Add a note" aria-label="Add a note" {...canvas.addNoteProps}><StickyNote size={15} /></button>
        <span className="phab-toolbar-divider" />
        <button className="phab-icon-button" {...canvas.zoomOutProps}><Minus size={14} /></button>
        <button className="phab-zoom-value" {...canvas.resetButtonProps}>{canvas.zoomLabel}</button>
        <button className="phab-icon-button" {...canvas.zoomInProps}><Plus size={14} /></button>
      </div>
      <div className="phab-canvas-overlays" data-canvas-overlay>{children}</div>
    </div>
  )
}

// Clearing is for everyone on a shared board, so it asks first instead of a
// native confirm. Chat history and the share link are kept.
function ClearCanvasDialog({ itemCount, shared }: { itemCount: number; shared: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clear = async () => {
    setBusy(true)
    setError(null)
    const failure = await clearCanvas()
    setBusy(false)
    if (failure) setError(failure)
    else setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null) }}>
      <DialogTrigger className="phab-icon-button" title="Clear canvas" aria-label="Clear canvas" disabled={itemCount === 0}>
        <Eraser size={17} strokeWidth={1.5} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Clear the canvas?</DialogTitle>
          <DialogDescription>
            {itemCount === 1 ? 'The one item' : `All ${itemCount} items`} on this board will be removed, including research, plans, notes and live browsers.
            {shared ? ' Everyone on this shared board sees it cleared. ' : ' '}Your chat history stays.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="phab-monitor-widget-warning" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Keep everything</Button>
          <Button variant="destructive" className="phab-clear-canvas" data-busy={busy} onClick={clear}>{busy ? 'Clearing…' : 'Clear canvas'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccountLink() {
  const [label, setLabel] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ account: { name?: string; email?: string } | null; configured?: boolean }>)
      .then((body) => {
        setConfigured(body.configured !== false)
        setLabel(body.account ? (body.account.name || body.account.email || 'Boards') : '')
      })
      .catch(() => setLabel(''))
  }, [])
  if (label === null) return null
  if (!label) return <a className="phab-monitor-link" href={configured ? '/api/auth/login' : '/boards?error=config'}>Log in</a>
  return <a className="phab-monitor-link phab-board-title" href="/boards">{label}</a>
}

// Click the board name to rename it in place; Enter saves, Escape cancels.
function BoardTitle({ title }: { title: string }) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)

  const save = async (value: string) => {
    setEditing(false)
    const next = value.trim()
    if (cancelled.current || !next || next === title) return
    const response = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename', title: next }),
    })
    if (response.ok) await refreshCanvas()
  }

  if (!editing) {
    return (
      <button type="button" className="phab-monitor-link phab-board-title" title="Rename this board" onClick={() => { cancelled.current = false; setEditing(true) }}>{title}</button>
    )
  }
  return (
    <input
      className="phab-board-title-input"
      aria-label="Board name"
      defaultValue={title}
      maxLength={120}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => void save(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.stopPropagation()
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}

// Mints (or reuses) this workspace's share link and copies it. The server
// names an untitled board with a unique docker-style name (e.g. focused_turing).
// Everyone who opens the link lands on the same live board.
function ShareButton({ shared }: { shared: boolean }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'copied' | 'error'>('idle')
  const [toast, setToast] = useState<{ url: string; title: string; copied: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const share = async () => {
    if (status === 'working') return
    window.clearTimeout(timer.current)
    setStatus('working')
    try {
      const response = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = await response.json() as { url?: string; title?: string; error?: string }
      if (!response.ok || !body.url) throw new Error(body.error)
      const url = `${location.origin}${body.url}`
      const copied = await (navigator.clipboard?.writeText(url).then(() => true, () => false) ?? false)
      setToast({ url, title: body.title ?? '', copied })
      setStatus(copied ? 'copied' : 'idle')
      await refreshCanvas()
      timer.current = window.setTimeout(() => { setStatus('idle'); setToast(null) }, copied ? 4000 : 12_000)
    } catch {
      setStatus('error')
      timer.current = window.setTimeout(() => setStatus('idle'), 2500)
    }
  }

  return (
    <div className="phab-share">
      <button
        type="button"
        className="phab-monitor-link"
        onClick={() => void share()}
        aria-label="Share this board"
        title={shared ? 'This board is shared - copy the invite link' : 'Share this board'}
      >
        {status === 'copied' ? <Check size={15} /> : <Share2 size={15} />}
        <span>{status === 'copied' ? 'Link copied' : status === 'error' ? 'Try again' : shared ? 'Shared' : 'Share'}</span>
      </button>
      {toast && (
        <div className="phab-share-toast" role="status">
          <div className="phab-share-toast-head">
            <span>{toast.copied ? 'Link copied' : 'Copy this link'}{toast.title && <> · <strong>{toast.title}</strong></>}</span>
            <button type="button" aria-label="Dismiss" onClick={() => { window.clearTimeout(timer.current); setToast(null) }}><X size={13} /></button>
          </div>
          <input readOnly value={toast.url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
        </div>
      )}
    </div>
  )
}

function CanvasNote({
  label,
  text,
  noteProps,
  removeProps,
}: {
  label: string
  text: string
  noteProps: ReturnType<ReturnType<typeof useInfiniteCanvas>['getNoteProps']>
  removeProps: ReturnType<ReturnType<typeof useInfiniteCanvas>['getRemoveNoteProps']>
}) {
  const note = useCanvasNote(label, text)

  return (
    <div className="relative w-[280px]">
      <ArtifactCard {...note.artifactProps} />
      <textarea
        className={cn(
          paper,
          field,
          'mt-2 w-full resize-none rounded-[20px] px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground outline-none',
          note.writing ? 'min-h-28 cursor-text touch-auto' : 'sr-only',
        )}
        {...noteProps}
        {...note.fieldProps}
      />
      <button
        type="button"
        className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full border border-border/60 bg-popover text-foreground/55"
        {...removeProps}
      >
        <X size={12} />
      </button>
    </div>
  )
}
