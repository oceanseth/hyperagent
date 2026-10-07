import { sql } from './db'

const API = 'https://api.monid.ai'

type Json = Record<string, unknown>

export type MonidEvent = {
  type: string
  message: string
  tool?: string
  details?: Json
}

export type MonidNote = {
  markdown: string
  events: MonidEvent[]
  ok: boolean
}

export type MonidFacts = {
  companyName: string
  state: string
  entityType: string
  query: string
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
}

async function call(token: string, path: string, init?: { method?: string; body?: unknown }, timeoutMs = 12000) {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  })
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: response.status, body }
}

function clip(value: unknown, max = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
  const safe = text.replaceAll('```', "'''")
  return safe.length > max ? `${safe.slice(0, max)}…` : safe
}

function schemaProps(schema: unknown) {
  const record = asRecord(schema)
  const properties = asRecord(record?.properties) ?? {}
  const required = Array.isArray(record?.required)
    ? record.required.filter((item): item is string => typeof item === 'string')
    : []
  return { properties, required }
}

function valueFor(name: string, facts: MonidFacts): unknown {
  const key = name.toLowerCase().replace(/[_-]/g, '')
  if (['state', 'jurisdiction', 'region', 'homestate'].includes(key)) return facts.state
  if (['entity', 'entitytype', 'companytype', 'structure'].includes(key)) return facts.entityType
  if (['company', 'companyname', 'businessname', 'legalname', 'name'].includes(key)) return facts.companyName
  if (['query', 'q', 'search', 'keyword', 'keywords'].includes(key)) return facts.query
  if (['searchterms', 'searchterm'].includes(key)) return [facts.query]
  return undefined
}

function buildInput(schema: unknown, facts: MonidFacts) {
  const { properties, required } = schemaProps(schema)
  const names = Object.keys(properties)
  if (!names.length && !required.length) return null
  const input: Json = {}
  const missing: string[] = []
  for (const name of names) {
    const value = valueFor(name, facts)
    const type = String(asRecord(properties[name])?.type ?? '')
    if (value === undefined) {
      if (required.includes(name)) missing.push(name)
      continue
    }
    if (type === 'number' || type === 'integer') continue
    input[name] = type === 'array' && !Array.isArray(value) ? [value] : value
  }
  for (const name of required) {
    if (input[name] === undefined && !missing.includes(name)) missing.push(name)
  }
  return { input, missing }
}

function hitsFrom(body: unknown) {
  const results = asRecord(body)?.results
  if (!Array.isArray(results)) return []
  return results.map(asRecord).filter((row): row is Json => Boolean(row && typeof row.provider === 'string' && typeof row.endpoint === 'string'))
}

