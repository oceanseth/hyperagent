import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { accountFromRequest } from '#/server/account'
import { createShareCode, rememberBoard, renameBoard, resolveShareCode } from '#/server/canvas-db'
import { isSameOrigin, workspaceCookie, workspaceSession } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), title: z.string().max(120).optional() }),
  z.object({
    action: z.literal('rename'),
    title: z.string().min(1).max(120),
    code: z.string().regex(/^[a-z0-9]{4,32}$/i).optional(),
  }),
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
        const account = accountFromRequest(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid share request.' }, { status: 400, headers: session.headers })
          if (parsed.data.action === 'create') {
            const code = await createShareCode(session.id, { title: parsed.data.title, ownerSub: account?.sub })
            return Response.json({ code, url: `/s/${code}`, title: parsed.data.title }, { headers: session.headers })
          }
          if (parsed.data.action === 'rename') {
            const renamed = await renameBoard({
              title: parsed.data.title,
              workspaceId: parsed.data.code ? undefined : session.id,
              code: parsed.data.code,
              ownerSub: account?.sub,
            })
            if (!renamed) return Response.json({ error: 'That board could not be renamed.' }, { status: 404, headers: session.headers })
            return Response.json(renamed, { headers: session.headers })
          }
          const workspaceId = await resolveShareCode(parsed.data.code)
          if (!workspaceId) return Response.json({ error: 'This share link is no longer valid.' }, { status: 404, headers: session.headers })
          if (account) await rememberBoard(account.sub, parsed.data.code)
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
