import { createFileRoute } from '@tanstack/react-router'
import { logoutResponse } from '#/server/account'

export const Route = createFileRoute('/api/auth/logout')({
  server: { handlers: { GET: async ({ request }) => logoutResponse(request) } },
})
