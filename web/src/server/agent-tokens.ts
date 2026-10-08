import { createHash, randomBytes } from 'node:crypto'
import type { phab_board_agents } from '@prisma/client'
import { client } from './db'

// Per-board agent tokens for /api/mcp. The secret is `hak_` + 32 random bytes
// and exists only in the creation response; the database keeps its SHA-256.
// `hak_` keeps these visually distinct from the site gate key, which also
// arrives as a bearer (server/middleware/gate.ts).

export type BoardAgent = phab_board_agents

const TOKEN_PREFIX = 'hak_'
const hash = (secret: string) => createHash('sha256').update(secret).digest('hex')

export async function createAgentToken(workspaceId: string, name: string, createdBy: string) {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const agent = await client().phab_board_agents.create({
    data: {
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      name: name.trim().slice(0, 80) || 'agent',
      token_hash: hash(token),
      created_by: createdBy,
    },
  })
  return { token, agent }
}

/** Accepts a raw token or a full `Authorization` header value. Returns the
 * live agent row scoped to its board, or undefined for anything else. */
export async function verifyAgentToken(bearer: string | null | undefined): Promise<BoardAgent | undefined> {
  const token = bearer?.replace(/^Bearer\s+/i, '').trim()
  if (!token?.startsWith(TOKEN_PREFIX)) return undefined
  const agent = await client().phab_board_agents.findUnique({ where: { token_hash: hash(token) } })
  if (!agent || agent.revoked_at) return undefined
  // Liveness for the board UI ("active in the last 2 minutes"); a lost update
  // here must not fail the MCP call itself.
  client().phab_board_agents.update({ where: { id: agent.id }, data: { last_used_at: new Date() } }).catch(() => {})
  return agent
}

/** Revoking keeps the row so past board activity stays attributed. */
export async function revokeAgentToken(workspaceId: string, agentId: string) {
  const { count } = await client().phab_board_agents.updateMany({
    where: { id: agentId, workspace_id: workspaceId, revoked_at: null },
    data: { revoked_at: new Date() },
  })
  return count > 0
}

export async function listBoardAgents(workspaceId: string): Promise<BoardAgent[]> {
  return client().phab_board_agents.findMany({ where: { workspace_id: workspaceId }, orderBy: { created_at: 'asc' } })
}

// 60 calls per minute per token (spec §3.5), in process memory: prod runs one
// Fly machine per region today, so a per-machine window is accurate enough.
const WINDOW_MS = 60_000
const WINDOW_CALLS = 60
const windows = new Map<string, { start: number; calls: number }>()

export function agentRateLimited(agentId: string) {
  const now = Date.now()
  const window = windows.get(agentId)
  if (!window || now - window.start >= WINDOW_MS) {
    if (windows.size > 10_000) windows.clear()
    windows.set(agentId, { start: now, calls: 1 })
    return false
  }
  window.calls += 1
  return window.calls > WINDOW_CALLS
}
