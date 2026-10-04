import type { CanvasBrowser } from '#/lib/canvas'
import { redactResearchSecrets } from './mcp'
import { getSecret } from './settings-db'

// KERNEL cloud browsers for the canvas. The Executor MCP proxy is preferred:
// its connected KERNEL source is discovered by `search` and called through
// `invoke`, so the key never leaves Executor. A workspace KERNEL key (or
// KERNEL_API_KEY) is the fallback, called directly against the KERNEL API.
// Neither path ever returns credentials or raw provider errors to callers.

export class KernelBrowserError extends Error {}

// A short, credential-free reason from a failed Executor call, so a failed
// card says why (wrong tool, bad arguments) without echoing raw responses.
function safeDetail(text: string) {
  const line = redactResearchSecrets(text)
    .replace(/(?:wss?|https?):\/\/\S+/gi, '[URL]')
    .replace(/(?:authorization|cookie|api[-_ ]?key|token|password|secret|credential)\s*["']?\s*[:=][^\n]*/gi, '[omitted]')
    .split(/[\r\n]/).find((part) => part.trim()) ?? ''
  return line.trim().slice(0, 200)
}

function resultShape(text: string) {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? `keys ${Object.keys(parsed).slice(0, 8).join(', ')}` : typeof parsed
  } catch { return 'non-JSON text' }
}

export type KernelSession = { sessionId: string; liveViewUrl: string; provider: CanvasBrowser['provider'] }
type KernelRef = { sessionId: string; provider?: CanvasBrowser['provider'] }

const KERNEL_API = 'https://api.onkernel.com'
// Inactivity timeout. An open live view counts as activity, so the browser
// lives while anyone watches it and is reclaimed shortly after everyone leaves.
const IDLE_TIMEOUT_SECONDS = 600
const VIEWPORT = { width: 1280, height: 800 }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function publicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch { return undefined }
}

// Results arrive as the KERNEL Browser object, an MCP text block holding it,
// or Executor's passthrough wrapping either. Walk them to find the fields.
function findField(value: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text.startsWith('{') && !text.startsWith('[')) return undefined
    try { return findField(JSON.parse(text), key, depth + 1) } catch { return undefined }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findField(entry, key, depth + 1)
      if (found) return found
    }
    return undefined
  }
  if (typeof value !== 'object') return undefined
  const object = value as Record<string, unknown>
  if (typeof object[key] === 'string' && object[key]) return object[key] as string
  for (const entry of Object.values(object)) {
    const found = findField(entry, key, depth + 1)
    if (found) return found
  }
  return undefined
}

export function sessionFromResult(value: unknown): { sessionId: string; liveViewUrl: string } | undefined {
  const sessionId = findField(value, 'session_id')
  const liveViewUrl = publicHttpsUrl(findField(value, 'browser_live_view_url'))
  if (!sessionId || !/^[A-Za-z0-9._-]{1,200}$/.test(sessionId) || !liveViewUrl) return undefined
  return { sessionId, liveViewUrl }
}

// --- Executor: minimal MCP JSON-RPC over streamable HTTP (initialize → call) ---

type Rpc = { session?: string; url: string; headers: Record<string, string>; signal: AbortSignal; nextId: number }

