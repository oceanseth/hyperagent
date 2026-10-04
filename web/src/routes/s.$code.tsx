import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { loadShareCard } from '#/server/share-card'

// The first HTML response carries the Open Graph tags. Crawlers do not run
// the join redirect, so a pasted /s/<code> link unfurls with the board title.
function JoinSharedSpace() {
  const { code } = Route.useParams()
  const { title } = Route.useLoaderData()
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
      <p role="status">{error ?? `Joining ${title}…`}</p>
    </div>
  )
}

export const Route = createFileRoute('/s/$code')({
  loader: ({ params }) => loadShareCard({ data: params.code }),
  headers: () => ({ 'Cache-Control': 'public, max-age=60' }),
  head: ({ loaderData, params }) => {
    const title = loaderData?.title || 'Shared canvas'
    const origin = loaderData?.origin || 'https://hyperagent.lol'
    const page = `${origin}/s/${params.code}`
    const image = `${origin}/api/og/${params.code}`
    const description = 'A live shared canvas on hyperagent.'
    return {
      meta: [
        { title },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: page },
        { property: 'og:image', content: image },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:site_name', content: 'hyperagent' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
      ],
    }
  },
  component: JoinSharedSpace,
})
