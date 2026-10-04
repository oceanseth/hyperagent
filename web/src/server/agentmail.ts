import { getSecret } from './settings-db'

// AgentMail (agentmail.to) — email inboxes for agents. One inbox per agent,
// provisioned when a company is created, so formation state machines can send
// and receive real mail (registered-agent notices, EIN letters, bank checks).
const API_BASE = 'https://api.agentmail.to/v0'

export type AgentInbox = {
  inboxId: string
  address: string
  displayName?: string
  agent: string
}

async function request(key: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${key}`)
  if (init?.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  return response
}

export async function agentmailConfigured(workspaceId: string): Promise<boolean> {
  return Boolean(await getSecret(workspaceId, 'agentmail'))
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

/** Create (or reuse) one inbox per agent for a company. Usernames look like
 *  `<company>-<agent>@agentmail.to`. Returns every successful inbox plus a
 *  list of failures; never throws on a single-agent failure. */
export async function provisionCompanyInboxes(
  workspaceId: string,
  company: string,
  agents: string[],
): Promise<{ inboxes: AgentInbox[]; failures: { agent: string; reason: string }[] }> {
  const key = await getSecret(workspaceId, 'agentmail')
  if (!key) throw new Error('AgentMail is not configured. Add an API key in Settings.')

  const companySlug = slugify(company)
  if (!companySlug) throw new Error('Company name is required.')

  const inboxes: AgentInbox[] = []
  const failures: { agent: string; reason: string }[] = []

  for (const agent of agents) {
    const agentSlug = slugify(agent)
    if (!agentSlug) { failures.push({ agent, reason: 'Agent name is empty after normalization.' }); continue }
    const username = `${companySlug}-${agentSlug}`.slice(0, 60)
    try {
      const response = await request(key, '/inboxes', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: `${agent} @ ${company}` }),
      })
      if (!response.ok) {
        // 409 = already exists; treat as reuse so provisioning is idempotent.
        if (response.status !== 409) {
          failures.push({ agent, reason: `AgentMail responded ${response.status}.` })
          continue
        }
      }
      const data = response.status === 409
        ? { inbox_id: `${username}@agentmail.to` }
        : await response.json() as { inbox_id?: string; display_name?: string }
      const inboxId = data.inbox_id ?? `${username}@agentmail.to`
      inboxes.push({ inboxId, address: inboxId, displayName: `${agent} @ ${company}`, agent })
    } catch {
      failures.push({ agent, reason: 'AgentMail request failed.' })
    }
  }
  return { inboxes, failures }
}

export async function listInboxes(workspaceId: string): Promise<{ inboxId: string; displayName?: string }[]> {
  const key = await getSecret(workspaceId, 'agentmail')
  if (!key) return []
  const response = await request(key, '/inboxes')
  if (!response.ok) throw new Error(`AgentMail responded ${response.status}.`)
  const data = await response.json() as { inboxes?: { inbox_id: string; display_name?: string }[] }
  return (data.inboxes ?? []).map((inbox) => ({ inboxId: inbox.inbox_id, displayName: inbox.display_name }))
}

export async function listMessages(workspaceId: string, inboxId: string, limit = 20) {
  const key = await getSecret(workspaceId, 'agentmail')
  if (!key) throw new Error('AgentMail is not configured. Add an API key in Settings.')
  const response = await request(key, `/inboxes/${encodeURIComponent(inboxId)}/messages?limit=${limit}`)
  if (!response.ok) throw new Error(`AgentMail responded ${response.status}.`)
  return response.json()
}

export async function sendMessage(
  workspaceId: string,
  inboxId: string,
  message: { to: string[]; subject: string; text: string },
) {
  const key = await getSecret(workspaceId, 'agentmail')
  if (!key) throw new Error('AgentMail is not configured. Add an API key in Settings.')
  const response = await request(key, `/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    method: 'POST',
    body: JSON.stringify(message),
  })
  if (!response.ok) throw new Error(`AgentMail responded ${response.status}.`)
  return response.json()
}
