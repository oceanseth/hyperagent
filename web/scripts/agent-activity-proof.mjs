#!/usr/bin/env node
// Acceptance proof for agent activity on a board. Run from the worktree root:
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/agent-activity-proof.mjs
//
// Creates a throwaway board and a token through createAgentToken, calls
// add_note and point_at, and checks the stored activity row plus GET /api/canvas.
// A failed tool call and a revoked token leave no new activity. The board,
// notes, and agent row are deleted either way. The token is never printed.
// SUPABASE_SECRET_KEY is not in web/.env.local, so there is no live two-socket watch.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createAgentToken, revokeAgentToken } from '#/server/agent-tokens.ts'
import { createOwnedBoard } from '#/server/canvas-db.ts'
import { client } from '#/server/db.ts'
import { deleteWorkspace, disconnect } from './supabase-cleanup.ts'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnv(join(web, '.env.local'))

const base = (process.env.HYPERAGENT_URL || '').replace(/\/$/, '')
const failures = []
const boards = []

function check(name, ok, detail = '') {
  const safe = String(detail).replace(/hak_[A-Za-z0-9_-]+/g, 'hak_[redacted]').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300)
  console.log(ok ? `PASS ${name}` : `FAIL ${name}${safe ? `: ${safe}` : ''}`)
  if (!ok) failures.push(name)
}

function toolText(result) {
  return result?.content?.find((part) => part.type === 'text')?.text ?? ''
}

async function canvas(workspaceId) {
  const response = await fetch(`${base}/api/canvas`, {
    headers: { cookie: `phab-workspace=${workspaceId}` },
    cache: 'no-store',
  })
  let data = null
  try { data = await response.json() } catch { data = null }
  return { status: response.status, data }
}

async function stored(workspaceId, agentId) {
  const key = `agent-activity:${agentId}`
  const rows = await client().$queryRaw`
    SELECT value, updated_at FROM phab_workspace_settings
    WHERE workspace_id = ${workspaceId}::uuid AND key = ${key}`
  const row = rows[0]
  if (!row) return undefined
  let value = null
  try { value = JSON.parse(String(row.value)) } catch { value = null }
  return { value, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? '') }
}

async function broadcasts(workspaceId) {
  const rows = await client().$queryRaw`
    SELECT event, private, payload->>'action' AS action, payload->>'x' AS x, payload->>'y' AS y
    FROM realtime.messages
    WHERE event = 'agent-activity' AND topic = private.board_topic(${workspaceId}::uuid)
    ORDER BY inserted_at DESC
    LIMIT 8`
  return rows.map((row) => ({
    event: String(row.event),
    private: row.private === true,
    action: String(row.action ?? ''),
    x: row.x == null ? null : Number(row.x),
    y: row.y == null ? null : Number(row.y),
  }))
}

function agentOnCanvas(data, agentId) {
  return (data?.agents ?? []).find((entry) => entry.id === agentId)
}

