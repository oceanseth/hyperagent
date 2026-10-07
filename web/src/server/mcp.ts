import { MCPClient } from '@mastra/mcp'

export type ResearchToolEvent = {
  type: string
  message: string
  tool?: string
  durationMs?: number
  details?: Record<string, unknown>
}
export type ResearchToolEventHandler = (event: ResearchToolEvent) => Promise<void>

// Observability must not turn a finished tool call into a failed or stuck job.
export async function reportToolEvent(onEvent: ResearchToolEventHandler | undefined, event: ResearchToolEvent) {
  if (!onEvent) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      onEvent(event),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000) }),
    ])
  } catch {
    // The worker owns telemetry persistence and recovery.
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// Construct per job, not globally: Workers must not share another request's I/O.
// Discovery happens for each job so new Executor connections need no redeploy.
export function createExecutorClient(signal?: AbortSignal) {
  const endpoint = process.env.EXECUTOR_MCP_URL?.trim()
  const key = process.env.EXECUTOR_API_KEY?.trim()
  if (!endpoint || !key) return null
  let url: URL
  try { url = new URL(endpoint) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return new MCPClient({
    id: `phab-${crypto.randomUUID()}`,
    servers: {
      executor: {
        url,
        allowedHosts: [url.host],
        enableServerLogs: false,
        onToolError: 'return',
        connectTimeout: 10_000,
        timeout: 60_000,
        fetch: async (input, init) => {
          const target = new URL(input)
          if (target.origin !== url.origin) throw new Error('Executor requested an unsupported connection.')
          const headers = new Headers(init?.headers)
          headers.set('Authorization', /^Bearer\s/i.test(key) ? key : `Bearer ${key}`)
          try {
            const signals = [signal, init?.signal, AbortSignal.timeout(60_000)].filter((value): value is AbortSignal => Boolean(value))
            const response = await fetch(input, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) })
            if (!response.ok) {
              // Transport errors may echo request headers. Do not let their
              // body reach SDK diagnostics or the research model.
              return new Response('Executor request failed.', { status: response.status })
            }
            return response
          } catch {
            throw new Error('Executor connection failed.')
          }
        },
      },
    },
  })
}

export function redactResearchSecrets(text: string): string {
  let result = text
  for (const name of ['EXECUTOR_API_KEY', 'NEON_AI_GATEWAY_TOKEN', 'COSMOS_TOKEN', 'DATABASE_URL', 'SUPABASE_DATABASE_URL', 'SUPABASE_DIRECT_URL', 'JOBS_SECRET', 'NORTHWEST_ACCESS_TOKEN', 'MERCURY_API_TOKEN', 'KERNEL_API_KEY', 'MASTRA_MEMORY_GATEWAY_KEY', 'STRIPE_SECRET_KEY']) {
    const value = process.env[name]?.trim()
    if (!value) continue
    for (const secret of [value, value.replace(/^Bearer\s+/i, '')]) {
      if (secret.length >= 8) {
        result = result.split(secret).join('[redacted]')
        result = result.split(encodeURIComponent(secret)).join('[redacted]')
      }
    }
  }
  return result.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
}

function errorText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  const error = value as Record<string, unknown>
  if (typeof error.message === 'string') return error.message
  if (typeof error.error === 'string') return error.error
  if (error.error && typeof error.error === 'object' && 'message' in error.error && typeof error.error.message === 'string') {
    return error.error.message
  }
  if (Array.isArray(error.content)) {
    for (const block of error.content) {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') return block.text
    }
  }
  return undefined
}

function safeErrorDetail(value: unknown): string {
  let detail = redactResearchSecrets(errorText(value) ?? 'Executor returned an error without a message.')
  // Keep only the error summary, never dumps of headers, requests or responses.
  detail = detail
    .replace(/https?:\/\/[^\s<>"']+/gi, (value) => {
      try { const url = new URL(value); return `${url.origin}${url.pathname}` }
      catch { return '[URL omitted]' }
    })
    .replace(/\b(?:sk-|xai-|msk_|nt_live_)[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret|credential|headers|request|response)\s*["']?\s*[:=][^\n]*/gi, '[sensitive details omitted]')
  return detail.split(/[\r\n]/, 1)[0].trim().slice(0, 400) || 'Executor tool failed.'
}

export async function discoverExecutorTools(client: MCPClient, onEvent?: ResearchToolEventHandler) {
  const discovery = await client.listToolsetsWithErrors({ perServerTimeoutMs: 20_000 })
  for (const toolset of Object.values(discovery.toolsets)) {
    for (const tool of Object.values(toolset)) {
      const execute = tool.execute?.bind(tool)
      if (!execute) continue
      tool.description = redactResearchSecrets(tool.description)
      tool.execute = async (input, context) => {
        const name = redactResearchSecrets(tool.id).slice(0, 160)
        await reportToolEvent(onEvent, { type: 'tool.started', message: 'Executor tool started.', tool: name })
        const startedAt = Date.now()
        let failureDetail: string | undefined
        try {
          const result = await execute(input, context)
          if (result && typeof result === 'object' && 'isError' in result && result.isError) {
            failureDetail = safeErrorDetail(result)
            throw new Error('Executor tool failed.')
          }
          // MCP results are JSON data. Redact even successful outputs before
          // passing them to the model, including nested Execute results.
          const serialized = JSON.stringify(result)
          const safeResult = serialized === undefined ? result : JSON.parse(redactResearchSecrets(serialized))
          await reportToolEvent(onEvent, {
            type: 'tool.completed', message: 'Executor tool completed.', tool: name,
            durationMs: Date.now() - startedAt,
          })
          return safeResult
        } catch (error) {
          await reportToolEvent(onEvent, {
            type: 'tool.failed', message: 'Executor tool failed.', tool: name,
            durationMs: Date.now() - startedAt,
            details: { error: failureDetail ?? safeErrorDetail(error) },
          })
          throw new Error('Executor could not complete this tool request. Use another available source or report the limitation.')
        }
      }
    }
  }
  return {
    toolsets: discovery.toolsets,
    // Never expose raw SDK discovery errors, which can include credentials.
    available: Object.values(discovery.toolsets).some((tools) => Object.keys(tools).length > 0),
  }
}
