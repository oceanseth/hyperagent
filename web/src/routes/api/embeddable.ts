import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/embeddable')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get('url')
        if (!target || !/^https?:/.test(target)) return Response.json({ embeddable: false })
        try {
          const response = await fetch(target, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } })
          response.body?.cancel()
          const frameOptions = response.headers.get('x-frame-options')
          const frameAncestors = response.headers.get('content-security-policy')?.match(/frame-ancestors([^;]*)/i)?.[1].trim()
          const blocked = !response.ok || !!frameOptions || (!!frameAncestors && !frameAncestors.includes('*'))
          return Response.json({ embeddable: !blocked }, { headers: { 'cache-control': 'public, max-age=3600' } })
        } catch {
          return Response.json({ embeddable: false })
        }
      },
    },
  },
})
