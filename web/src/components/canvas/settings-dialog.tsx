import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Button } from '#/components/ui/button'

type MaskedSetting = { key: string; set: boolean; hint: string }

const LABELS: Record<string, { label: string; placeholder: string; note?: string }> = {
  agentmail: { label: 'AgentMail API key', placeholder: 'am_…', note: 'Agents get a real inbox per company for formation mail.' },
  xai: { label: 'xAI API key', placeholder: 'xai-…' },
  northwest: { label: 'Northwest access token', placeholder: 'Bearer token' },
  mercury: { label: 'Mercury API token', placeholder: 'secret-token:…' },
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<MaskedSetting[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    fetch('/api/settings')
      .then(async (response) => {
        const data = await response.json() as { settings?: MaskedSetting[]; error?: string }
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="phab-icon-button" title="Settings" aria-label="Settings">
        <Settings size={17} strokeWidth={1.5} />
      </DialogTrigger>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
