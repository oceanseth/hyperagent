import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { saveLayout } from '#/server/canvas-db'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() })
const pointMap = z.record(z.string().max(120), pointSchema)

// `positions` is the legacy whole-map body. It merges key by key, same as `patch`.
const bodySchema = z.object({
  patch: pointMap.optional(),
  remove: z.array(z.string().max(120)).max(500).optional(),
  positions: pointMap.optional(),
}).superRefine((value, ctx) => {
  const modern = value.patch !== undefined || value.remove !== undefined
  if (modern && value.positions !== undefined) ctx.addIssue('Send positions or patch and remove, not both.')
  const patch = value.positions ?? value.patch ?? {}
  if (Object.keys(patch).length === 0 && (value.remove?.length ?? 0) === 0) ctx.addIssue('Layout change is empty.')
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
          const patch = parsed.data.positions ?? parsed.data.patch ?? {}
          await saveLayout(session.id, patch, parsed.data.remove ?? [])
          return Response.json({ ok: true }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not save the layout. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
