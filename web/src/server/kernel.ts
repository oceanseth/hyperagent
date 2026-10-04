import { MCPClient } from '@mastra/mcp'
import { getSecret } from './settings-db'

const DEFAULT_URL = 'https://mcp.onkernel.com/mcp'

export async function kernelConfigured(workspaceId: string) {
  return Boolean((await getSecret(workspaceId, 'kernel'))?.trim())
}

export async function createKernelClient(workspaceId: string, signal?: AbortSignal) {
  const key = (await getSecret(workspaceId, 'kernel'))?.trim()
  if (!key) return null
  const endpoint = process.env.KERNEL_MCP_URL?.trim() || DEFAULT_URL
  let url: URL
  try { url = new URL(endpoint) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return new MCPClient({
    id: `phab-kernel-${crypto.randomUUID()}`,
    servers: {
      kernel: {
        url,
        allowedHosts: [url.host],
        enableServerLogs: false,
        onToolError: 'return',
        connectTimeout: 15_000,
        timeout: 60_000,
        fetch: async (input, init) => {
          const target = new URL(input)
          if (target.origin !== url.origin) throw new Error('KERNEL requested an unsupported connection.')
          const headers = new Headers(init?.headers)
          headers.set('Authorization', /^Bearer\s/i.test(key) ? key : `Bearer ${key}`)
          const signals = [signal, init?.signal, AbortSignal.timeout(60_000)].filter((value): value is AbortSignal => Boolean(value))
          const response = await fetch(input, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) })
          if (!response.ok) return new Response('KERNEL request failed.', { status: response.status })
          return response
        },
      },
    },
  })
}
