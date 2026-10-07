import { sql } from './db'

// Per-workspace credentials (AgentMail, provider API keys). Values are only
// ever returned masked; full values stay server-side for outbound API calls.
export const SETTING_KEYS = ['agentmail', 'northwest', 'mercury', 'stripe'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

// Platform credentials the agent executor provides through its server
// environment. Users never enter these; stored workspace rows are ignored.
export const EXECUTOR_ENV: Record<'mastra' | 'kernel', string> = {
  mastra: 'MASTRA_MEMORY_GATEWAY_KEY',
  kernel: 'KERNEL_API_KEY',
}
export type ExecutorKey = keyof typeof EXECUTOR_ENV

export function executorSecret(key: ExecutorKey): string | undefined {
  return process.env[EXECUTOR_ENV[key]]?.trim() || undefined
}

/** Which executor-provided credentials are present. Booleans only. */
export function executorStatus(): Record<ExecutorKey, boolean> {
  return { mastra: Boolean(executorSecret('mastra')), kernel: Boolean(executorSecret('kernel')) }
}

export type MaskedSetting = { key: SettingKey; set: boolean; hint: string }

function mask(value: string): string {
  return value.length > 4 ? `…${value.slice(-4)}` : '…'
}

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key)
}

export async function listSettings(workspaceId: string): Promise<MaskedSetting[]> {
  const rows = await sql`SELECT key, value FROM phab_workspace_settings WHERE workspace_id = ${workspaceId}::uuid` as { key: string; value: string }[]
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  return SETTING_KEYS.map((key) => {
    const value = stored.get(key)
    return { key, set: Boolean(value), hint: value ? mask(value) : '' }
  })
}

export async function putSetting(workspaceId: string, key: SettingKey, value: string): Promise<void> {
  await sql`INSERT INTO phab_workspace_settings (workspace_id, key, value, updated_at)
    VALUES (${workspaceId}::uuid, ${key}, ${value}, now())
    ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
}

export async function deleteSetting(workspaceId: string, key: SettingKey): Promise<void> {
  await sql`DELETE FROM phab_workspace_settings WHERE workspace_id = ${workspaceId}::uuid AND key = ${key}`
}

/** Full secret for server-side outbound calls. Workspace value wins; falls back
 *  to the worker env var so existing deployments keep working. */
export async function getSecret(workspaceId: string, key: SettingKey): Promise<string | undefined> {
  const envFallback: Record<SettingKey, string | undefined> = {
    agentmail: process.env.AGENTMAIL_API_KEY,
    northwest: process.env.NORTHWEST_ACCESS_TOKEN,
    mercury: process.env.MERCURY_API_TOKEN,
    stripe: process.env.STRIPE_SECRET_KEY,
  }
  try {
      const rows = await sql`SELECT value FROM phab_workspace_settings WHERE workspace_id = ${workspaceId}::uuid AND key = ${key}` as { value: string }[]
    return rows[0]?.value?.trim() || envFallback[key]?.trim() || undefined
  } catch {
    return envFallback[key]?.trim() || undefined
  }
}