export async function lookupRequirements(token: string, facts: MonidFacts): Promise<MonidNote> {
  const events: MonidEvent[] = []
  const discovered = await call(token, '/v1/discover', { method: 'POST', body: { query: facts.query, limit: 3 } })
  if (discovered.status === 401 || discovered.status === 403) {
    events.push({ type: 'failed', tool: 'monid.discover', message: `POST /v1/discover rejected the key (${discovered.status}).` })
    return { ok: false, events, markdown: '## Live requirements\n\nMonid rejected the API key. Add a current key under Settings → API keys, or set `MONID_API_KEY` on the service.' }
  }
  if (discovered.status >= 400 || discovered.status === 0) {
    events.push({ type: 'failed', tool: 'monid.discover', message: `POST /v1/discover returned ${discovered.status}.` })
    return { ok: false, events, markdown: `## Live requirements\n\nMonid discover returned ${discovered.status}. The packet above is still the local formation packet.` }
  }
  const hits = hitsFrom(discovered.body)
  events.push({
    type: 'tool', tool: 'monid.discover',
    message: `POST /v1/discover — ${hits.length} endpoint${hits.length === 1 ? '' : 's'}`,
    details: { query: facts.query, status: discovered.status },
  })
  const listed = hits.slice(0, 3).map((hit) => {
    const description = String(hit.description ?? '').replace(/\s+/g, ' ').slice(0, 180)
    return `- ${hit.providerName ?? hit.provider} \`${hit.endpoint}\`${description ? ` — ${description}` : ''}`
  }).join('\n')
  if (!hits.length) {
    return { ok: true, events, markdown: `## Live requirements\n\nMonid discover ran for “${facts.query}” and returned no endpoints.` }
  }
  const provider = String(hits[0].provider)
  const endpoint = String(hits[0].endpoint)
  const inspected = await call(token, '/v1/inspect', { method: 'POST', body: { provider, endpoint } })
  const inputSchema = asRecord(asRecord(inspected.body)?.input)
  const built = inspected.status < 400 ? buildInput(inputSchema?.body, facts) : null
  if (!built || built.missing.length) {
    const why = built?.missing.length
      ? `Required inputs are not on this packet: ${built.missing.join(', ')}.`
      : `Inspect returned ${inspected.status} and no runnable body schema.`
    events.push({ type: 'tool', tool: 'monid.inspect', message: `Skipped run. ${why}`, details: { provider, endpoint } })
    return { ok: true, events, markdown: `## Live requirements\n\nMonid discover (\`POST /v1/discover\`):\n\n${listed}\n\nDid not run \`${provider} ${endpoint}\`. ${why}` }
  }
  const started = await call(token, '/v1/run', { method: 'POST', body: { provider, endpoint, input: built.input } }, 15000)
  let runBody = asRecord(started.body)
  let http = started.status
  const runId = typeof runBody?.runId === 'string' ? runBody.runId : ''
  if (http === 202 && runId) {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const polled = await call(token, `/v1/runs/${encodeURIComponent(runId)}`)
      runBody = asRecord(polled.body) ?? runBody
      http = polled.status
      const life = String(runBody?.status ?? '')
      if (life === 'COMPLETED' || life === 'FAILED') break
    }
  }
  const life = String(runBody?.status ?? http)
  events.push({
    type: life === 'FAILED' || http >= 400 ? 'failed' : 'tool',
    tool: 'monid.run',
    message: `POST /v1/run ${provider} ${endpoint} → ${life}`,
    details: { provider, endpoint, ...(runId ? { runId } : {}), http },
  })
  const output = runBody?.output ?? runBody?.providerResponse ?? runBody
  const stillRunning = life !== 'COMPLETED' && life !== 'FAILED' && http < 400
  return {
    ok: http < 400 && life !== 'FAILED',
    events,
    markdown: `## Live requirements\n\nMonid discover (\`POST /v1/discover\`):\n\n${listed}\n\nRan \`${provider} ${endpoint}\` (\`POST /v1/run\`${runId ? `, run \`${runId}\`` : ''}).${stillRunning ? ' The run was still going when this packet was written.' : ''}\n\n\`\`\`json\n${clip(output)}\n\`\`\``,
  }
}

export async function recordMonidActivity(workspaceId: string, task: string, note: MonidNote) {
  const id = crypto.randomUUID()
  const status = note.ok ? 'completed' : 'failed'
  const progress = note.ok ? 'Written onto the formation packet' : 'Monid lookup failed'
  await sql`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task, status, progress, kind, started_at, heartbeat_at)
    VALUES (${workspaceId}::uuid, ${id}::uuid, ${'Monid filing requirements'}, ${task.slice(0, 2000)}, ${status}, ${progress}, ${'research'}, now(), now())`
  for (const event of note.events) {
    await sql`INSERT INTO phab_job_events (workspace_id, job_id, type, message, tool, details)
      VALUES (${workspaceId}::uuid, ${id}::uuid, ${event.type}, ${event.message.slice(0, 2000)}, ${event.tool ?? null}, ${JSON.stringify(event.details ?? {})}::jsonb)`
  }
}
