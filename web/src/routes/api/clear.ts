import { createFileRoute } from '@tanstack/react-router'
import { closeAllCanvasBrowsers } from '#/server/browser-canvas'
import { clearCanvas } from '#/server/canvas-db'
import { clearPlans } from '#/server/plans'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

// Clears the whole board for everyone on it. Browsers are closed first so
// their KERNEL sessions end; the next poll converges every participant.
export const Route = createFileRoute('/api/clear')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Clearing must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          await closeAllCanvasBrowsers(session.id).catch(() => undefined)
          await Promise.all([clearCanvas(session.id), clearPlans(session.id).catch(() => undefined)])
          return Response.json({ ok: true }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not clear the canvas. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
