import { createFileRoute } from '@tanstack/react-router'
import { deleteSetting, isSettingKey, listSettings, putSetting } from '#/server/settings-db'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

export const Route = createFileRoute('/api/settings')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = workspaceSession(request)
        try {
          return Response.json({ settings: await listSettings(session.id) }, { headers: session.headers })
        } catch { return Response.json({ error: 'Could not load settings.' }, { status: 503, headers: session.headers }) }
      },
      PUT: async ({ request }) => {
        if (!isSameOrigin(request)) return Response.json({ error: 'Forbidden.' }, { status: 403 })
        const session = workspaceSession(request)
        try {
          const body = await request.json() as { key?: string; value?: string }
          const key = body.key ?? ''
          const value = body.value?.trim() ?? ''
          if (!isSettingKey(key)) return Response.json({ error: 'Unknown setting.' }, { status: 400, headers: session.headers })
          if (!value) {
            await deleteSetting(session.id, key)
          } else {
            if (value.length > 4096) return Response.json({ error: 'Value is too long.' }, { status: 400, headers: session.headers })
            await putSetting(session.id, key, value)
          }
          return Response.json({ settings: await listSettings(session.id) }, { headers: session.headers })
        } catch { return Response.json({ error: 'Could not save settings.' }, { status: 503, headers: session.headers }) }
      },
    },
  },
})
