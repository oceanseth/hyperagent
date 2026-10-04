import { createFileRoute } from '@tanstack/react-router'

const headers = { 'Cache-Control': 'no-store' }

export const Route = createFileRoute('/api/voice')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get('origin')
        if (
          origin !== new URL(request.url).origin ||
          request.headers.get('sec-fetch-site') === 'cross-site'
        ) {
          return Response.json({ error: 'Voice requests must come from this app.' }, { status: 403, headers })
        }

        const apiKey = process.env.XAI_API_KEY
        if (!apiKey) {
          return Response.json({ error: 'Voice is not configured on the server.' }, { status: 503, headers })
        }

        try {
          // Only this short-lived client secret crosses the server boundary.
          const response = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expires_after: { seconds: 300 } }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
          })

          if (!response.ok) {
            return Response.json(
              { error: response.status === 429 ? 'Voice is busy. Try again shortly.' : 'Could not connect to xAI voice. Check the server API key and voice access.' },
              { status: response.status === 429 ? 429 : 502, headers },
            )
          }

          const data = await response.json() as {
            value?: string
            expires_at?: number
            client_secret?: { value?: string; expires_at?: number }
          }
          const secret = data.client_secret ?? data
          if (typeof secret.value !== 'string' || !secret.value) {
            return Response.json({ error: 'xAI did not return a voice session.' }, { status: 502, headers })
          }

          return Response.json({ token: secret.value, expiresAt: secret.expires_at }, { headers })
        } catch {
          return Response.json({ error: 'Voice connection timed out. Please try again.' }, { status: 502, headers })
        }
      },
    },
  },
})
