import { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'

type MaskedSetting = { key: string; set: boolean; hint: string }

const LABELS: Record<string, { label: string; placeholder: string; note?: string }> = {
  agentmail: { label: 'AgentMail API key', placeholder: 'am_…', note: 'Agents get a real inbox per company for formation mail.' },
  northwest: { label: 'Northwest access token', placeholder: 'Bearer token' },
  mercury: { label: 'Mercury API token', placeholder: 'secret-token:…' },
  stripe: { label: 'Stripe / Atlas key', placeholder: 'sk_… or Atlas token', note: 'Stored for this workspace. Atlas has no public form-an-LLC API — KERNEL drives the Atlas site after you confirm.' },
  monid: { label: 'Monid API key', placeholder: 'monid_live_…', note: 'Prepare packet looks up live filing and bank requirements. The service env is used when this is empty.' },
}

// Provided by the agent executor's server environment; never entered here.
const EXECUTOR_LABELS: Record<string, { label: string; note: string }> = {
  mastra: { label: 'Mastra Memory Gateway', note: 'Company-formation memory across talk and chat.' },
  kernel: { label: 'KERNEL cloud browsers', note: 'Atlas, wyobiz, and any filing site without an API.' },
}

type BoardRow = { code: string; title: string; role: 'owner' | 'member'; live: number }

function currentBoardCode() {
  return /^\/s\/([a-z0-9]{4,32})$/i.exec(window.location.pathname)?.[1]?.toLowerCase() ?? ''
}

function liveLabel(count: number) {
  if (count === 1) return '1 live'
  return `${count} live`
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [boards, setBoards] = useState<BoardRow[] | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState<MaskedSetting[]>([])
  const [executor, setExecutor] = useState<Record<string, boolean>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/workspaces', { cache: 'no-store' })
        if (cancelled) return
        if (response.status === 401) { setSignedIn(false); setBoards([]); return }
        if (!response.ok) return
        const data = await response.json() as { boards?: BoardRow[] }
        setSignedIn(true)
        setBoards(data.boards ?? [])
      } catch {
        if (!cancelled) setBoards([])
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!open) return
    setError(null)
    fetch('/api/settings')
      .then(async (response) => {
        const data = await response.json() as { settings?: MaskedSetting[]; executor?: Record<string, boolean>; error?: string }
        if (data.executor) setExecutor(data.executor)
        if (data.settings) setSettings(data.settings)
        else setError(data.error ?? 'Could not load settings.')
      })
      .catch(() => setError('Could not load settings.'))
  }, [open])

  const save = async (key: string) => {
    setBusy(key)
    setError(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: drafts[key] ?? '' }),
      })
      const data = await response.json() as { settings?: MaskedSetting[]; error?: string }
      if (data.settings) {
        setSettings(data.settings)
        setDrafts((prev) => ({ ...prev, [key]: '' }))
      } else setError(data.error ?? 'Could not save.')
    } catch {
      setError('Could not save.')
    } finally {
      setBusy(null)
    }
  }

  const owned = (boards ?? []).filter((board) => board.role === 'owner')
  const liveTotal = owned.reduce((sum, board) => sum + board.live, 0)
  const here = currentBoardCode()

  const createBoard = async () => {
    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const data = await response.json().catch(() => ({})) as { url?: string }
    if (response.ok && data.url) location.href = data.url
  }

  return (
    <div className="phab-settings" ref={menuRef}>
      <button
        type="button"
        className="phab-icon-button"
        title="Canvases and settings"
        aria-label="Canvases and settings"
        aria-expanded={menu}
        aria-haspopup="menu"
        onClick={() => setMenu((value) => !value)}
      >
        <Settings size={17} strokeWidth={1.5} />
        {liveTotal > 0 && <span className="phab-settings-badge">{liveTotal > 9 ? '9+' : liveTotal}</span>}
      </button>
      {menu && (
        <div className="phab-settings-menu" role="menu">
          <div className="phab-settings-menu-head">
            <span>Your canvases</span>
            <span>{boards === null && signedIn !== false ? '…' : liveLabel(liveTotal)}</span>
          </div>
          {signedIn === false && <p className="phab-settings-note">Log in to see the canvases on this account.</p>}
          {boards === null && signedIn !== false && <p className="phab-settings-note">Loading…</p>}
          {signedIn && owned.length === 0 && <p className="phab-settings-note">No canvases yet.</p>}
          {owned.map((board) => {
            const current = board.code.toLowerCase() === here
            return (
              <a
                key={board.code}
                className="phab-settings-row"
                role="menuitem"
                href={`/s/${board.code}`}
                data-current={current}
                aria-current={current ? 'page' : undefined}
                onClick={() => setMenu(false)}
              >
                <span className="phab-settings-row-title">{board.title}</span>
                <span className="phab-settings-live" data-on={board.live > 0}>{board.live > 0 ? liveLabel(board.live) : 'idle'}</span>
              </a>
            )
          })}
          {signedIn && (
            <button type="button" className="phab-settings-row" role="menuitem" onClick={() => void createBoard()}>
              <span>New canvas</span>
            </button>
          )}
          {signedIn === false && (
            <a className="phab-settings-row" role="menuitem" href="/boards">Log in</a>
          )}
          <div className="phab-settings-rule" />
          <button type="button" className="phab-settings-row" role="menuitem" onClick={() => { setMenu(false); setOpen(true) }}>
            <span>API keys</span>
          </button>
        </div>
      )}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Keys are stored for this workspace only and used server-side. They are never shown again in full.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {settings.map((setting) => {
            const meta = LABELS[setting.key] ?? { label: setting.key, placeholder: '' }
            return (
              <div key={setting.key} className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor={`setting-${setting.key}`}>
                  {meta.label}
                  {setting.set && <span className="ml-2 text-xs text-muted-foreground">saved {setting.hint}</span>}
                </label>
                {meta.note && <p className="text-xs text-muted-foreground">{meta.note}</p>}
                <div className="flex gap-2">
                  <input
                    id={`setting-${setting.key}`}
                    type="password"
                    autoComplete="off"
                    className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2"
                    placeholder={setting.set ? 'Replace key (leave empty + Save to remove)' : meta.placeholder}
                    value={drafts[setting.key] ?? ''}
                    onChange={(event) => setDrafts((prev) => ({ ...prev, [setting.key]: event.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === setting.key || (!setting.set && !(drafts[setting.key] ?? '').trim())}
                    onClick={() => void save(setting.key)}
                  >
                    {busy === setting.key ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            )
          })}
          {Object.entries(EXECUTOR_LABELS).map(([key, meta]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-sm font-medium">
                {meta.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {key in executor ? (executor[key] ? 'configured via executor' : 'not configured on executor') : 'via executor'}
                </span>
              </span>
              <p className="text-xs text-muted-foreground">{meta.note}</p>
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
    </div>
  )
}
