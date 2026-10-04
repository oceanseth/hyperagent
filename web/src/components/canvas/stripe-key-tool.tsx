import { useAui, type ToolCallMessagePartComponent } from '@assistant-ui/react'
import { KeyRoundIcon, LoaderCircleIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'

type StripeKeyArgs = { purpose?: string }
type StripeKeyResult = {
  status: 'needs_key' | 'ready' | 'unverified'
  hint?: string
  reason?: string
  accountName?: string
  accountId?: string
}

// Inline form for the request_stripe_key tool. The key goes straight to the
// server-side workspace settings; it never enters the chat transcript, and the
// agent only resumes after it is saved.
export const StripeKeyTool: ToolCallMessagePartComponent<StripeKeyArgs, StripeKeyResult> = ({ args, result, status }) => {
  const aui = useAui()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  if (status.type === 'running' || !result) {
    return (
      <div className="canvas-stripe-key">
        <LoaderCircleIcon aria-hidden="true" className="canvas-stripe-key-spin" size={14} />
        <span>Checking Stripe key…</span>
      </div>
    )
  }

  if (result.status !== 'needs_key' || saved) {
    const hint = saved ?? result.hint
    return (
      <div className="canvas-stripe-key">
        <KeyRoundIcon aria-hidden="true" size={14} />
        <span>
          Stripe key stored {hint}
          {result.accountName && !saved ? ` · ${result.accountName}` : ''}
        </span>
      </div>
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const key = value.trim()
    if (!key) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'stripe', value: key }),
      })
      const data = await response.json() as { settings?: { key: string; hint: string }[]; error?: string }
      if (!response.ok || !data.settings) throw new Error(data.error ?? 'Could not save the key.')
      setValue('')
      setSaved(data.settings.find((entry) => entry.key === 'stripe')?.hint ?? '')
      aui.thread().append('I saved my Stripe key in the secure form. Please continue.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the key.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="canvas-stripe-key canvas-stripe-key-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="canvas-stripe-key-input">
        <KeyRoundIcon aria-hidden="true" size={14} />
        Stripe API key needed{args?.purpose ? ` — ${args.purpose}` : ''}
      </label>
      {result.reason && <p>{result.reason}</p>}
      <div className="canvas-stripe-key-row">
        <input
          id="canvas-stripe-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk_live_… or rk_live_…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Saving…' : 'Save & continue'}
        </button>
      </div>
      <p>Stored server-side for this workspace only. It is never shown in chat.</p>
      {error && <p className="canvas-stripe-key-error">{error}</p>}
    </form>
  )
}
