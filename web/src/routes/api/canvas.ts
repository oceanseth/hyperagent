import { createHash } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { recentAgentActivity } from '#/server/agent-activity'
import { getCanvas } from '#/server/canvas-db'
import { importPublishedPlan } from '#/server/plans'
import { workspaceSession } from '#/server/workspace'

export const Route = createFileRoute('/api/canvas')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = workspaceSession(request)
        try {
          const slug = new URL(request.url).searchParams.get('plan')
          if (slug && /^[a-z0-9]{4,32}$/i.test(slug)) await importPublishedPlan(session.id, slug).catch(() => undefined)
          // Realtime topic for this board: a hash, so the secret board id never reaches the page.
          const realtimeTopic = `board:${createHash('sha256').update(session.id).digest('hex')}`
          const [snapshot, agents] = await Promise.all([getCanvas(session.id), recentAgentActivity(session.id)])
          return Response.json({ ...snapshot, realtimeTopic, agents }, { headers: session.headers })
        } catch { return Response.json({ error: 'Could not load saved context. Reconnecting…' }, { status: 503, headers: session.headers }) }
      },
    },
  },
})
