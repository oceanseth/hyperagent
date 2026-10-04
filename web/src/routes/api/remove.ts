import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { removeFromCanvas } from '#/server/canvas-db'
import { removePlan } from '#/server/plans'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.object({ kind: z.enum(['stack', 'plan']), id: z.string().uuid() })

// Removes one card group for everyone on the board: a research stack with its
// sources (cancelling any job still writing it) or a plan with its children.
export const Route = createFileRoute('/api/remove')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Removals must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid removal.' }, { status: 400, headers: session.headers })
          if (parsed.data.kind === 'stack') await removeFromCanvas(session.id, [parsed.data.id])
          else await removePlan(session.id, parsed.data.id)
          return Response.json({ ok: true }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not remove that from the canvas. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
