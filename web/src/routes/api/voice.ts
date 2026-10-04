import { createFileRoute } from '@tanstack/react-router'
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getCanvas } from '#/server/canvas-db'
import { runCanvasSidecar } from '#/server/canvas-sidecar'
import { isSameOrigin, workspaceSession } from '#/server/workspace'
import { assistantModel } from '#/mastra/gateway'

// One spoken turn: the browser sends the voice transcript so far, the gateway
// model answers, and the client speaks the reply. Research is queued through
// the same canvas sidecar the chat assistant uses.
const VOICE_INSTRUCTIONS = `You are Phab, a personal agent talking with the user on a live voice call.
Keep replies short and conversational, like a phone call — two or three sentences, no markdown, no lists, no emoji. Ask a follow-up when it helps.
When the user asks you to research, find sources, documents or images, or create research cards, call queue_research once with a short title and a self-contained task including the user's requirements. It handles refinements (replacing earlier cards) and removals too.
Once the tool confirms, briefly say the research is queued and cards will appear on the canvas.
Never claim research has started, finished, or produced cards without a tool result confirming it.
If the tool reports an error, explain it honestly; do not pretend the request succeeded.`

const bodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().min(1).max(4000),
  })).min(1).max(40),
  contextStackIds: z.array(z.string().uuid()).max(20).default([]),
})

export const Route = createFileRoute('/api/voice')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return Response.json({ error: 'Voice requests must come from this app.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        }
        const session = workspaceSession(request)
        // session.headers already carries Cache-Control: no-store (+ Set-Cookie when new).
        const respond = (body: Record<string, unknown>, status = 200) =>
          Response.json(body, { status, headers: session.headers })
        try {
          const raw = await request.text()
          if (raw.length > 200_000) return respond({ error: 'This call transcript is too long.' }, 413)
          const parsed = bodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) return respond({ error: 'Invalid voice turn.' }, 400)
          const { messages, contextStackIds } = parsed.data
          const snapshot = await getCanvas(session.id)
          const selected = snapshot.stacks.filter((stack) => contextStackIds.includes(stack.id))
          const jobs: unknown[] = []
          const queueResearch = createTool({
            id: 'queue_research',
            description: 'Queue independent research, source/document/image searches, or new research cards on the canvas. Returns immediately while research continues in the background.',
            inputSchema: z.object({
              title: z.string().min(1).max(120),
              task: z.string().min(1).max(10000),
            }),
            execute: async ({ title, task }) => {
              const result = await runCanvasSidecar({
                workspaceId: session.id, request: `${title}\n${task}`, selected,
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
              })
              jobs.push(...result.jobs, ...result.cancelled)
              return {
                status: result.jobs.length ? 'queued' : 'done',
                summary: result.summary,
                queued: result.jobs.map((job) => ({ jobId: job.id, title: job.title })),
                removedStacks: result.removedStackIds.length,
              }
            },
          })
          const agent = new Agent({
            id: 'voice-turn', name: 'Phab voice', model: assistantModel(),
            instructions: VOICE_INSTRUCTIONS,
            tools: { queue_research: queueResearch },
          })
          const transcript = messages.map((message) => ({ role: message.role, content: message.text.slice(0, 4000) }))
          const response = await agent.generate(transcript as never, {
            maxSteps: 3,
            abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
          })
          const text = response.text.trim().slice(0, 4000)
          if (!text) return respond({ error: 'Phab had nothing to say. Try again.' }, 502)
          return respond({ text, jobs })
        } catch {
          return respond({ error: 'The voice turn failed. Please try again.' }, 502)
        }
      },
    },
  },
})
