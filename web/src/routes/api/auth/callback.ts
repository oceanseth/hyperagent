import { createFileRoute } from '@tanstack/react-router'
import { callbackResponse } from '#/server/account'

export const Route = createFileRoute('/api/auth/callback')({
  server: { handlers: { GET: async ({ request }) => callbackResponse(request) } },
})
