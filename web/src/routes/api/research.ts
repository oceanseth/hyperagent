import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getCanvas, insertJob } from '#/server/canvas-db'
import { dispatchResearch } from '#/server/dispatch'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  task: z.string().trim().min(1).max(10000),
  contextStackIds: z.array(z.string().uuid()).max(20).default([]),
})

export const Route = createFileRoute('/api/research')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) return Response.json({ error: 'Start research from this app.' }, { status: 403 })
        const session = workspaceSession(request)
        try {
          const raw = await request.text()
          if (raw.length > 50_000) return Response.json({ error: 'This research request is too long.' }, { status: 413, headers: session.headers })
          let body: unknown
          try { body = JSON.parse(raw) }
          catch { return Response.json({ error: 'Invalid research request.' }, { status: 400, headers: session.headers }) }
          const parsed = bodySchema.safeParse(body)
          if (!parsed.success) return Response.json({ error: 'Give research a title and a task of at most 10,000 characters.' }, { status: 400, headers: session.headers })
          const { title, task, contextStackIds } = parsed.data
          const snapshot = await getCanvas(session.id)
          const selected = snapshot.stacks.filter((stack) => contextStackIds.includes(stack.id))
          const job = await insertJob(session.id, title, task, selected)
          // The database is the durable queue. The worker also polls it, so a
          // failed wake-up must not fail a job it may already be processing.
          await dispatchResearch(session.id, job.id).catch(() => {})
          return Response.json({ job }, { status: 202, headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not confirm the research request. Check your canvas before retrying.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
