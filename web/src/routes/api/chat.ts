import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { toAISdkStream } from '@mastra/ai-sdk'
import { mastra } from '#/mastra'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = await request.json()
        const stream = await mastra.getAgent('assistantAgent').stream(messages)
        const uiMessageStream = createUIMessageStream({
          originalMessages: messages,
          execute: async ({ writer }) => {
            for await (const part of toAISdkStream(stream, { from: 'agent', version: 'v7' })) {
              await writer.write(part)
            }
          },
        })
        return createUIMessageStreamResponse({ stream: uiMessageStream })
      },
    },
  },
})
