import { useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { Bot, CircleAlert, ExternalLink, Globe, LoaderCircle, Maximize2, Minimize2, SendHorizontal, X } from 'lucide-react'
import type { CanvasBrowser } from '#/lib/canvas'
import { askBrowserAgent, closeBrowser, type BrowserArtifact } from '#/lib/canvas-workspace'
import './browser-card.css'

// Card widths; the live view keeps the 1280×800 browser viewport's 16:10 ratio.
const SIZES = { compact: 640, regular: 960 } as const
const stopPointer = (event: PointerEvent<HTMLElement>) => event.stopPropagation()

function hostname(url?: string) {
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : 'New tab' } catch { return url ?? 'New tab' }
}

export function BrowserCard({ item }: { item: BrowserArtifact }) {
  const { browser } = item
  const [size, setSize] = useState<keyof typeof SIZES>('regular')
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const loading = browser.status === 'starting' || (browser.status === 'ready' && loadedUrl !== browser.liveViewUrl)
  const host = hostname(browser.url)

  return (
    <article className="phab-browser" data-status={browser.status} style={{ width: SIZES[size] }}>
      <header className="phab-browser-bar">
        <span className="phab-browser-title"><Globe size={13} /><span>{browser.title}</span></span>
        <span className="phab-browser-address" title={browser.url}>{host}</span>
        <span className="phab-browser-state" data-status={browser.status}>
          {loading ? <LoaderCircle size={11} className="phab-browser-spinner" /> : browser.status === 'failed' ? <CircleAlert size={11} /> : <span className="phab-browser-live-dot" />}
          {browser.status === 'failed' ? 'Failed' : loading ? 'Starting' : 'Live'}
        </span>
        <span className="phab-browser-actions">
          {browser.liveViewUrl && (
            <a href={browser.liveViewUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${browser.title} in a new tab`} title="Open in a new tab" onPointerDown={stopPointer}>
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button" onPointerDown={stopPointer}
            onClick={() => setSize(size === 'regular' ? 'compact' : 'regular')}
            aria-label={size === 'regular' ? 'Make browser smaller' : 'Make browser larger'}
            title={size === 'regular' ? 'Smaller' : 'Larger'}
          >
            {size === 'regular' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button type="button" onPointerDown={stopPointer} onClick={() => closeBrowser(browser.id)} aria-label={`Close ${browser.title} and end its session`} title="Close browser">
            <X size={14} />
          </button>
        </span>
      </header>
      <div className="phab-browser-view" data-canvas-content onPointerDown={stopPointer}>
        {browser.status === 'ready' && browser.liveViewUrl && (
          <iframe
            key={browser.liveViewUrl}
            src={browser.liveViewUrl}
            title={`Live browser: ${browser.title}`}
            allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => setLoadedUrl(browser.liveViewUrl ?? null)}
          />
        )}
        {browser.status === 'failed' ? (
          <div className="phab-browser-overlay" role="alert">
            <CircleAlert size={18} />
            <p>{browser.statusText ?? 'The browser could not be started.'}</p>
            <button type="button" onClick={() => closeBrowser(browser.id)}>Remove</button>
          </div>
        ) : loading && (
          <div className="phab-browser-overlay" role="status">
            <LoaderCircle size={18} className="phab-browser-spinner" />
            <p>{browser.status === 'starting' ? browser.statusText ?? 'Starting a cloud browser…' : 'Connecting to the live view…'}</p>
          </div>
        )}
      </div>
      {browser.status === 'ready' && <AgentBar browserId={browser.id} agent={browser.agent} />}
    </article>
  )
}

const AGENT_LABEL = { queued: 'Queued', running: 'Working', completed: 'Done', failed: 'Stopped' } as const

// The Fly browser agent attached to this session: its live step or last
// result, plus a field anyone on the board can use to give it a task.
function AgentBar({ browserId, agent }: { browserId: string; agent?: CanvasBrowser['agent'] }) {
  const [task, setTask] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const active = agent && (agent.status === 'queued' || agent.status === 'running')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = task.trim()
    if (!text || sending) return
    setSending(true)
    setError(undefined)
    const failure = await askBrowserAgent(browserId, text)
    setSending(false)
    if (failure) setError(failure)
    else setTask('')
  }
  return (
    <footer className="phab-browser-agent" data-canvas-content onPointerDown={stopPointer} data-status={agent?.status}>
      {agent && (
        <div className="phab-browser-agent-status" role="status" aria-live="polite">
          {active ? <LoaderCircle size={12} className="phab-browser-spinner" /> : <Bot size={12} />}
          <span className="phab-browser-agent-label">Agent · {AGENT_LABEL[agent.status]}</span>
          <span className="phab-browser-agent-text" title={agent.result ?? agent.step ?? agent.task}>
            {active ? agent.step ?? agent.task : agent.result ?? agent.task}
          </span>
        </div>
      )}
      <form className="phab-browser-agent-form" onSubmit={submit}>
        <Bot size={13} aria-hidden />
        <input
          value={task} onChange={(event) => setTask(event.target.value)} maxLength={4000}
          placeholder={active ? 'The agent is working…' : 'Ask the browser agent to click, fill, or read something…'}
          aria-label="Task for the browser agent" disabled={sending || Boolean(active)}
        />
        <button type="submit" disabled={!task.trim() || sending || Boolean(active)} aria-label="Send to the browser agent" title="Send to the browser agent">
          {sending ? <LoaderCircle size={13} className="phab-browser-spinner" /> : <SendHorizontal size={13} />}
        </button>
      </form>
      {error && <p className="phab-browser-agent-error" role="alert">{error}</p>}
    </footer>
  )
}
