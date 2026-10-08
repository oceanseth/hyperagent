import { useEffect, useRef, useState } from 'react'
import { Activity, Check, Crosshair, Ellipsis, Grid2X2, History, MoreHorizontal, Plus, RotateCcw, Search, Share2, UserRound } from 'lucide-react'
import { clearCanvas, refreshCanvas } from '#/lib/canvas-workspace'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { SettingsDialog } from './settings-dialog'
import type { useInfiniteCanvas } from '#/hooks/use-infinite-canvas'

type Canvas = ReturnType<typeof useInfiniteCanvas>
type Menu = 'identity' | 'overview' | 'more' | 'history'

function useCompactDock() {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const read = () => setCompact(window.innerWidth <= 900)
    read()
    const media = window.matchMedia('(max-width: 900px)')
    window.addEventListener('resize', read)
    media.addEventListener('change', read)
    return () => {
      window.removeEventListener('resize', read)
      media.removeEventListener('change', read)
    }
  }, [])
  return compact
}

export function CanvasDock({ canvas }: { canvas: Canvas }) {
  const compact = useCompactDock()
  const [menu, setMenu] = useState<Menu | null>(null)
  const [settingsSignal, setSettingsSignal] = useState(0)
  const [clearOpen, setClearOpen] = useState(false)
  const title = canvas.workspace.boardTitle ?? ''

  const toggle = (next: Menu) => setMenu((current) => (current === next ? null : next))

  useEffect(() => {
    setMenu(null)
  }, [compact])

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menu])

  const openActivity = () => {
    setMenu(null)
    const details = document.querySelector<HTMLDetailsElement>('[aria-label="Research monitor"] details')
    if (details && !details.open) details.open = true
  }

  return (
    <>
      <nav className="phab-canvas-dock" data-canvas-dock data-canvas-overlay data-compact={compact ? 'true' : 'false'} aria-label="Canvas dock">
        <IdentityItem menu={menu} onToggle={() => toggle('identity')} onOpenSettings={() => { setMenu(null); setSettingsSignal((value) => value + 1) }} />
        <BoardItem title={title} onRename={() => setMenu(null)} />
        {!compact && (
          <button type="button" className="phab-dock-item" data-dock-item="search" {...canvas.searchButtonProps} onClick={() => { setMenu(null); canvas.searchButtonProps.onClick() }}>
            <Search size={16} strokeWidth={1.7} />
            <span className="phab-dock-label" data-dock-label>Search</span>
          </button>
        )}
        <button type="button" className="phab-dock-item" data-dock-item="history" aria-expanded={menu === 'history'} onClick={() => toggle('history')}>
          <History size={16} strokeWidth={1.7} />
          <span className="phab-dock-label" data-dock-label>History</span>
        </button>
        <button type="button" className="phab-dock-item" data-dock-item="activity" onClick={openActivity}>
          <Activity size={16} strokeWidth={1.7} />
          <span className="phab-dock-label" data-dock-label>Activity</span>
        </button>
        <button type="button" className="phab-dock-item" data-dock-item="overview" aria-expanded={menu === 'overview'} onClick={() => toggle('overview')}>
          <Grid2X2 size={16} strokeWidth={1.7} />
          <span className="phab-dock-label" data-dock-label>Overview</span>
        </button>
        <button type="button" className="phab-dock-item" data-dock-item="reset" {...canvas.resetButtonProps} onClick={() => { setMenu(null); canvas.resetButtonProps.onClick() }}>
          <Crosshair size={16} strokeWidth={1.7} />
          <span className="phab-dock-label" data-dock-label>Reset view</span>
        </button>
        <button type="button" className="phab-dock-item" data-dock-item="more" aria-expanded={menu === 'more'} aria-label="More" onClick={() => toggle('more')}>
          <Ellipsis size={16} strokeWidth={1.7} />
          <span className="phab-dock-label" data-dock-label>More</span>
        </button>

        {menu === 'history' && (
          <div className="phab-dock-pop" data-dock-panel="history" role="dialog" aria-label="Canvas history">
            <p>canvas history isn't here yet</p>
          </div>
        )}
        {menu === 'overview' && (
          <div className="phab-dock-pop" data-dock-menu="overview" role="menu">
            <button type="button" data-dock-menu-item="zoom-in" {...canvas.zoomInProps}>Zoom in</button>
            <button type="button" data-dock-menu-item="zoom-out" {...canvas.zoomOutProps}>Zoom out</button>
            <button type="button" data-dock-menu-item="fit" onClick={() => canvas.resetButtonProps.onClick()}>Fit</button>
            <div className="phab-mini-map">{canvas.items.map((item) => <button key={item.id} type="button" className="phab-mini-map-dot" data-kind={item.kind} {...canvas.getOverviewItemProps(item)} />)}</div>
          </div>
        )}
        {menu === 'more' && (
          <div className="phab-dock-pop" data-dock-menu="more" role="menu">
            {compact && (
              <button type="button" data-dock-menu-item="search" onClick={() => { setMenu(null); canvas.searchButtonProps.onClick() }}>
                <Search size={14} /> Search
              </button>
            )}
            <button type="button" data-dock-menu-item="new-note" onClick={() => { canvas.addNoteProps.onClick(); setMenu(null) }}>
              <Plus size={14} /> New note
            </button>
            <BoardRenameButton title={title} onStart={() => setMenu(null)} />
            <button type="button" data-dock-menu-item="clear" disabled={canvas.items.length === 0} onClick={() => { setMenu(null); setClearOpen(true) }}>
              <RotateCcw size={14} /> Clear canvas
            </button>
            <ShareControl shared={canvas.workspace.shared} />
          </div>
        )}
      </nav>
      <ClearCanvasDialog itemCount={canvas.items.length} shared={canvas.workspace.shared} open={clearOpen} onOpenChange={setClearOpen} />
      <SettingsDialog dock openSignal={settingsSignal} />
    </>
  )
}

