import { useEffect, useRef, useState } from 'react'
import { AudioLinesIcon, HistoryIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { canvasWorkspace } from '#/lib/canvas-workspace'

type HistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  modality: 'chat' | 'voice'
  text: string
  at: string
  label?: string
  authorName?: string | null
}

const sameHistory = (a: HistoryMessage[] | null, b: HistoryMessage[]) =>
  a !== null && a.length === b.length && a.every((message, index) => message.id === b[index].id && message.text === b[index].text && message.label === b[index].label && message.authorName === b[index].authorName)

const historyLabel = (message: HistoryMessage) => {
  if (message.label) return message.label
  return message.role === 'user' ? 'You' : 'Phab'
}

const timeLabel = (at: string) => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Expander over the composer showing every saved turn (chat + voice) for this workspace. */
export function ChatHistoryPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<HistoryMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  // Follow the newest message unless the reader has scrolled up into the past.
  const pinnedRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    const load = async (initial: boolean) => {
      if (inFlight) return
      inFlight = true
      try {
        const response = await fetch('/api/history', { signal: AbortSignal.timeout(15_000) })
        const body = await response.json() as { messages?: HistoryMessage[]; error?: string }
        if (cancelled) return
        if (!response.ok || !body.messages) {
          if (initial) setError(body.error ?? 'Could not load your history.')
        } else {
          const next = body.messages
          setError(null)
          setMessages((current) => sameHistory(current, next) ? current : next)
        }
      } catch {
        if (!cancelled && initial) setError('Could not load your history.')
      } finally { inFlight = false }
    }
    void load(true)
    // Every canvas sync (realtime board-changed ping or the poll fallback)
    // re-reads history, so other members' messages appear without a reload.
    let lastSynced = canvasWorkspace.getState().syncedAt
    const unsubscribe = canvasWorkspace.subscribe(() => {
      const synced = canvasWorkspace.getState().syncedAt
      if (synced === lastSynced) return
      lastSynced = synced
      void load(false)
    })
    return () => { cancelled = true; unsubscribe() }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport && messages?.length && pinnedRef.current) viewport.scrollTop = viewport.scrollHeight
  }, [messages])

  return (
    <section className="canvas-conversation" aria-label="Chat history">
      <div className="canvas-conversation-header">
        <HistoryIcon aria-hidden="true" size={15} />
        <span>History</span>
        <button
          type="button"
          className="canvas-conversation-close"
          onClick={onClose}
          aria-label="Hide history"
          title="Hide history"
        >
          <XIcon aria-hidden="true" size={16} />
        </button>
      </div>
      <div
        className="canvas-conversation-viewport"
        ref={viewportRef}
        onScroll={() => {
          const viewport = viewportRef.current
          if (viewport) pinnedRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 48
        }}
      >
        {!messages && !error && (
          <div className="canvas-history-note">
            <LoaderCircleIcon className="canvas-chat-spinner" aria-hidden="true" size={13} />
            Loading your history…
          </div>
        )}
        {error && <div className="canvas-history-note">{error}</div>}
        {messages?.length === 0 && (
          <div className="canvas-history-note">No saved conversations yet. Chat or call Phab and every turn is kept here.</div>
        )}
        {messages?.map((message) => (
          <div key={message.id} className="canvas-message" data-role={message.role}>
            <div className="canvas-message-label">
              {historyLabel(message)}
              {message.modality === 'voice' && <AudioLinesIcon aria-hidden="true" size={12} />}
              <span className="canvas-history-time">{timeLabel(message.at)}</span>
            </div>
            <div className="canvas-message-content canvas-history-text">{message.text}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
