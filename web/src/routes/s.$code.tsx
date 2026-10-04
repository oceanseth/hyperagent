import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

// Joining swaps the workspace cookie via a same-origin fetch (a server-side
// redirect cannot: the SameSite=Strict cookie would be dropped on the
// cross-site navigation chain), then lands on the shared board.
function JoinSharedSpace() {
  const { code } = Route.useParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'join', code }),
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (response) => {
        const body = await response.json() as { joined?: boolean; error?: string }
        if (cancelled) return
        if (response.ok && body.joined) location.replace('/')
        else setError(body.error ?? 'This share link is no longer valid.')
      })
      .catch(() => { if (!cancelled) setError('Could not join the shared space. Please try again.') })
    return () => { cancelled = true }
  }, [code])

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', background: '#1b1b1b', color: '#f2f2f3', fontFamily: 'inherit' }}>
      <p role="status">{error ?? 'Joining the shared space…'}</p>
    </div>
  )
}

export const Route = createFileRoute('/s/$code')({ ssr: false, component: JoinSharedSpace })
