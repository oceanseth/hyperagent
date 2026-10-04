import { createFileRoute } from '@tanstack/react-router'
import { loginResponse } from '#/server/account'

export const Route = createFileRoute('/api/auth/login')({
  server: { handlers: { GET: async ({ request }) => loginResponse(request) } },
})
