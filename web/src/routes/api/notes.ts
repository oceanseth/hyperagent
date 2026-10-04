import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { removeNote, upsertNote } from '#/server/canvas-db'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('upsert'),
    note: z.object({
      id: z.string().uuid(),
      label: z.string().max(200),
      body: z.string().max(20_000),
      x: z.number().finite(),
      y: z.number().finite(),
    }),
  }),
  z.object({ action: z.literal('remove'), id: z.string().uuid() }),
])

export const Route = createFileRoute('/api/notes')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Note changes must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid note change.' }, { status: 400, headers: session.headers })
          if (parsed.data.action === 'upsert') await upsertNote(session.id, parsed.data.note)
          else await removeNote(session.id, parsed.data.id)
          return Response.json({ ok: true }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not save the note. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
