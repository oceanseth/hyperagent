import { neon } from '@neondatabase/serverless'

// Per-workspace credentials (AgentMail, provider API keys). Values are only
// ever returned masked; full values stay server-side for outbound API calls.
export const SETTING_KEYS = ['agentmail', 'northwest', 'mercury', 'stripe', 'mastra', 'kernel'] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

export type MaskedSetting = { key: SettingKey; set: boolean; hint: string }

let schemaReady: Promise<void> | undefined
function database() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Settings storage is not configured.')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(15000) } })
}

async function ready() {
  const sql = database()
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS phab_workspace_settings (
      workspace_id uuid NOT NULL, key text NOT NULL, value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, key)
    )`
  })().catch((error) => { schemaReady = undefined; throw error })
  await schemaReady
  return sql
}

function mask(value: string): string {
  return value.length > 4 ? `…${value.slice(-4)}` : '…'
}

export function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(key)
}

export async function listSettings(workspaceId: string): Promise<MaskedSetting[]> {
  const sql = await ready()
  const rows = await sql`SELECT key, value FROM phab_workspace_settings WHERE workspace_id = ${workspaceId}` as { key: string; value: string }[]
  const stored = new Map(rows.map((row) => [row.key, row.value]))
  return SETTING_KEYS.map((key) => {
    const value = stored.get(key)
    return { key, set: Boolean(value), hint: value ? mask(value) : '' }
  })
}

export async function putSetting(workspaceId: string, key: SettingKey, value: string): Promise<void> {
  const sql = await ready()
  await sql`INSERT INTO phab_workspace_settings (workspace_id, key, value, updated_at)
    VALUES (${workspaceId}, ${key}, ${value}, now())
    ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
}

export async function deleteSetting(workspaceId: string, key: SettingKey): Promise<void> {
  const sql = await ready()
  await sql`DELETE FROM phab_workspace_settings WHERE workspace_id = ${workspaceId} AND key = ${key}`
}

/** Full secret for server-side outbound calls. Workspace value wins; falls back
 *  to the worker env var so existing deployments keep working. */
export async function getSecret(workspaceId: string, key: SettingKey): Promise<string | undefined> {
  const envFallback: Record<SettingKey, string | undefined> = {
    agentmail: process.env.AGENTMAIL_API_KEY,
    northwest: process.env.NORTHWEST_ACCESS_TOKEN,
    mercury: process.env.MERCURY_API_TOKEN,
    stripe: process.env.STRIPE_SECRET_KEY,
    mastra: process.env.MASTRA_MEMORY_GATEWAY_KEY,
    kernel: process.env.KERNEL_API_KEY,
  }
  try {
    const sql = await ready()
    const rows = await sql`SELECT value FROM phab_workspace_settings WHERE workspace_id = ${workspaceId} AND key = ${key}` as { value: string }[]
    return rows[0]?.value?.trim() || envFallback[key]?.trim() || undefined
  } catch {
    return envFallback[key]?.trim() || undefined
  }
}
