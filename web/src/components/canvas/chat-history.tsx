import { useEffect, useRef, useState } from 'react'
import { AudioLinesIcon, HistoryIcon, LoaderCircleIcon, XIcon } from 'lucide-react'

type HistoryMessage = { id: string; role: 'user' | 'assistant'; modality: 'chat' | 'voice'; text: string; at: string }

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

  useEffect(() => {
    let cancelled = false
    fetch('/api/history', { signal: AbortSignal.timeout(15_000) })
      .then(async (response) => {
        const body = await response.json() as { messages?: HistoryMessage[]; error?: string }
        if (cancelled) return
        if (!response.ok || !body.messages) setError(body.error ?? 'Could not load your history.')
        else setMessages(body.messages)
      })
      .catch(() => { if (!cancelled) setError('Could not load your history.') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport && messages?.length) viewport.scrollTop = viewport.scrollHeight
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
      <div className="canvas-conversation-viewport" ref={viewportRef}>
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
              {message.role === 'user' ? 'You' : 'Assistant'}
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
