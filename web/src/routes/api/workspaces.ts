import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { accountFromRequest } from '#/server/account'
import { claimWorkspace, createOwnedBoard, listBoards } from '#/server/canvas-db'
import { readWorkspaceId, workspaceCookie } from '#/server/workspace'

export const Route = createFileRoute('/api/workspaces')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const account = accountFromRequest(request)
        if (!account) return Response.json({ error: 'Log in to see your boards.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
        try {
          const workspaceId = readWorkspaceId(request)
          if (workspaceId) await claimWorkspace(account.sub, workspaceId)
          const boards = await listBoards(account.sub)
          return Response.json({ boards }, { headers: { 'Cache-Control': 'no-store' } })
        } catch {
          return Response.json({ error: 'Could not load your boards.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
        }
      },
      POST: async ({ request }) => {
        const account = accountFromRequest(request)
        if (!account) return Response.json({ error: 'Log in to make a board.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
        const parsed = z.object({ title: z.string().max(120).optional() }).safeParse(await request.json().catch(() => ({})))
        if (!parsed.success) return Response.json({ error: 'Invalid board.' }, { status: 400 })
        try {
          const board = await createOwnedBoard(account.sub, parsed.data.title ?? '')
          const headers = new Headers({ 'Cache-Control': 'no-store' })
          headers.set('Set-Cookie', workspaceCookie(request, board.workspaceId))
          return Response.json({ code: board.code, title: board.title, url: `/s/${board.code}` }, { headers })
        } catch {
          return Response.json({ error: 'Could not make a board.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
        }
      },
    },
  },
})
