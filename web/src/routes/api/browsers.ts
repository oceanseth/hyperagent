import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CanvasBrowserError, closeCanvasBrowser, dispatchBrowserAgent, navigateCanvasBrowser, openCanvasBrowser } from '#/server/browser-canvas'
import { KernelBrowserError } from '#/server/kernel-browser'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), url: z.string().max(4096).optional() }),
  z.object({ action: z.literal('navigate'), id: z.string().uuid(), url: z.string().min(1).max(4096) }),
  z.object({ action: z.literal('close'), id: z.string().uuid() }),
  z.object({ action: z.literal('agent'), id: z.string().uuid(), task: z.string().min(1).max(4000) }),
])

// Canvas buttons for live browsers. Closing a card ends its KERNEL session.
export const Route = createFileRoute('/api/browsers')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Browser changes must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid browser change.' }, { status: 400, headers: session.headers })
          const body = parsed.data
          if (body.action === 'close') await closeCanvasBrowser(session.id, body.id)
          else if (body.action === 'agent') await dispatchBrowserAgent(session.id, body.id, body.task)
          else if (body.action === 'navigate') await navigateCanvasBrowser(session.id, body.id, body.url)
          else await openCanvasBrowser(session.id, { url: body.url })
          return Response.json({ ok: true }, { headers: session.headers })
        } catch (error) {
          const text = error instanceof CanvasBrowserError || error instanceof KernelBrowserError ? error.message : 'Could not update the browser. Please try again.'
          return Response.json({ error: text }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
