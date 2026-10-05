import { reportToolEvent, type ResearchToolEventHandler } from './mcp'

// Native search runs server-side through the Executor MCP's Exa connection;
// neither the bearer token nor raw provider errors enter the model's tool
// results or the user's job status.
export class WebSearchError extends Error {}

type SearchSource = { url: string; title?: string; pdfUrl?: string; description?: string }
type SearchInput = {
  query: string
  limit?: number
  signal?: AbortSignal
  onEvent?: ResearchToolEventHandler
  onSources?: (sources: SearchSource[]) => Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

// --- Minimal MCP JSON-RPC client over streamable HTTP (initialize → call) ---

type Rpc = { session?: string; url: string; headers: Record<string, string>; signal: AbortSignal; nextId: number }

function executorEnv(): { url: string; key: string } | null {
  const url = process.env.EXECUTOR_MCP_URL?.trim()
  const key = process.env.EXECUTOR_API_KEY?.trim()
  if (!url || !key) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  } catch { return null }
  return { url, key }
}

async function rpcCall(rpc: Rpc, method: string, params?: Record<string, unknown>, notification = false): Promise<Record<string, unknown>> {
  const id = notification ? undefined : rpc.nextId++
  const response = await fetch(rpc.url, {
    method: 'POST',
    redirect: 'error',
    signal: rpc.signal,
    headers: { ...rpc.headers, ...(rpc.session ? { 'mcp-session-id': rpc.session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(id === undefined ? {} : { id }) }),
  })
  const session = response.headers.get('mcp-session-id')
  if (session) rpc.session = session
  if (response.status === 401 || response.status === 403) throw new WebSearchError('Web search authentication was rejected. Check the server configuration.')
  if (response.status === 429) throw new WebSearchError('Web search is rate limited. Try again shortly.')
  if (!response.ok) throw new WebSearchError(`Web search is unavailable (HTTP ${response.status}). Try again shortly.`)
  const text = await response.text()
  if (notification) return {}
  if (text.length > 4_000_000) throw new WebSearchError('Web search returned an oversized response.')
  // Streamable HTTP servers may answer as JSON or as a short SSE stream.
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
      if (!data) continue
      try {
        const parsed = record(JSON.parse(data))
        if (parsed.id === id) return parsed
      } catch { /* keep scanning frames */ }
    }
    throw new WebSearchError('Web search returned an incomplete response. Try again shortly.')
  }
  try { return record(JSON.parse(text)) } catch { throw new WebSearchError('Could not read the web search response. Try again shortly.') }
}

function toolResult(payload: Record<string, unknown>): { text: string; isError: boolean } {
  const error = record(payload.error)
  if (Object.keys(error).length) return { text: '', isError: true }
  const result = record(payload.result)
  const parts: string[] = []
  for (const block of Array.isArray(result.content) ? result.content : []) {
    const item = record(block)
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
  }
  return { text: parts.join('\n'), isError: Boolean(result.isError) }
}

async function invokeExa(rpc: Rpc, query: string, count: number): Promise<string> {
  await rpcCall(rpc, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'phab-web-search', version: '1.0.0' },
  })
  await rpcCall(rpc, 'notifications/initialized', undefined, true)
  // Resolve the Exa search tool ID at call time so a renamed connection on the
  // Executor side never requires an app redeploy.
  const found = toolResult(await rpcCall(rpc, 'tools/call', { name: 'search', arguments: { query: 'exa web search' } }))
  if (found.isError) throw new WebSearchError('Web search is unavailable right now. Try again shortly.')
  let toolId: string | undefined
  try {
    const items = record(JSON.parse(found.text)).items
    for (const entry of Array.isArray(items) ? items : []) {
      const item = record(entry)
      if (item.name === 'web_search_exa' && typeof item.id === 'string') { toolId = item.id; break }
    }
  } catch { /* fall through to the explicit error below */ }
  if (!toolId) throw new WebSearchError('No web search tool is connected. Check the Executor Exa connection.')
  const invoked = toolResult(await rpcCall(rpc, 'tools/call', {
    name: 'invoke',
    arguments: {
      tool: toolId,
      arguments: {
        query,
        numResults: count,
        objective: `Find up to ${count} relevant, original sources for this query. Prefer primary sources; include direct PDF URLs when a paper or document has one.`,
      },
    },
  }))
  if (invoked.isError || !invoked.text) throw new WebSearchError('Web search could not finish this query. Try a narrower request.')
  // The passthrough wraps Exa's own MCP result; unwrap when it parses as one.
  try {
    const inner = record(JSON.parse(invoked.text))
    const parts: string[] = []
    for (const block of Array.isArray(inner.content) ? inner.content : []) {
      const item = record(block)
      if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
    }
    if (parts.length) return parts.join('\n')
  } catch { /* plain text result */ }
  return invoked.text
}

