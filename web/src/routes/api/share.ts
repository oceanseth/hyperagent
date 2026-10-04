import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createShareCode, resolveShareCode } from '#/server/canvas-db'
import { isSameOrigin, workspaceCookie, workspaceSession } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }),
  z.object({ action: z.literal('join'), code: z.string().regex(/^[a-z0-9]{4,32}$/i) }),
])

// Shared sessions: 'create' mints a code for the caller's workspace;
// 'join' points the caller's workspace cookie at the shared workspace,
// so every later request reads and writes the same board.
export const Route = createFileRoute('/api/share')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Share requests must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid share request.' }, { status: 400, headers: session.headers })
          if (parsed.data.action === 'create') {
            const code = await createShareCode(session.id)
            return Response.json({ code, url: `/s/${code}` }, { headers: session.headers })
          }
          const workspaceId = await resolveShareCode(parsed.data.code)
          if (!workspaceId) return Response.json({ error: 'This share link is no longer valid.' }, { status: 404, headers: session.headers })
          const headers = new Headers({ 'Cache-Control': 'no-store' })
          headers.set('Set-Cookie', workspaceCookie(request, workspaceId))
          return Response.json({ joined: true }, { headers })
        } catch {
          return Response.json({ error: 'Could not update sharing. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
