import { createFileRoute } from '@tanstack/react-router'
import { listInboxes, provisionCompanyInboxes } from '#/server/agentmail'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

export const Route = createFileRoute('/api/agentmail')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = workspaceSession(request)
        try {
          return Response.json({ inboxes: await listInboxes(session.id) }, { headers: session.headers })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not list inboxes.'
          return Response.json({ error: message }, { status: 503, headers: session.headers })
        }
      },
      // Provision one inbox per agent for a company. Called by the UI and by
      // the formation state machine when a company is created.
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) return Response.json({ error: 'Forbidden.' }, { status: 403 })
        const session = workspaceSession(request)
        try {
          const body = await request.json() as { company?: string; agents?: string[] }
          const company = body.company?.trim() ?? ''
          const agents = (body.agents ?? []).map((agent) => String(agent).trim()).filter(Boolean).slice(0, 25)
          if (!company) return Response.json({ error: 'Company name is required.' }, { status: 400, headers: session.headers })
          if (agents.length === 0) return Response.json({ error: 'At least one agent is required.' }, { status: 400, headers: session.headers })
          const result = await provisionCompanyInboxes(session.id, company, agents)
          return Response.json(result, { headers: session.headers })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not provision inboxes.'
          return Response.json({ error: message }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