// Exa returns result blocks of "Title: … / URL: … / Published: … / Highlights: …".
function parseExaResults(text: string): { text: string; sources: SearchSource[] } {
  const sources = new Map<string, SearchSource>()
  let title: string | undefined
  let currentUrl: string | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (/^Title:\s*/i.test(line)) { title = line.replace(/^Title:\s*/i, '').trim().slice(0, 300) || undefined; continue }
    if (/^Highlights?:\s*/i.test(line)) {
      const description = line.replace(/^Highlights?:\s*/i, '').trim().slice(0, 1200) || undefined
      const previous = currentUrl ? sources.get(currentUrl) : undefined
      if (currentUrl && previous && description) sources.set(currentUrl, { ...previous, description })
      continue
    }
    const urlMatch = /^(?:Source |Result )?URL:\s*(\S+)/i.exec(line)
    if (urlMatch) {
      const url = sourceUrl(urlMatch[1])
      if (url && (sources.has(url) || sources.size < 60)) {
        const previous = sources.get(url)
        sources.set(url, {
          url,
          title: title || previous?.title,
          description: previous?.description,
          // This is the exact returned URL, never a guessed publisher URL.
          pdfUrl: /\.pdf$/i.test(new URL(url).pathname) ? url : undefined,
        })
      }
      currentUrl = url
      title = undefined
    }
  }
  return { text: text.trim().slice(0, 40000), sources: [...sources.values()] }
}

async function reportSources(onSources: SearchInput['onSources'], sources: SearchSource[]) {
  if (!onSources || !sources.length) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      onSources(sources),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000) }),
    ])
  } catch {
    // A partial-card write must not discard the final search response.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function searchWeb({ query, limit = 5, signal: jobSignal, onEvent, onSources }: SearchInput) {
  const count = Math.max(1, Math.min(8, Math.trunc(limit)))
  const timeout = AbortSignal.timeout(120_000)
  const signal = jobSignal ? AbortSignal.any([jobSignal, timeout]) : timeout
  await reportToolEvent(onEvent, {
    type: 'request.started', message: 'Web search request started.', tool: 'search_web',
    details: { provider: 'exa', via: 'executor' },
  })
  const startedAt = Date.now()
  try {
    const env = executorEnv()
    if (!env) throw new WebSearchError('Web search is not configured on the server.')
    if (!query.trim() || query.length > 2000) throw new WebSearchError('Use a web search query between 1 and 2,000 characters.')
    const rpc: Rpc = {
      url: env.url,
      signal,
      nextId: 1,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${env.key.replace(/^Bearer\s+/i, '')}`,
      },
    }
    const result = parseExaResults(await invokeExa(rpc, query.trim(), count))
    if (!result.text || !result.sources.length) throw new WebSearchError('Web search returned no usable cited sources. Try a different query.')
    await reportSources(onSources, result.sources)
    await reportToolEvent(onEvent, {
      type: 'request.completed', message: 'Web search request completed.', tool: 'search_web',
      durationMs: Date.now() - startedAt,
      details: { provider: 'exa', via: 'executor', sourceCount: result.sources.length },
    })
    return {
      query,
      ...result,
      evidence: 'Exa search results with titles, exact URLs, and highlight excerpts; not full page text. Sources include encountered pages, which may not all be relevant. Use only sources supported by the excerpts, and label summaries as excerpt-based.',
    }
  } catch (error) {
    const failure = jobSignal?.aborted
      ? new WebSearchError('Web search was cancelled.')
      : timeout.aborted
        ? new WebSearchError('Web search timed out. Try a narrower query.')
        : error instanceof WebSearchError
          ? error
          : new WebSearchError('Could not read the web search response. Try again shortly.')
    await reportToolEvent(onEvent, {
      type: 'request.failed', message: failure.message, tool: 'search_web',
      durationMs: Date.now() - startedAt,
      details: { provider: 'exa', via: 'executor', cancelled: Boolean(jobSignal?.aborted), timedOut: timeout.aborted },
    })
    throw failure
  }
}
