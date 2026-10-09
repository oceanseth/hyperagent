import { createFileRoute } from '@tanstack/react-router'
import { chatAuthorLabel, chatSpeaker, listChatHistory } from '#/server/canvas-db'
import { workspaceSession } from '#/server/workspace'

// Saved conversation turns (chat + voice) for this workspace cookie. Read-only.
export const Route = createFileRoute('/api/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = workspaceSession(request)
        try {
          const speaker = await chatSpeaker(request, session.id)
          const viewer = speaker.author ? { id: speaker.author.id, kind: speaker.author.kind } : null
          const messages = (await listChatHistory(session.id)).map((message) => ({
            ...message,
            label: chatAuthorLabel(message, viewer),
          }))
          return Response.json({ messages }, { headers: session.headers })
        } catch {
          return Response.json({ error: 'Could not load your history. Please try again.' }, { status: 503, headers: session.headers })
        }
      },
    },
  },
})
