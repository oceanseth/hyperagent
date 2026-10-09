import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import type { CanvasSnapshot } from '#/lib/canvas'
import { browserArtifacts, canvasArtifacts, noteArtifacts, planArtifacts, type WorkspaceState } from '#/lib/canvas-workspace'
import { recordAgentActivity } from '#/server/agent-activity'
import { agentRateLimited, verifyAgentToken, type BoardAgent } from '#/server/agent-tokens'
import { getCanvas, listChatHistory, listNotes, removeNote, saveChatMessages, saveLayout, upsertNote, type ChatHistoryMessage } from '#/server/canvas-db'
import { sql } from '#/server/db'

const TEXT = 4000
const textSchema = z.string().trim().min(1).max(TEXT)
const uuidSchema = z.string().uuid()
const itemIdSchema = z.string().min(1).max(120)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// One process keeps the last place each agent pointed, so a later add_note
// can land beside it. MCP itself stays stateless: a new transport is created
// for every request, and nothing here is a cursor session.
const markers = new Map<string, { x: number; y: number }>()

type Point = { x: number; y: number }
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const ok = (payload: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] })
const fail = (message: string): ToolResult => ({ isError: true, content: [{ type: 'text', text: message }] })

// Successful tools only. A validation failure returns fail() and sends nothing.
async function worked(agent: BoardAgent, action: string, payload: unknown, point?: Point) {
  await recordAgentActivity(agent, action, point)
  return ok(payload)
}
const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value)
const noteLabel = (text: string) => (text.split('\n').map((line) => line.trim()).find(Boolean) ?? 'Note').slice(0, 200)

function workspaceState(snapshot: CanvasSnapshot): WorkspaceState {
  return {
    stacks: snapshot.stacks, jobs: snapshot.jobs, plans: snapshot.plans,
    notes: snapshot.notes ?? [], browsers: snapshot.browsers ?? [],
    members: snapshot.members, positions: snapshot.positions ?? {},
    shared: snapshot.shared ?? false, boardTitle: snapshot.boardTitle ?? '',
    excludedIds: [], openPlanIds: [], focus: null, error: null, loaded: true, syncedAt: null,
  }
}

function canvasItems(snapshot: CanvasSnapshot) {
  const state = workspaceState(snapshot)
  return [
    ...canvasArtifacts(state).map(({ id, kind, label, text, x, y }) => ({ id, kind, label, text, x, y })),
    ...planArtifacts(state).map(({ id, kind, label, text, x, y }) => ({ id, kind, label, text, x, y })),
    ...browserArtifacts(state).map(({ id, kind, label, text, x, y }) => ({ id, kind, label, text, x, y })),
    ...noteArtifacts(state).map(({ id, kind, label, text, x, y }) => ({ id, kind, label, text, x, y })),
  ]
}

function pointOf(snapshot: CanvasSnapshot, id: string): Point | undefined {
  const item = canvasItems(snapshot).find((entry) => entry.id === id)
  if (item) return { x: item.x, y: item.y }
  const saved = snapshot.positions?.[id]
  if (saved && snapshot.jobs.some((job) => job.id === id)) return { x: saved.x, y: saved.y }
  return undefined
}

