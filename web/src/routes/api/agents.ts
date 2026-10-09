import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { accountFromRequest } from '#/server/account'
import { createAgentToken, listBoardAgents, revokeAgentToken } from '#/server/agent-tokens'
import { client } from '#/server/db'
import { isSameOrigin, readWorkspaceId } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().max(80) }),
  z.object({
    action: z.literal('revoke'),
    id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  }),
])

const noStore = { 'Cache-Control': 'no-store' }

// The create response is the only payload that may carry the hak_ secret.
// List and revoke stay on id, name, and color.
function publicAgent(agent: { id: string; name: string; color: string | null; revoked_at: Date | null }) {
  return {
    id: agent.id,
    name: agent.name,
    color: agent.color,
    revoked_at: agent.revoked_at ? agent.revoked_at.toISOString() : null,
  }
}

function colorRequired(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /color/i.test(message) && /null/i.test(message)
}

// Share-cookie access is not membership. The caller must be signed in and
// already listed on this board.
async function memberWorkspace(request: Request) {
  const account = await accountFromRequest(request)
  if (!account) {
    return { error: Response.json({ error: 'Log in to connect an agent.' }, { status: 401, headers: noStore }) }
  }
  const workspaceId = readWorkspaceId(request)
  if (!workspaceId) {
    return { error: Response.json({ error: 'Open a board you belong to.' }, { status: 403, headers: noStore }) }
  }
  const rows = await client().$queryRaw<{ code: string }[]>`
    SELECT s.code FROM phab_share_codes s
    JOIN phab_board_members m ON m.code = s.code
    WHERE s.workspace_id = ${workspaceId}::uuid AND m.sub = ${account.sub}
    LIMIT 1`
  if (!rows[0]) {
    return { error: Response.json({ error: 'Only a board member can connect an agent.' }, { status: 403, headers: noStore }) }
  }
  return { account, workspaceId }
}

export const Route = createFileRoute('/api/agents')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const member = await memberWorkspace(request)
          if ('error' in member) return member.error
          const agents = await listBoardAgents(member.workspaceId)
          return Response.json({ agents: agents.map(publicAgent) }, { headers: noStore })
        } catch {
          return Response.json({ error: 'Could not load agents.' }, { status: 503, headers: noStore })
        }
      },
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Connect an agent from this app.' }, { status: 403, headers: noStore })
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'Invalid agent request.' }, { status: 400, headers: noStore })
        try {
          const member = await memberWorkspace(request)
          if ('error' in member) return member.error
          if (parsed.data.action === 'revoke') {
            const revoked = await revokeAgentToken(member.workspaceId, parsed.data.id)
            if (!revoked) return Response.json({ error: 'That agent is not active on this board.' }, { status: 404, headers: noStore })
            return Response.json({ revoked: true, id: parsed.data.id }, { headers: noStore })
          }
          const name = parsed.data.name.trim()
          if (!name) return Response.json({ error: 'Name the agent first.' }, { status: 400, headers: noStore })
          const created = await createAgentToken(member.workspaceId, name, member.account.sub)
          return Response.json({ token: created.token, agent: publicAgent(created.agent) }, { headers: noStore })
        } catch (error) {
          if (colorRequired(error)) {
            return Response.json({ error: 'Agent color is required by the database.', reason: 'color_required' }, { status: 503, headers: noStore })
          }
          return Response.json({ error: 'Could not update agents.' }, { status: 503, headers: noStore })
        }
      },
    },
  },
})
