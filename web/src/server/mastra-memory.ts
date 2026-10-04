import { getSecret } from './settings-db'

const GATEWAY = 'https://gateway-api.mastra.ai'

function threadId(workspaceId: string) {
  return `phab-${workspaceId}`
}

async function gatewayFetch(key: string, path: string, init?: RequestInit) {
  const response = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: /^Bearer\s/i.test(key) ? key : `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(4000),
  })
  if (!response.ok) return null
  return response.json() as Promise<unknown>
}

async function ensureThread(key: string, workspaceId: string) {
  const id = threadId(workspaceId)
  const existing = await gatewayFetch(key, `/v1/memory/threads/${id}`)
  if (existing) return id
  await gatewayFetch(key, '/v1/memory/threads', {
    method: 'POST',
    body: JSON.stringify({
      id,
      resourceId: workspaceId,
      title: 'Company formation',
      metadata: { kind: 'company-formation' },
    }),
  })
  return id
}

export async function loadFormationMemory(workspaceId: string): Promise<string> {
  const key = await getSecret(workspaceId, 'mastra')
  if (!key) return ''
  try {
    const id = await ensureThread(key, workspaceId)
    const [observations, messages] = await Promise.all([
      gatewayFetch(key, `/v1/memory/threads/${id}/observations`) as Promise<{ observations?: string[] | null } | null>,
      gatewayFetch(key, `/v1/memory/threads/${id}/messages?limit=12`) as Promise<{ messages?: Array<{ role?: string; content?: string }> } | null>,
    ])
    const notes = observations?.observations?.filter(Boolean) ?? []
    const recent = (messages?.messages ?? [])
      .map((message) => `${message.role ?? 'user'}: ${String(message.content ?? '').slice(0, 400)}`)
      .filter((line) => line.length > 6)
    const parts = [
      notes.length ? `Mastra observations:\n${notes.map((note) => `- ${note}`).join('\n')}` : '',
      recent.length ? `Mastra thread (recent):\n${recent.join('\n')}` : '',
    ].filter(Boolean)
    return parts.join('\n\n').slice(0, 8000)
  } catch {
    return ''
  }
}

export async function rememberFormationTurn(workspaceId: string, messages: Array<{ role: string; content: string }>) {
  const key = await getSecret(workspaceId, 'mastra')
  if (!key || !messages.length) return
  try {
    const id = await ensureThread(key, workspaceId)
    await gatewayFetch(key, `/v1/memory/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messages: messages.slice(-4).map((message) => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: message.content.slice(0, 4000),
          type: 'text',
        })),
      }),
    })
  } catch {
    // Memory must never break talk.
  }
}