async function main() {
  if (!base) {
    check('hyperagent-url', false, 'HYPERAGENT_URL is required')
    return
  }
  check('secret-key-absent', !process.env.SUPABASE_SECRET_KEY)
  console.log('LIVE_REALTIME=skipped-no-secret-key')

  const owner = `activity-proof-${crypto.randomUUID()}`
  const board = await createOwnedBoard(owner, 'activity proof')
  boards.push(board.workspaceId)
  const primary = await createAgentToken(board.workspaceId, 'proof-agent', owner)
  const agentId = primary.agent.id

  const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp?board=${board.workspaceId}`), {
    requestInit: { headers: { Authorization: `Bearer ${primary.token}` } },
  })
  const mcp = new Client({ name: 'agent-activity-proof', version: '1.0.0' })
  try {
    await mcp.connect(transport)
    const added = await mcp.callTool({ name: 'add_note', arguments: { text: 'city activity note', x: 120, y: 240 } })
    let note = null
    try { note = JSON.parse(toolText(added)) } catch { note = null }
    check('add-note', added.isError !== true && note?.x === 120 && note?.y === 240, added.isError ? 'tool error' : 'note missing')

    const row = await stored(board.workspaceId, agentId)
    const listed = await canvas(board.workspaceId)
    const seen = agentOnCanvas(listed.data, agentId)
    const fresh = seen && Date.now() - Date.parse(seen.at) < 120_000
    check('stored-row', row?.value?.action === 'added a note' && row.value.x === 120 && row.value.y === 240 && row.value.kind === 'agent', JSON.stringify(row?.value ?? null))
    check('canvas-agent', listed.status === 200 && fresh && seen.kind === 'agent' && seen.action === 'added a note' && seen.x === 120 && seen.y === 240 && seen.name === 'proof-agent' && typeof seen.color === 'string' && seen.color.startsWith('#'), JSON.stringify(seen ?? null))

    let sent = []
    try { sent = await broadcasts(board.workspaceId) } catch (error) {
      check('broadcast', false, error instanceof Error ? error.message : 'broadcast read failed')
      sent = null
    }
    if (sent) {
      const match = sent.find((entry) => entry.action === 'added a note' && entry.x === 120 && entry.y === 240 && entry.private)
      check('broadcast', Boolean(match), JSON.stringify(sent[0] ?? null))
    }

    const pointed = await mcp.callTool({ name: 'point_at', arguments: { item_id: note.id } })
    let point = null
    try { point = JSON.parse(toolText(pointed)) } catch { point = null }
    const pointedRow = await stored(board.workspaceId, agentId)
    check('point-at-item', pointed.isError !== true && point?.x === 120 && point?.y === 240 && pointedRow?.value?.action === 'pointing' && pointedRow.value.x === 120 && pointedRow.value.y === 240, pointed.isError ? 'tool error' : JSON.stringify(pointedRow?.value ?? null))

    const read = await mcp.callTool({ name: 'read_messages', arguments: {} })
    const repeated = await stored(board.workspaceId, agentId)
    check('repeat-last', read.isError !== true && repeated?.value?.action === 'read messages' && repeated.value.x === 120 && repeated.value.y === 240, JSON.stringify(repeated?.value ?? null))

    const beforeFail = repeated?.updatedAt
    const missed = await mcp.callTool({ name: 'point_at', arguments: { item_id: crypto.randomUUID() } })
    const afterFail = await stored(board.workspaceId, agentId)
    check('failed-call-silent', missed.isError === true && afterFail?.value?.action === 'read messages' && afterFail.updatedAt === beforeFail, missed.isError ? '' : 'failed call was stored')

    const moved = await mcp.callTool({ name: 'move_item', arguments: { id: note.id, x: 30, y: 50 } })
    const movedRow = await stored(board.workspaceId, agentId)
    const movedCanvas = agentOnCanvas((await canvas(board.workspaceId)).data, agentId)
    check('move-item', moved.isError !== true && movedRow?.value?.action === 'moved an item' && movedRow.value.x === 30 && movedRow.value.y === 50 && movedCanvas?.action === 'moved an item', JSON.stringify(movedRow?.value ?? null))

    const staleAt = new Date(Date.now() - 3 * 60_000).toISOString()
    const staleValue = JSON.stringify({ ...movedRow.value, at: staleAt })
    await client().$executeRaw`
      UPDATE phab_workspace_settings SET value = ${staleValue}
      WHERE workspace_id = ${board.workspaceId}::uuid AND key = ${`agent-activity:${agentId}`}`
    const hidden = agentOnCanvas((await canvas(board.workspaceId)).data, agentId)
    check('stale-hidden', hidden === undefined, JSON.stringify(hidden ?? null))

    const reading = await mcp.callTool({ name: 'get_board', arguments: {} })
    const restored = await stored(board.workspaceId, agentId)
    check('restored', reading.isError !== true && restored?.value?.action === 'reading the board' && restored.value.x === 30 && restored.value.y === 50, JSON.stringify(restored?.value ?? null))

    await revokeAgentToken(board.workspaceId, agentId)
    const revokedCall = await mcp.callTool({ name: 'add_note', arguments: { text: 'should not land', x: 1, y: 1 } }).catch((error) => ({ isError: true, message: error instanceof Error ? error.message : 'revoked' }))
    const afterRevoke = await stored(board.workspaceId, agentId)
    const gone = agentOnCanvas((await canvas(board.workspaceId)).data, agentId)
    check('revoked-absent', (revokedCall.isError === true || revokedCall.message) && gone === undefined && afterRevoke?.updatedAt === restored?.updatedAt, JSON.stringify(gone ?? null))
  } finally {
    await mcp.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
  }
}

try {
  await main()
} catch (error) {
  check('proof-ran', false, error instanceof Error ? error.message : 'proof failed')
} finally {
  for (const workspaceId of boards) {
    try {
      await client().phab_board_agents.deleteMany({ where: { workspace_id: workspaceId } })
      await deleteWorkspace(workspaceId)
      check(`cleared-${workspaceId.slice(0, 8)}`, true)
    } catch (error) {
      check(`cleared-${workspaceId.slice(0, 8)}`, false, error instanceof Error ? error.message : 'cleanup failed')
    }
  }
  await client().$executeRaw`DELETE FROM realtime.messages WHERE topic = 'board:probe-not-a-board'`.catch(() => undefined)
  await disconnect().catch(() => undefined)
}

if (failures.length) process.exit(1)
