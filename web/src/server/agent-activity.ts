import type { BoardAgent } from '#/server/agent-tokens'
import { listCanvasMembers } from '#/server/canvas-db'
import { client, sql } from '#/server/db'

/** Working agents stay on the board for two minutes after their last tool call. */
export const AGENT_ACTIVITY_MS = 120_000

const KEY_PREFIX = 'agent-activity:'

export type AgentActivity = {
  id: string
  name: string
  color: string
  kind: 'agent'
  x: number | null
  y: number | null
  action: string
  at: string
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseActivity(value: unknown): AgentActivity | undefined {
  if (typeof value !== 'string' || !value) return undefined
  let data: unknown
  try { data = JSON.parse(value) } catch { return undefined }
  if (!data || typeof data !== 'object') return undefined
  const row = data as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.action !== 'string' || typeof row.at !== 'string') return undefined
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    color: typeof row.color === 'string' ? row.color : '',
    kind: 'agent',
    x: finite(row.x),
    y: finite(row.y),
    action: row.action,
    at: row.at,
  }
}

async function storedActivity(workspaceId: string, agentId: string): Promise<AgentActivity | undefined> {
  const key = `${KEY_PREFIX}${agentId}`
  const rows = await sql`SELECT value FROM phab_workspace_settings
    WHERE workspace_id = ${workspaceId}::uuid AND key = ${key}`
  return parseActivity(rows[0]?.value)
}

/**
 * One successful MCP tool call. Stores the payload the canvas route reads and
 * broadcasts `agent-activity` on the private board topic. A failed ping must
 * not fail the tool; the stored row still covers someone who joins late.
 */
export async function recordAgentActivity(
  agent: BoardAgent,
  action: string,
  point?: { x: number; y: number } | null,
): Promise<AgentActivity | undefined> {
  if (agent.revoked_at) return undefined
  const live = await sql`SELECT revoked_at, name, color FROM phab_board_agents WHERE id = ${agent.id}::uuid`
  if (!live[0] || live[0].revoked_at) return undefined
  const members = await listCanvasMembers(agent.workspace_id).catch(() => [])
  const member = members.find((entry) => entry.id === agent.id && entry.kind === 'agent')
  const previous = point ? undefined : await storedActivity(agent.workspace_id, agent.id)
  const row: AgentActivity = {
    id: agent.id,
    name: member?.name || String(live[0].name ?? agent.name),
    color: member?.color || (live[0].color == null ? '' : String(live[0].color)),
    kind: 'agent',
    x: finite(point?.x) ?? previous?.x ?? null,
    y: finite(point?.y) ?? previous?.y ?? null,
    action: action.slice(0, 80),
    at: new Date().toISOString(),
  }
  const key = `${KEY_PREFIX}${agent.id}`
  await sql`INSERT INTO phab_workspace_settings (workspace_id, key, value, updated_at)
    VALUES (${agent.workspace_id}::uuid, ${key}, ${JSON.stringify(row)}, now())
    ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
  const payload = { id: row.id, name: row.name, color: row.color, x: row.x, y: row.y, action: row.action }
  try {
    // Same call as migration 20261008000000_realtime: private topic, private=true.
    // realtime.send returns void, so this is executeRaw rather than a row query.
    await client().$executeRaw`SELECT realtime.send(
      ${JSON.stringify(payload)}::jsonb,
      'agent-activity',
      private.board_topic(${agent.workspace_id}::uuid),
      true
    )`
  } catch {
    // Stored row remains the late-join source.
  }
  return row
}

/** Agents whose last successful tool call is still inside the two-minute window. */
export async function recentAgentActivity(workspaceId: string, now = Date.now()): Promise<AgentActivity[]> {
  const rows = await sql`SELECT s.value
    FROM phab_workspace_settings s
    JOIN phab_board_agents a
      ON a.workspace_id = s.workspace_id
     AND a.revoked_at IS NULL
     AND s.key = ${KEY_PREFIX} || a.id::text
    WHERE s.workspace_id = ${workspaceId}::uuid`
  const agents: AgentActivity[] = []
  for (const row of rows) {
    const activity = parseActivity(row.value)
    if (!activity) continue
    const at = Date.parse(activity.at)
    if (!Number.isFinite(at) || now - at >= AGENT_ACTIVITY_MS || now - at < -5_000) continue
    agents.push(activity)
  }
  return agents
}