function executorRpc(signal: AbortSignal): Rpc | null {
  const url = process.env.EXECUTOR_MCP_URL?.trim()
  const key = process.env.EXECUTOR_API_KEY?.trim()
  if (!url || !key || !publicHttpsUrl(url)) return null
  return {
    url, signal, nextId: 1,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${key.replace(/^Bearer\s+/i, '')}`,
    },
  }
}

async function rpcCall(rpc: Rpc, method: string, params?: Record<string, unknown>, notification = false): Promise<Record<string, unknown>> {
  const id = notification ? undefined : rpc.nextId++
  const response = await fetch(rpc.url, {
    method: 'POST', redirect: 'error', signal: rpc.signal,
    headers: { ...rpc.headers, ...(rpc.session ? { 'mcp-session-id': rpc.session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(id === undefined ? {} : { id }) }),
  })
  const session = response.headers.get('mcp-session-id')
  if (session) rpc.session = session
  if (!response.ok) throw new KernelBrowserError(`Executor is unavailable (HTTP ${response.status}).`)
  const text = await response.text()
  if (notification) return {}
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
      if (!data) continue
      try {
        const parsed = record(JSON.parse(data))
        if (parsed.id === id) return parsed
      } catch { /* keep scanning frames */ }
    }
    throw new KernelBrowserError('Executor returned an incomplete response.')
  }
  try { return record(JSON.parse(text)) } catch { throw new KernelBrowserError('Could not read the Executor response.') }
}

function toolText(payload: Record<string, unknown>) {
  if (Object.keys(record(payload.error)).length) return { text: '', isError: true }
  const result = record(payload.result)
  const parts: string[] = []
  for (const block of Array.isArray(result.content) ? result.content : []) {
    const item = record(block)
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
  }
  return { text: parts.join('\n'), isError: Boolean(result.isError) }
}

type KernelTools = { manage?: string; create?: string; remove?: string; playwright?: string }

// Executor exposes KERNEL as either its MCP tools (manage_browsers,
// execute_playwright_code) or per-operation API tools. Accept both shapes and
// resolve IDs at call time so renaming the Executor connection needs no deploy.
export function pickKernelTools(items: unknown[]): KernelTools {
  const tools: KernelTools = {}
  for (const entry of items) {
    const item = record(entry)
    if (typeof item.id !== 'string') continue
    const name = `${item.name ?? ''} ${item.id}`.toLowerCase()
    // Pools, profiles and the like also mention browsers; they cannot launch one.
    if (/pool|profile|extension|proxy|replay|telemetry/.test(name)) continue
    if (!/kernel|onkernel|browser/.test(`${name} ${String(item.description ?? '').toLowerCase()}`)) continue
    if (!tools.manage && /manage[_-]?browsers?\b/.test(name)) tools.manage = item.id
    else if (!tools.playwright && /playwright/.test(name)) tools.playwright = item.id
    else if (!tools.create && /(create|new|launch)[_-]?browser|browsers?[._-]?(create|new)\b/.test(name)) tools.create = item.id
    else if (!tools.remove && /(delete|stop|close)[_-]?browser|browsers?[._-]?(delete|remove)\b/.test(name)) tools.remove = item.id
  }
  return tools
}

async function openExecutor(signal: AbortSignal) {
  const rpc = executorRpc(signal)
  if (!rpc) return null
  await rpcCall(rpc, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'phab-kernel-browser', version: '1.0.0' } })
  await rpcCall(rpc, 'notifications/initialized', undefined, true)
  const items: unknown[] = []
  for (const query of ['kernel browser', 'kernel manage browsers playwright']) {
    const found = toolText(await rpcCall(rpc, 'tools/call', { name: 'search', arguments: { query } }))
    if (found.isError) continue
    try {
      const list = record(JSON.parse(found.text)).items
      if (Array.isArray(list)) items.push(...list)
    } catch { /* no usable results for this query */ }
    const tools = pickKernelTools(items)
    if ((tools.manage || (tools.create && tools.remove))) break
  }
  const tools = pickKernelTools(items)
  if (!tools.manage && !tools.create) return null
  const invoke = async (tool: string, args: Record<string, unknown>) => {
    const result = toolText(await rpcCall(rpc, 'tools/call', { name: 'invoke', arguments: { tool, arguments: args } }))
    if (result.isError) {
      const detail = safeDetail(result.text)
      throw new KernelBrowserError(`KERNEL (via Executor ${tool}) failed${detail ? `: ${detail}` : '.'}`)
    }
    return result.text
  }
  return { tools, invoke }
}

// --- Direct KERNEL API fallback (workspace key or KERNEL_API_KEY) ---

async function kernelApi(workspaceId: string, path: string, init: { method: string; body?: unknown; signal: AbortSignal }) {
  const key = (await getSecret(workspaceId, 'kernel'))?.trim()
  if (!key) return null
  const response = await fetch(`${KERNEL_API}${path}`, {
    method: init.method, redirect: 'error', signal: init.signal,
    headers: {
      authorization: `Bearer ${key.replace(/^Bearer\s+/i, '')}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (response.status === 401 || response.status === 403) throw new KernelBrowserError('KERNEL rejected the API key. Update it in Settings.')
  if (response.status === 404 && init.method === 'DELETE') return {}
  if (!response.ok) throw new KernelBrowserError(`KERNEL is unavailable (HTTP ${response.status}).`)
  const text = await response.text()
  try { return text ? JSON.parse(text) as unknown : {} } catch { return {} }
}

const createArgs = (startUrl?: string) => ({
  stealth: true,
  timeout_seconds: IDLE_TIMEOUT_SECONDS,
  viewport: VIEWPORT,
  ...(startUrl ? { start_url: startUrl } : {}),
})

const gotoCode = (url: string) =>
  `await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 45000 }); return await page.title();`

function timeoutSignal(signal: AbortSignal | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function kernelBrowserAvailable(workspaceId: string) {
  const viaExecutor = Boolean(process.env.EXECUTOR_MCP_URL?.trim() && process.env.EXECUTOR_API_KEY?.trim())
  return viaExecutor || Boolean((await getSecret(workspaceId, 'kernel'))?.trim())
}

/** Launches a headful KERNEL browser and returns its live view. */
export async function createKernelBrowser(workspaceId: string, startUrl?: string, parent?: AbortSignal): Promise<KernelSession> {
  const signal = timeoutSignal(parent, 90_000)
  let executorFailure: string | undefined
  try {
    const executor = await openExecutor(signal)
    if (executor) {
      const tool = executor.tools.manage ?? executor.tools.create!
      const text = executor.tools.manage
        ? await executor.invoke(executor.tools.manage, {
          action: 'create', stealth: true, timeout_seconds: IDLE_TIMEOUT_SECONDS,
          viewport_width: VIEWPORT.width, viewport_height: VIEWPORT.height,
        })
        : await executor.invoke(executor.tools.create!, createArgs(startUrl))
      const session = sessionFromResult(text)
      if (session) {
        // The MCP create path has no start_url; navigate explicitly.
        if (startUrl && executor.tools.manage && executor.tools.playwright) {
          await executor.invoke(executor.tools.playwright, { session_id: session.sessionId, code: gotoCode(startUrl) }).catch(() => undefined)
        }
        return { ...session, provider: 'executor' }
      }
      executorFailure = `KERNEL (via Executor ${tool}) returned no live view (${resultShape(text)}).`
    }
  } catch (error) {
    if (signal.aborted) throw new KernelBrowserError('Starting the browser timed out.')
    executorFailure = error instanceof KernelBrowserError ? error.message : 'The Executor connection failed.'
  }
  const created = await kernelApi(workspaceId, '/browsers', { method: 'POST', body: createArgs(startUrl), signal }).catch((error) => {
    if (signal.aborted) throw new KernelBrowserError('Starting the browser timed out.')
    throw error instanceof KernelBrowserError ? error : new KernelBrowserError('KERNEL could not start a browser.')
  })
  if (created === null) {
    throw new KernelBrowserError(executorFailure
      ?? 'KERNEL is not connected. Connect KERNEL in Executor or add a KERNEL key in Settings.')
  }
  const session = sessionFromResult(created)
  if (!session) throw new KernelBrowserError('KERNEL started a browser without a live view.')
  return { ...session, provider: 'kernel' }
}

/** Points an existing session at a new URL. Returns the page title when known. */
export async function navigateKernelBrowser(workspaceId: string, browser: KernelRef, url: string, parent?: AbortSignal) {
  const signal = timeoutSignal(parent, 75_000)
  if (browser.provider === 'executor') {
    const executor = await openExecutor(signal)
    if (!executor?.tools.playwright) throw new KernelBrowserError('KERNEL navigation is not available through Executor.')
    const text = await executor.invoke(executor.tools.playwright, { session_id: browser.sessionId, code: gotoCode(url) })
    return findField(text, 'result')
  }
  const result = await kernelApi(workspaceId, `/browsers/${encodeURIComponent(browser.sessionId)}/playwright/execute`, {
    method: 'POST', body: { code: gotoCode(url), timeout_sec: 60 }, signal,
  })
  if (result === null) throw new KernelBrowserError('KERNEL is not connected.')
  const outcome = record(result)
  if (outcome.success === false) throw new KernelBrowserError('The browser could not open that page.')
  return typeof outcome.result === 'string' ? outcome.result : undefined
}

/** Ends a session. Best effort: an already-expired browser is not an error. */
export async function deleteKernelBrowser(workspaceId: string, browser: KernelRef, parent?: AbortSignal) {
  const signal = timeoutSignal(parent, 30_000)
  if (browser.provider === 'executor') {
    const executor = await openExecutor(signal)
    if (executor?.tools.manage) { await executor.invoke(executor.tools.manage, { action: 'delete', session_id: browser.sessionId }); return }
    if (executor?.tools.remove) { await executor.invoke(executor.tools.remove, { session_id: browser.sessionId, id_or_name: browser.sessionId }); return }
  }
  await kernelApi(workspaceId, `/browsers/${encodeURIComponent(browser.sessionId)}`, { method: 'DELETE', signal })
}
