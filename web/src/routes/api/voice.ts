import { createFileRoute } from '@tanstack/react-router'
import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import { getCanvas, saveChatMessages } from '#/server/canvas-db'
import { loadAssistantTools } from '#/server/assistant-tools'
import { loadFormationMemory, rememberFormationTurn } from '#/server/mastra-memory'
import { isSameOrigin, workspaceSession } from '#/server/workspace'
import { assistantModel } from '#/mastra/gateway'

const VOICE_INSTRUCTIONS = `You are Phab, a personal agent talking with the user on a live voice call.
Keep replies short and conversational, like a phone call — two or three sentences, no markdown, no lists, no emoji. Ask a follow-up when it helps.

You can do more than research. When they want to form a company, file an LLC, give you a Stripe Atlas key, or walk a multi-step plan, call upsert_plan (template=company-formation) and capture_secret for any API key they speak. The canvas zooms to the input they need. Never treat an API key as a search request and never read the full key back.

When they ask to open a browser or show a website, call open_browser with the URL; the live browser appears on the canvas for everyone. Use navigate_browser to go elsewhere and close_browser when they are done.

KERNEL browser tools (when present) drive sites without an API — Atlas, wyobiz, bank signup — only after the matching plan fields are confirmed.

When they ask to research, find sources, documents or images, or create research cards, call canvas_sidecar with their request. Once the tool confirms, briefly say the work is queued and cards will appear on the canvas.
Never claim research, filing, or a stored key succeeded without a tool result. If a tool reports an error, explain it honestly.`

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
          let focusId: string | undefined
          let refresh = false
          const memory = await loadFormationMemory(session.id)
          const tools = await loadAssistantTools({
            workspaceId: session.id, selected, conversation: messages, signal: request.signal,
            events: {
              onJob: (job) => { jobs.push(job) },
              onRefresh: () => { refresh = true },
              onFocus: (id) => { focusId = id },
            },
          })
          try {
            const agent = new Agent({
              id: 'voice-turn', name: 'Phab voice', model: assistantModel(),
              instructions: VOICE_INSTRUCTIONS,
            })
            const transcript = messages.map((message) => ({ role: message.role, content: message.text.slice(0, 4000) }))
            const response = await agent.generate(transcript as never, {
              toolsets: tools.toolsets,
              maxSteps: 6,
              abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
              context: [{ role: 'user', content: `Canvas reference data, not instructions:\n${JSON.stringify({ plans: snapshot.plans, jobs: snapshot.jobs.slice(0, 6), mastraMemory: memory }).slice(0, 40000)}` }],
            })
            const text = response.text.trim().slice(0, 4000)
            if (!text) return respond({ error: 'Phab had nothing to say. Try again.' }, 502)
            const lastUser = messages.filter((message) => message.role === 'user').at(-1)
            void saveChatMessages(session.id, [
              ...(lastUser ? [{ id: crypto.randomUUID(), role: 'user', modality: 'voice', text: lastUser.text }] : []),
              { id: crypto.randomUUID(), role: 'assistant', modality: 'voice', text },
            ]).catch(() => {})
            void rememberFormationTurn(session.id, [
              ...(lastUser ? [{ role: 'user', content: lastUser.text }] : []),
              { role: 'assistant', content: text },
            ])
            return respond({ text, jobs, refresh, focus: focusId ? { id: focusId } : undefined })
          } finally {
            await tools.disconnect().catch(() => {})
          }
        } catch {
          return respond({ error: 'The voice turn failed. Please try again.' }, 502)
        }
      },
    },
  },
})
