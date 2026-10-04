import { createFileRoute } from '@tanstack/react-router'
import { getShareCard } from '#/server/canvas-db'
import { renderOgCard } from '#/server/og-card'

export const Route = createFileRoute('/api/og/$code')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const card = /^[a-z0-9]{4,32}$/i.test(params.code) ? await getShareCard(params.code).catch(() => undefined) : undefined
        const png = renderOgCard(card?.title || 'Shared canvas')
        return new Response(new Uint8Array(png), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=300',
          },
        })
      },
    },
  },
})
