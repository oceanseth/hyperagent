#!/usr/bin/env node
// Acceptance proof for one board as an MCP server. Run from the worktree root:
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/mcp-board-proof.mjs
//
// Creates two throwaway boards and one token each through createAgentToken.
// An MCP client must list the board tools, persist add_note, and see that note
// from get_board. A revoked token and a token for the other board return 401.
// The boards, notes, and agent rows are deleted either way. The token is never printed.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createAgentToken, revokeAgentToken } from '#/server/agent-tokens.ts'
import { createOwnedBoard, listNotes } from '#/server/canvas-db.ts'
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
const TOOLS = ['add_note', 'delete_note', 'get_board', 'move_item', 'point_at', 'post_message', 'read_messages', 'update_note']

function check(name, ok, detail = '') {
  const safe = String(detail).replace(/hak_[A-Za-z0-9_-]+/g, 'hak_[redacted]').slice(0, 300)
  console.log(ok ? `PASS ${name}` : `FAIL ${name}${safe ? `: ${safe}` : ''}`)
  if (!ok) failures.push(name)
}

async function post(boardId, token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${base}/api/mcp?board=${boardId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  await response.body?.cancel().catch(() => undefined)
  return response.status
}

async function main() {
  if (!base) {
    check('hyperagent-url', false, 'HYPERAGENT_URL is required')
    return
  }
  const owner = `mcp-proof-${crypto.randomUUID()}`
  const first = await createOwnedBoard(owner, 'mcp proof')
  boards.push(first.workspaceId)
  const second = await createOwnedBoard(owner, 'mcp proof other')
  boards.push(second.workspaceId)
  const primary = await createAgentToken(first.workspaceId, 'proof-agent', owner)
  const other = await createAgentToken(second.workspaceId, 'other-agent', owner)

  const transport = new StreamableHTTPClientTransport(new URL(`${base}/api/mcp?board=${first.workspaceId}`), {
    requestInit: { headers: { Authorization: `Bearer ${primary.token}` } },
  })
  const mcp = new Client({ name: 'mcp-board-proof', version: '1.0.0' })
  try {
    await mcp.connect(transport)
    const listed = await mcp.listTools()
    const names = (listed.tools ?? []).map((tool) => tool.name).sort()
    check('tools-list', TOOLS.every((name) => names.includes(name)), names.join(','))

    const added = await mcp.callTool({ name: 'add_note', arguments: { text: 'city proof note' } })
    const addedText = added.content?.find((part) => part.type === 'text')?.text ?? ''
    let note = null
    try { note = JSON.parse(addedText) } catch { note = null }
    const rows = await listNotes(first.workspaceId)
    const stored = rows.find((row) => row.id === note?.id)
    check('add-note-row', added.isError !== true && stored?.body === 'city proof note' && stored.label.length > 0, added.isError ? 'tool error' : 'row missing')

    const viewed = await mcp.callTool({ name: 'get_board', arguments: {} })
    const viewedText = viewed.content?.find((part) => part.type === 'text')?.text ?? ''
    let board = null
    try { board = JSON.parse(viewedText) } catch { board = null }
    const seen = (board?.notes ?? []).find((row) => row.id === note?.id)
    check('get-board', viewed.isError !== true && seen?.body === 'city proof note' && board?.title === first.title && Array.isArray(board?.messages) && Array.isArray(board?.members), 'note missing from get_board')

    let used = null
    for (let attempt = 0; attempt < 10; attempt += 1) {
      used = await client().phab_board_agents.findUnique({ where: { id: primary.agent.id }, select: { last_used_at: true } })
      if (used?.last_used_at) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    check('last-used', used?.last_used_at instanceof Date, 'last_used_at was not set')
  } finally {
    await mcp.close().catch(() => undefined)
    await transport.close().catch(() => undefined)
  }

  await revokeAgentToken(first.workspaceId, primary.agent.id)
  check('revoked-401', await post(first.workspaceId, primary.token) === 401, 'revoked token was accepted')
  check('other-board-401', await post(first.workspaceId, other.token) === 401, 'other board token was accepted')
  check('missing-401', await post(first.workspaceId) === 401, 'missing token was accepted')
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
  await disconnect().catch(() => undefined)
}

if (failures.length) process.exit(1)
