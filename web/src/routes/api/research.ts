import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getCanvas } from '#/server/canvas-db'
import { runCanvasSidecar } from '#/server/canvas-sidecar'
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
          // The sidecar decides whether this is new research, a refinement that
          // replaces earlier cards, or a removal, then queues the hosted job.
          const result = await runCanvasSidecar({ workspaceId: session.id, request: `${title}\n${task}`, selected, signal: AbortSignal.timeout(20_000) })
          return Response.json({ job: result.jobs[0], jobs: [...result.jobs, ...result.cancelled], summary: result.summary, removedStacks: result.removedStackIds.length }, { status: 202, headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not confirm the research request. Check your canvas before retrying.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
