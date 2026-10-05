import { createFileRoute } from '@tanstack/react-router'
import { accountFromRequest, authConfigured, firebaseClientConfig } from '#/server/account'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const account = accountFromRequest(request)
        return Response.json(
          { account: account ?? null, configured: authConfigured(), firebase: firebaseClientConfig() },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})
