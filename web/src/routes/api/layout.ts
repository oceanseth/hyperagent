import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { saveLayout } from '#/server/canvas-db'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.object({
  positions: z.record(z.string().max(120), z.object({ x: z.number().finite(), y: z.number().finite() })),
})

// Card positions are part of the shared board: persisting them server-side is
// what lets everyone in a shared session watch items move.
export const Route = createFileRoute('/api/layout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Layout changes must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          const raw = await request.text()
          if (raw.length > 500_000) return Response.json({ error: 'This layout is too large.' }, { status: 413, headers: session.headers })
          const parsed = bodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) return Response.json({ error: 'Invalid layout.' }, { status: 400, headers: session.headers })
          await saveLayout(session.id, parsed.data.positions)
          return Response.json({ ok: true }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not save the layout. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
