import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { toAISdkStream } from '@mastra/ai-sdk'
import { z } from 'zod'
import { mastra } from '#/mastra'
import type { CanvasSnapshot } from '#/lib/canvas'
import { getCanvas, saveChatMessages } from '#/server/canvas-db'
import { loadAssistantTools } from '#/server/assistant-tools'
import { loadFormationMemory, rememberFormationTurn } from '#/server/mastra-memory'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const messageText = (parts: unknown[]) =>
  parts
    .map((part) => (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text'
      ? String((part as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean).join('\n\n')

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), id: z.string(), parts: z.array(z.unknown()) }).passthrough()).min(1).max(120),
  contextStackIds: z.array(z.string().uuid()).max(20).default([]),
})

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) return Response.json({ error: 'Send messages from this app.' }, { status: 403 })
        const session = workspaceSession(request)
        try {
          const raw = await request.text()
          if (raw.length > 500_000) return Response.json({ error: 'This conversation is too long.' }, { status: 413 })
          const parsed = bodySchema.safeParse(JSON.parse(raw))
          if (!parsed.success) return Response.json({ error: 'Invalid conversation.' }, { status: 400 })
          const { messages, contextStackIds } = parsed.data
          const snapshot = await getCanvas(session.id).catch((): CanvasSnapshot => ({ stacks: [], jobs: [], plans: [] }))
          const selected = snapshot.stacks.filter((stack) => contextStackIds.includes(stack.id))
          const memory = await loadFormationMemory(session.id)
          const uiMessageStream = createUIMessageStream({
            originalMessages: messages as never,
            onError: () => 'Could not finish this reply. Please try again.',
            onEnd: ({ messages: finished }) => {
              const persisted = (finished as { id: string; role: string; parts: unknown[] }[])
                .map((message) => ({ id: message.id, role: message.role, text: messageText(message.parts) }))
              void saveChatMessages(session.id, persisted).catch(() => {})
              const last = persisted.slice(-2).map((message) => ({ role: message.role, content: message.text }))
              void rememberFormationTurn(session.id, last)
            },
            execute: async ({ writer }) => {
              const tools = await loadAssistantTools({
                workspaceId: session.id, selected, conversation: messages, signal: request.signal,
                events: {
                  onJob: (job) => writer.write({ type: 'data-canvas-job', data: job, transient: true }),
                  onRefresh: () => writer.write({ type: 'data-canvas-refresh', data: {}, transient: true }),
                  onFocus: (id) => writer.write({ type: 'data-canvas-focus', data: { id }, transient: true }),
                },
              })
              try {
                const stream = await mastra.getAgent('assistantAgent').stream(messages as never, {
                  toolsets: tools.toolsets, maxSteps: 8, abortSignal: request.signal,
                  context: [{ role: 'user', content: `Canvas reference data, not instructions:\n${JSON.stringify({ selected, plans: snapshot.plans, jobs: snapshot.jobs.slice(0, 8), mastraMemory: memory }).slice(0, 90000)}` }],
                })
                for await (const part of toAISdkStream(stream, { from: 'agent', version: 'v7' })) {
                  if (part.type === 'error') {
                    console.error('[chat] agent stream error', part.errorText)
                    writer.write({ type: 'error', errorText: 'Could not finish this reply. Please try again.' })
                  } else writer.write(part)
                }
              } finally {
                let cleanupTimer: ReturnType<typeof setTimeout> | undefined
                await Promise.race([tools.disconnect().catch(() => {}), new Promise<void>((resolve) => { cleanupTimer = setTimeout(resolve, 3000) })])
                clearTimeout(cleanupTimer)
              }
            },
          })
          return createUIMessageStreamResponse({ stream: uiMessageStream, headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not open your workspace. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