function IdentityItem({ menu, onToggle, onOpenSettings }: { menu: Menu | null; onToggle: () => void; onOpenSettings: () => void }) {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ account: { name?: string; email?: string } | null }>)
      .then((body) => setName(body.account ? (body.account.name || body.account.email || 'Boards') : ''))
      .catch(() => setName(''))
  }, [])
  const signedIn = !!name
  return (
    <>
      <button type="button" className="phab-dock-item" data-dock-item="identity" aria-label={signedIn ? `Account, ${name}` : 'Log in'} aria-expanded={menu === 'identity'} onClick={onToggle}>
        <UserRound size={16} strokeWidth={1.7} />
        <span className="phab-dock-label" data-dock-label>{signedIn ? 'Account' : 'Log in'}</span>
      </button>
      {menu === 'identity' && (
        <div className="phab-dock-pop" data-dock-menu="identity" role="menu">
          <a data-dock-menu-item="account" href="/boards">Account</a>
          <button type="button" data-dock-menu-item="settings" onClick={onOpenSettings}>Settings</button>
          <a data-dock-menu-item="about" href="/about">About</a>
        </div>
      )}
    </>
  )
}

function BoardItem({ title, onRename }: { title: string; onRename: () => void }) {
  const [editing, setEditing] = useState(false)
  const cancelled = useRef(false)
  const label = title || 'Board'

  useEffect(() => {
    const open = () => { cancelled.current = false; setEditing(true) }
    document.addEventListener('hyperagent:rename-board', open)
    return () => document.removeEventListener('hyperagent:rename-board', open)
  }, [])

  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelled.current = true
        setEditing(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editing])

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

  if (editing) {
    return (
      <input
        className="phab-dock-rename"
        data-dock-item="board"
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

  return (
    <button type="button" className="phab-dock-item phab-dock-board" data-dock-item="board" title={label} onClick={() => { cancelled.current = false; setEditing(true); onRename() }}>
      <MoreHorizontal size={16} strokeWidth={1.7} />
      <span className="phab-dock-label" data-dock-label>{label}</span>
    </button>
  )
}

function BoardRenameButton({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <button
      type="button"
      data-dock-menu-item="rename"
      disabled={!title}
      onClick={() => {
        onStart()
        document.dispatchEvent(new Event('hyperagent:rename-board'))
      }}
    >
      Rename
    </button>
  )
}

function ShareControl({ shared }: { shared: boolean }) {
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
    <div className="phab-dock-share">
      <button type="button" data-dock-menu-item="share" aria-label="Share this board" onClick={() => void share()}>
        {status === 'copied' ? <Check size={14} /> : <Share2 size={14} />}
        <span>{status === 'copied' ? 'Link copied' : status === 'error' ? 'Try again' : shared ? 'Shared' : 'Share'}</span>
      </button>
      {toast && <input readOnly value={toast.url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />}
    </div>
  )
}

function ClearCanvasDialog({ itemCount, shared, open, onOpenChange }: { itemCount: number; shared: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clear = async () => {
    setBusy(true)
    setError(null)
    const failure = await clearCanvas()
    setBusy(false)
    if (failure) setError(failure)
    else onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setError(null) }}>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Keep everything</Button>
          <Button variant="destructive" className="phab-clear-canvas" data-busy={busy} onClick={clear}>{busy ? 'Clearing…' : 'Clear canvas'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
