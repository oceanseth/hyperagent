import { createFileRoute } from '@tanstack/react-router'
import { accountFromRequest, authConfigured } from '#/server/account'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const account = await accountFromRequest(request)
        return Response.json(
          { account: account ?? null, configured: authConfigured() },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})
