import { createFileRoute } from '@tanstack/react-router'
import { sessionResponse } from '#/server/account'

export const Route = createFileRoute('/api/auth/session')({
  server: { handlers: { POST: async ({ request }) => sessionResponse(request) } },
})
