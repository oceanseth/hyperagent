import { MCPClient } from '@mastra/mcp'

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
  for (const name of ['EXECUTOR_API_KEY', 'XAI_API_KEY', 'COSMOS_TOKEN', 'DATABASE_URL']) {
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

export async function discoverExecutorTools(client: MCPClient) {
  const discovery = await client.listToolsetsWithErrors({ perServerTimeoutMs: 20_000 })
  for (const toolset of Object.values(discovery.toolsets)) {
    for (const tool of Object.values(toolset)) {
      const execute = tool.execute?.bind(tool)
      if (!execute) continue
      tool.description = redactResearchSecrets(tool.description)
      tool.execute = async (input, context) => {
        try {
          const result = await execute(input, context)
          if (result && typeof result === 'object' && 'isError' in result && result.isError) {
            throw new Error('Executor tool failed.')
          }
          // MCP results are JSON data. Redact even successful outputs before
          // passing them to the model, including nested Execute results.
          const serialized = JSON.stringify(result)
          return serialized === undefined ? result : JSON.parse(redactResearchSecrets(serialized))
        } catch {
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