function placeNote(agentId: string, occupied: Point[], explicit?: Partial<Point>): Point {
  if (explicit?.x !== undefined && explicit.y !== undefined) {
    const point = { x: explicit.x, y: explicit.y }
    markers.set(agentId, point)
    return point
  }
  const marker = markers.get(agentId)
  if (marker) {
    const point = { x: marker.x + 340, y: marker.y }
    markers.set(agentId, point)
    return point
  }
  const taken = new Set(occupied.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`))
  for (let index = 0; index < 400; index += 1) {
    const point = { x: 80 + (index % 8) * 340, y: 80 + Math.floor(index / 8) * 380 }
    if (!taken.has(`${point.x}:${point.y}`)) {
      markers.set(agentId, point)
      return point
    }
  }
  const point = { x: 80, y: 80 + occupied.length * 380 }
  markers.set(agentId, point)
  return point
}

async function agentNames(workspaceId: string) {
  const rows = await sql`SELECT id::text AS id, name FROM phab_board_agents WHERE workspace_id = ${workspaceId}::uuid`
  return new Map(rows.map((row) => [String(row.id), String(row.name)]))
}

// saveChatMessages only keeps the user and assistant roles, and this branch has
// no author columns. The id carries the agent so a later read can attribute the
// line without inventing a column or calling Phab.
function agentMessageId(agentId: string) {
  return `agent.${agentId}.${crypto.randomUUID()}`
}

function chatLine(message: ChatHistoryMessage, names: Map<string, string>) {
  const match = /^agent\.([0-9a-f-]{36})\./i.exec(message.id)
  const author = match
    ? { id: match[1], name: names.get(match[1]) ?? 'agent', kind: 'agent' as const }
    : undefined
  return {
    id: message.id, role: message.role, modality: message.modality, text: message.text, at: message.at,
    ...(author ? { author } : {}),
  }
}

async function recentLines(workspaceId: string, limit: number, since?: string) {
  const [history, names] = await Promise.all([listChatHistory(workspaceId, 300), agentNames(workspaceId)])
  const sinceMs = since === undefined ? undefined : Date.parse(since)
  const filtered = sinceMs === undefined || Number.isNaN(sinceMs)
    ? history
    : history.filter((message) => Date.parse(message.at) >= sinceMs)
  return filtered.slice(-limit).map((message) => chatLine(message, names))
}

async function boardView(workspaceId: string) {
  const snapshot = await getCanvas(workspaceId)
  const items = canvasItems(snapshot)
  const at = (id: string) => {
    const item = items.find((entry) => entry.id === id)
    return item ? { x: item.x, y: item.y } : {}
  }
  return {
    title: snapshot.boardTitle ?? '',
    notes: (snapshot.notes ?? []).map((note) => ({
      id: note.id, label: note.label, body: clip(note.body, TEXT), x: note.x, y: note.y,
    })),
    stacks: snapshot.stacks.map((stack) => ({
      id: stack.id, title: stack.title, summary: clip(stack.markdown, 500), ...at(stack.id),
    })),
    plans: snapshot.plans.map((plan) => ({
      id: plan.id, name: plan.name, summary: clip(plan.description, 500), ...at(plan.id),
    })),
    jobs: snapshot.jobs.map((job) => {
      const point = snapshot.positions?.[job.id]
      return {
        id: job.id, title: job.title, status: job.status, progress: clip(job.progress, 500),
        ...(point ? { x: point.x, y: point.y } : {}),
      }
    }),
    members: snapshot.members ?? [],
    messages: await recentLines(workspaceId, 20),
  }
}

function registerBoardTools(server: McpServer, agent: BoardAgent) {
  const workspaceId = agent.workspace_id

  server.registerTool('get_board', {
    description: 'Read this board: title, notes, stacks, plans, jobs, members, and the last 20 chat lines.',
  }, async () => worked(agent, 'reading the board', await boardView(workspaceId)))

  server.registerTool('add_note', {
    description: 'Add a note. With no coordinates it sits beside the agent marker, or in free space when the agent has not pointed yet.',
    inputSchema: {
      text: textSchema,
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    },
  }, async ({ text, x, y }) => {
    if ((x === undefined) !== (y === undefined)) return fail('Pass both x and y, or neither.')
    const snapshot = await getCanvas(workspaceId)
    const point = placeNote(agent.id, (snapshot.notes ?? []).map((note) => ({ x: note.x, y: note.y })), { x, y })
    const note = { id: crypto.randomUUID(), label: noteLabel(text), body: text, x: point.x, y: point.y }
    await upsertNote(workspaceId, note)
    return worked(agent, 'added a note', note, point)
  })

  server.registerTool('update_note', {
    description: 'Replace a note\'s text. Position stays where it is.',
    inputSchema: { id: uuidSchema, text: textSchema },
  }, async ({ id, text }) => {
    const note = (await listNotes(workspaceId)).find((entry) => entry.id === id)
    if (!note) return fail('That note is not on this board.')
    const next = { id, label: noteLabel(text), body: text, x: note.x, y: note.y }
    await upsertNote(workspaceId, next)
    return worked(agent, 'updated a note', next)
  })

  server.registerTool('move_item', {
    description: 'Move a note or another canvas item to an absolute x/y.',
    inputSchema: { id: itemIdSchema, x: z.number().finite(), y: z.number().finite() },
  }, async ({ id, x, y }) => {
    const snapshot = await getCanvas(workspaceId)
    const note = (snapshot.notes ?? []).find((entry) => entry.id === id)
    const onBoard = note || pointOf(snapshot, id) || snapshot.jobs.some((job) => job.id === id)
    if (!onBoard) return fail('That item is not on this board.')
    if (note) await upsertNote(workspaceId, { id, label: note.label, body: note.body, x, y })
    else await saveLayout(workspaceId, { [id]: { x, y } })
    markers.set(agent.id, { x, y })
    return worked(agent, 'moved an item', { id, x, y }, { x, y })
  })

  server.registerTool('delete_note', {
    description: 'Delete a note from this board.',
    inputSchema: { id: uuidSchema },
  }, async ({ id }) => {
    const note = (await listNotes(workspaceId)).find((entry) => entry.id === id)
    if (!note) return fail('That note is not on this board.')
    await removeNote(workspaceId, id)
    await saveLayout(workspaceId, {}, [id])
    return worked(agent, 'deleted a note', { id, deleted: true })
  })

  server.registerTool('post_message', {
    description: 'Store a chat line from this agent. Does not ask Phab to reply.',
    inputSchema: { text: textSchema },
  }, async ({ text }) => {
    const id = agentMessageId(agent.id)
    await saveChatMessages(workspaceId, [{ id, role: 'user', text }])
    const line = (await recentLines(workspaceId, 300)).find((entry) => entry.id === id)
    return worked(agent, 'posted a message', line ?? { id, role: 'user', modality: 'chat', text, at: new Date().toISOString(), author: { id: agent.id, name: agent.name, kind: 'agent' } })
  })

  server.registerTool('read_messages', {
    description: 'Read stored chat lines. Pass since as an ISO timestamp to skip older lines.',
    inputSchema: { since: z.string().min(1).max(40).optional() },
  }, async ({ since }) => {
    if (since !== undefined && Number.isNaN(Date.parse(since))) return fail('since must be an ISO timestamp.')
    return worked(agent, 'read messages', { messages: await recentLines(workspaceId, 300, since) })
  })

  server.registerTool('point_at', {
    description: 'Move this agent\'s marker to an x/y or to a canvas item. Does not move the item.',
    inputSchema: {
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
      item_id: itemIdSchema.optional(),
    },
  }, async ({ x, y, item_id }) => {
    const hasPoint = x !== undefined || y !== undefined
    const hasItem = item_id !== undefined
    if (hasItem === hasPoint || (hasPoint && (x === undefined || y === undefined))) {
      return fail('Pass x and y, or item_id, and not both.')
    }
    if (item_id) {
      const point = pointOf(await getCanvas(workspaceId), item_id)
      if (!point) return fail('That item is not on this board.')
      markers.set(agent.id, point)
      return worked(agent, 'pointing', { item_id, x: point.x, y: point.y }, point)
    }
    if (x === undefined || y === undefined) return fail('Pass x and y, or item_id, and not both.')
    markers.set(agent.id, { x, y })
    return worked(agent, 'pointing', { x, y }, { x, y })
  })
}

const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })

function methodNotAllowed() {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }), {
    status: 405,
    headers: { Allow: 'POST', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const agent = await verifyAgentToken(request.headers.get('authorization'))
  if (!agent) return unauthorized()

  const board = new URL(request.url).searchParams.get('board')?.trim()
  if (board !== undefined && board !== '' && (!UUID.test(board) || board.toLowerCase() !== agent.workspace_id.toLowerCase())) {
    return unauthorized()
  }

  // GET is the optional SSE listener. JSON mode has nothing to stream, and the
  // MCP client treats 405 as "no server stream".
  if (request.method === 'GET') return methodNotAllowed()
  if (request.method !== 'POST' && request.method !== 'DELETE') return methodNotAllowed()
  if (request.method === 'POST' && agentRateLimited(agent.id)) {
    return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } })
  }

  const server = new McpServer({ name: 'hyperagent-board', version: '0.1.0' })
  registerBoardTools(server, agent)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    const response = await transport.handleRequest(request)
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', 'no-store')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  } finally {
    await server.close().catch(() => undefined)
  }
}
