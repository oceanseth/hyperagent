import type { CanvasBrowser, CanvasJob, CanvasMember, CanvasNote, CanvasStack, CanvasSnapshot, JobEvent } from '#/lib/canvas'
import { assignColor } from '#/lib/board-palette'
import { memberName } from '#/lib/member-name'
import { uniqueBoardName } from './board-names'
import { client, sql, type Sql } from './db'
import { listPlans } from './plans'
const isoTimestamp = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString()

const publicEvent = (row: Record<string, unknown>): JobEvent => ({
  id: Number(row.id), at: isoTimestamp(row.created_at), type: String(row.type), message: String(row.message),
  ...(row.tool ? { tool: String(row.tool) } : {}),
  ...(row.duration_ms != null ? { durationMs: Number(row.duration_ms) } : {}),
  ...(row.details && typeof row.details === 'object' && !Array.isArray(row.details)
    ? { details: row.details as Record<string, unknown> } : {}),
})

const publicJob = (row: Record<string, unknown>): CanvasJob => ({
  id: String(row.id), title: String(row.title), status: row.status as CanvasJob['status'],
  ...(row.kind === 'browser' ? { kind: 'browser' as const } : {}),
  ...(row.browser_id ? { browserId: String(row.browser_id) } : {}),
  progress: String(row.progress), createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
  ...(row.stack_id ? { stackId: String(row.stack_id) } : {}),
  ...(row.worker_id ? { workerId: String(row.worker_id) } : {}),
  ...(row.worker_region ? { workerRegion: String(row.worker_region) } : {}),
  ...(row.started_at ? { startedAt: isoTimestamp(row.started_at) } : {}),
  ...(row.heartbeat_at ? { heartbeatAt: isoTimestamp(row.heartbeat_at) } : {}),
  events: Array.isArray(row.events) ? row.events.map(publicEvent) : [],
})

export async function getCanvas(workspaceId: string): Promise<CanvasSnapshot> {
  const [stacks, jobs, plans, notes, layout, shared, browsers, members] = await Promise.all([
    sql`SELECT data FROM (SELECT data, created_at FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at DESC LIMIT 100) latest ORDER BY created_at ASC`,
    sql`SELECT jobs.*, history.events FROM (
      SELECT workspace_id, id, title, status, progress, stack_id, created_at, updated_at,
        worker_id, worker_region, started_at, heartbeat_at, kind, browser_id
      FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at DESC LIMIT 30
    ) jobs LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(event ORDER BY event.id), '[]'::jsonb) AS events FROM (
        SELECT id, created_at, type, message, tool, duration_ms, details FROM phab_job_events
        WHERE workspace_id = jobs.workspace_id AND job_id = jobs.id ORDER BY id DESC LIMIT 80
      ) event
    ) history ON true ORDER BY jobs.created_at DESC`,
    listPlans(workspaceId).catch(() => []),
    listNotes(workspaceId).catch(() => []),
    sql`SELECT positions FROM phab_canvas_layout WHERE workspace_id = ${workspaceId}::uuid`,
    sql`SELECT title FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`,
    listBrowsers(workspaceId).catch(() => []),
    listCanvasMembers(workspaceId),
  ])
  return {
    stacks: stacks.map((row) => row.data as CanvasStack), jobs: jobs.map(publicJob), plans, notes, browsers, members,
    positions: (layout[0]?.positions ?? {}) as Record<string, { x: number; y: number }>,
    shared: shared.length > 0,
    boardTitle: shared[0]?.title ? String(shared[0].title) : '',
  }
}

const publicNote = (row: Record<string, unknown>): CanvasNote => ({
  id: String(row.id), label: String(row.label), body: String(row.body),
  x: Number(row.x), y: Number(row.y),
  ...(row.promoted_plan_id ? { promotedPlanId: String(row.promoted_plan_id) } : {}),
  ...(row.promoted_node_id ? { promotedNodeId: String(row.promoted_node_id) } : {}),
})

export async function listNotes(workspaceId: string): Promise<CanvasNote[]> {
  const rows = await sql`SELECT * FROM phab_canvas_notes WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at ASC LIMIT 200`
  return rows.map(publicNote)
}

/** Upsert keeps promoted_* columns untouched so plan promotion survives edits. */
export async function upsertNote(workspaceId: string, note: { id: string; label: string; body: string; x: number; y: number }) {
  await sql`INSERT INTO phab_canvas_notes (workspace_id, id, label, body, x, y)
    VALUES (${workspaceId}::uuid, ${note.id}::uuid, ${note.label.slice(0, 200)}, ${note.body.slice(0, 20_000)}, ${note.x}, ${note.y})
    ON CONFLICT (workspace_id, id) DO UPDATE SET
      label = EXCLUDED.label, body = EXCLUDED.body, x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now()`
}

export async function removeNote(workspaceId: string, id: string) {
  await sql`DELETE FROM phab_canvas_notes WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid`
}

export async function listBrowsers(workspaceId: string): Promise<CanvasBrowser[]> {
  const rows = await sql`SELECT data FROM phab_canvas_browsers WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at ASC LIMIT 20`
  return rows.map((row) => row.data as CanvasBrowser)
}

export async function getBrowser(workspaceId: string, id: string): Promise<CanvasBrowser | undefined> {
  const rows = await sql`SELECT data FROM phab_canvas_browsers WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid`
  return rows[0]?.data as CanvasBrowser | undefined
}

export async function saveBrowser(workspaceId: string, browser: CanvasBrowser) {
  await sql`INSERT INTO phab_canvas_browsers (workspace_id, id, data)
    VALUES (${workspaceId}::uuid, ${browser.id}::uuid, ${JSON.stringify(browser)}::jsonb)
    ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
}

/** Updates a browser only while it is still on the canvas, so a close wins over a late launch. */
export async function patchBrowser(workspaceId: string, id: string, patch: Partial<CanvasBrowser>) {
  // Keys set to undefined are cleared, e.g. a stale loading message.
  const cleared = Object.entries(patch).filter(([, value]) => value === undefined).map(([key]) => key)
  const rows = await sql`UPDATE phab_canvas_browsers SET data = (data - ${cleared}::text[]) || ${JSON.stringify(patch)}::jsonb, updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid RETURNING data`
  return rows[0]?.data as CanvasBrowser | undefined
}

export async function removeBrowser(workspaceId: string, id: string) {
  const rows = await sql`DELETE FROM phab_canvas_browsers WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid RETURNING data`
  return rows[0]?.data as CanvasBrowser | undefined
}

/**
 * Merges position keys in one statement. A concurrent save of a different id
 * cannot drop it, because this never replaces the whole map.
 * A key in both `patch` and `remove` keeps the patched point.
 */
export async function saveLayout(
  workspaceId: string,
  patch: Record<string, { x: number; y: number }>,
  remove: readonly string[] = [],
) {
  const dropped = [...remove]
  const written = JSON.stringify(patch)
  // COALESCE keeps an empty remove list from becoming NULL and wiping the row.
  await sql`INSERT INTO phab_canvas_layout (workspace_id, positions)
    VALUES (${workspaceId}::uuid, ('{}'::jsonb - COALESCE(${dropped}::text[], ARRAY[]::text[])) || ${written}::jsonb)
    ON CONFLICT (workspace_id) DO UPDATE SET
      positions = (phab_canvas_layout.positions - COALESCE(${dropped}::text[], ARRAY[]::text[])) || ${written}::jsonb,
      updated_at = now()`
}

export function cleanTitle(value: unknown) {
  const title = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return title || 'Untitled board'
}

const shareCode = /^[a-z0-9]{4,32}$/i

async function saveMember(sql: Sql, sub: string, code: string, role: 'owner' | 'member') {
  await sql`INSERT INTO phab_board_members (sub, code, role) VALUES (${sub}, ${code}, ${role})
    ON CONFLICT (sub, code) DO UPDATE SET role = CASE
      WHEN EXCLUDED.role = 'owner' OR phab_board_members.role = 'owner' THEN 'owner'
      ELSE phab_board_members.role
    END`
  const rows = await sql`SELECT workspace_id FROM phab_share_codes WHERE code = ${code} LIMIT 1`
  if (rows[0]?.workspace_id) await ensureBoardColors(String(rows[0].workspace_id), code)
}

type ColorRow = { id: string; color: string | null; createdAt: number; kind: 'human' | 'agent' }

function colorRow(row: Record<string, unknown>, kind: 'human' | 'agent'): ColorRow {
  const created = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))
  const raw = row.color == null ? '' : String(row.color)
  // Null and '' are both unassigned and must not count as a used color.
  return { id: String(row.id), color: raw === '' ? null : raw, createdAt: created.getTime(), kind }
}

// Humans and agents share one palette per board. Unassigned colors are written
// once, oldest created_at first, then id. A stored palette color is left alone.
async function ensureBoardColors(workspaceId: string, code: string) {
  await client().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT code FROM phab_share_codes WHERE code = ${code} FOR UPDATE`
    const humans = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT sub AS id, color, created_at FROM phab_board_members WHERE code = ${code}`
    const agents = await tx.$queryRaw<Record<string, unknown>[]>`
      SELECT id::text AS id, color, created_at FROM phab_board_agents
      WHERE workspace_id = ${workspaceId}::uuid AND revoked_at IS NULL`
    const rows = [...humans.map((row) => colorRow(row, 'human')), ...agents.map((row) => colorRow(row, 'agent'))]
    const used = rows.flatMap((row) => row.color ? [row.color] : [])
    const pending = rows.filter((row) => row.color == null).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    for (const row of pending) {
      const color = assignColor(used)
      const updated = row.kind === 'human'
        ? await tx.$queryRaw<Record<string, unknown>[]>`
            UPDATE phab_board_members SET color = ${color}
            WHERE sub = ${row.id} AND code = ${code} AND (color IS NULL OR color = '') RETURNING color`
        : await tx.$queryRaw<Record<string, unknown>[]>`
            UPDATE phab_board_agents SET color = ${color}
            WHERE id = ${row.id}::uuid AND (color IS NULL OR color = '') RETURNING color`
      const written = updated[0]?.color
      if (written != null && String(written) !== '') {
        used.push(String(written))
        continue
      }
      const current = row.kind === 'human'
        ? await tx.$queryRaw<Record<string, unknown>[]>`
            SELECT color FROM phab_board_members WHERE sub = ${row.id} AND code = ${code}`
        : await tx.$queryRaw<Record<string, unknown>[]>`
            SELECT color FROM phab_board_agents WHERE id = ${row.id}::uuid`
      const kept = current[0]?.color
      if (kept != null && String(kept) !== '') used.push(String(kept))
    }
  })
}

// auth.users may be missing or hidden from this role. Names still resolve.
async function memberRows(code: string) {
  try {
    return await sql`SELECT m.sub, m.color, u.email AS email, u.raw_user_meta_data->>'name' AS meta_name
      FROM phab_board_members m
      LEFT JOIN auth.users u ON u.id::text = m.sub
      WHERE m.code = ${code}`
  } catch {
    return await sql`SELECT sub, color, NULL::text AS email, NULL::text AS meta_name
      FROM phab_board_members WHERE code = ${code}`
  }
}

export async function listCanvasMembers(workspaceId: string): Promise<CanvasMember[]> {
  const shares = await sql`SELECT code FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`
  const code = shares[0]?.code ? String(shares[0].code) : ''
  if (!code) return []
  await ensureBoardColors(workspaceId, code)
  const [humans, agents] = await Promise.all([
    memberRows(code),
    sql`SELECT id::text AS id, name, color FROM phab_board_agents
      WHERE workspace_id = ${workspaceId}::uuid AND revoked_at IS NULL`,
  ])
  return [
    ...humans.map((row) => ({
      id: String(row.sub),
      name: memberName(String(row.sub), { name: row.meta_name == null ? '' : String(row.meta_name), email: row.email == null ? '' : String(row.email) }),
      color: String(row.color ?? ''),
      kind: 'human' as const,
    })),
    ...agents.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      color: String(row.color ?? ''),
      kind: 'agent' as const,
    })),
  ]
}

const untitled = 'Untitled board'

function newBoardName(sql: Sql) {
  return uniqueBoardName(async (name) => (await sql`SELECT 1 FROM phab_share_codes WHERE title = ${name} LIMIT 1`).length > 0)
}

// Sharing names the board automatically: a board still called 'Untitled
// board' gets a unique docker-style name instead of asking the user.
export async function createShareCode(workspaceId: string, options?: { title?: string; ownerSub?: string }) {
  const requested = options?.title?.trim() ? cleanTitle(options.title) : undefined
  const existing = await sql`SELECT code, title FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`
  if (existing[0]) {
    const code = String(existing[0].code)
    let title = cleanTitle(existing[0].title)
    const next = requested ?? (title === untitled ? await newBoardName(sql) : undefined)
    if (next && next !== title) {
      await sql`UPDATE phab_share_codes SET title = ${next} WHERE workspace_id = ${workspaceId}::uuid`
      title = next
    }
    if (options?.ownerSub) {
      await sql`UPDATE phab_share_codes SET owner_sub = ${options.ownerSub} WHERE workspace_id = ${workspaceId}::uuid AND owner_sub IS NULL`
      await saveMember(sql, options.ownerSub, code, 'owner')
    }
    return { code, title }
  }
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const title = requested ?? await newBoardName(sql)
  await sql`INSERT INTO phab_share_codes (code, workspace_id, title, owner_sub)
    VALUES (${code}, ${workspaceId}::uuid, ${title}, ${options?.ownerSub ?? null})
    ON CONFLICT (code) DO NOTHING`
  const row = await sql`SELECT code, title FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`
  const saved = String(row[0]?.code ?? code)
  if (options?.ownerSub) await saveMember(sql, options.ownerSub, saved, 'owner')
  return { code: saved, title: row[0] ? cleanTitle(row[0].title) : title }
}

export async function resolveShareCode(code: string) {
  const rows = await sql`SELECT workspace_id FROM phab_share_codes WHERE code = ${code}`
  return rows[0] ? String(rows[0].workspace_id) : undefined
}

export async function getShareCard(code: string) {
  if (!shareCode.test(code)) return undefined
  const rows = await sql`SELECT code, title FROM phab_share_codes WHERE code = ${code} LIMIT 1`
  if (!rows[0]) return undefined
  return { code: String(rows[0].code), title: cleanTitle(rows[0].title) }
}

export async function rememberBoard(sub: string, code: string) {
  if (!shareCode.test(code)) return
  const rows = await sql`SELECT code, owner_sub FROM phab_share_codes WHERE code = ${code} LIMIT 1`
  if (!rows[0]) return
  const role = rows[0].owner_sub === sub ? 'owner' : 'member'
  await saveMember(sql, sub, String(rows[0].code), role)
}

// The first signed-in person to touch an unowned board becomes its owner.
// A board that already has an owner is only added to this account's list.
export async function claimWorkspace(sub: string, workspaceId: string) {
  const existing = await sql`SELECT code, owner_sub FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`
  if (!existing[0]) {
    const code = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    const title = await newBoardName(sql)
    await sql`INSERT INTO phab_share_codes (code, workspace_id, title, owner_sub)
      VALUES (${code}, ${workspaceId}::uuid, ${title}, ${sub})
      ON CONFLICT (code) DO NOTHING`
    const row = await sql`SELECT code FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid LIMIT 1`
    if (row[0]) await saveMember(sql, sub, String(row[0].code), 'owner')
    return
  }
  const code = String(existing[0].code)
  if (!existing[0].owner_sub) {
    await sql`UPDATE phab_share_codes SET owner_sub = ${sub} WHERE code = ${code} AND owner_sub IS NULL`
  }
  const owned = await sql`SELECT owner_sub FROM phab_share_codes WHERE code = ${code}`
  await saveMember(sql, sub, code, owned[0]?.owner_sub === sub ? 'owner' : 'member')
}

export async function listBoards(sub: string) {
  // A running job older than the worker lease is not live; claimJob treats it
  // the same way. Queued jobs still count — an agent is about to start.
  const rows = await sql`SELECT s.code, s.title, m.role, COALESCE(live.n, 0) AS live
    FROM phab_board_members m
    JOIN phab_share_codes s ON s.code = m.code
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS n FROM phab_canvas_jobs j
      WHERE j.workspace_id = s.workspace_id
        AND (j.status = 'queued' OR (j.status = 'running' AND j.updated_at > now() - interval '12 minutes'))
    ) live ON true
    WHERE m.sub = ${sub}
    ORDER BY m.created_at DESC
    LIMIT 100`
  return rows.map((row) => ({
    code: String(row.code),
    title: cleanTitle(row.title),
    role: row.role === 'owner' ? 'owner' as const : 'member' as const,
    live: Number(row.live ?? 0),
  }))
}

export async function renameBoard(options: { title: string; workspaceId?: string; code?: string; ownerSub?: string }) {
  const title = cleanTitle(options.title)
  if (options.workspaceId) {
    const rows = await sql`UPDATE phab_share_codes SET title = ${title} WHERE workspace_id = ${options.workspaceId}::uuid RETURNING code, title`
    return rows[0] ? { code: String(rows[0].code), title: String(rows[0].title) } : undefined
  }
  if (options.code && options.ownerSub && shareCode.test(options.code)) {
    const rows = await sql`UPDATE phab_share_codes SET title = ${title}
      WHERE code = ${options.code} AND owner_sub = ${options.ownerSub}
      RETURNING code, title`
    return rows[0] ? { code: String(rows[0].code), title: String(rows[0].title) } : undefined
  }
  return undefined
}

export async function createOwnedBoard(ownerSub: string, title: string) {
  const workspaceId = crypto.randomUUID()
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const name = title.trim() ? cleanTitle(title) : await newBoardName(sql)
  await sql`INSERT INTO phab_share_codes (code, workspace_id, title, owner_sub)
    VALUES (${code}, ${workspaceId}::uuid, ${name}, ${ownerSub})`
  await saveMember(sql, ownerSub, code, 'owner')
  return { workspaceId, code, title: name }
}

export type ChatHistoryMessage = { id: string; role: 'user' | 'assistant'; modality: 'chat' | 'voice'; text: string; at: string }

/** Upserts conversation turns so re-sent transcripts never duplicate history. */
export async function saveChatMessages(
  workspaceId: string,
  messages: { id: string; role: string; modality?: string; text: string }[],
) {
  const rows = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.text.trim())
    .map((message) => ({
      id: message.id.slice(0, 120), role: message.role,
      modality: message.modality === 'voice' ? 'voice' : 'chat',
      content: message.text.slice(0, 20_000),
    }))
  if (!rows.length) return
  await sql`INSERT INTO phab_chat_messages (workspace_id, id, role, modality, content)
    SELECT ${workspaceId}::uuid, m.id, m.role, m.modality, m.content
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS m(id text, role text, modality text, content text)
    ON CONFLICT (workspace_id, id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`
}

export async function listChatHistory(workspaceId: string, limit = 300): Promise<ChatHistoryMessage[]> {
  const rows = await sql`SELECT id, role, modality, content, created_at FROM (
    SELECT id, role, modality, content, created_at FROM phab_chat_messages
    WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at DESC LIMIT ${limit}
  ) latest ORDER BY created_at ASC`
  return rows.map((row) => ({
    id: String(row.id), role: row.role as ChatHistoryMessage['role'],
    modality: row.modality === 'voice' ? 'voice' : 'chat',
    text: String(row.content), at: isoTimestamp(row.created_at),
  }))
}

export type JobKind = 'research' | 'browser'

export async function insertJob(workspaceId: string, title: string, task: string, context: CanvasStack[], replaces: string[] = [], options?: { kind?: JobKind; browserId?: string }) {
  const id = crypto.randomUUID()
  const kind = options?.kind ?? 'research'
  const rows = await sql`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task, context, replaces, kind, browser_id)
    VALUES (${workspaceId}::uuid, ${id}::uuid, ${title}, ${task}, ${JSON.stringify(context)}::jsonb, ${JSON.stringify(replaces)}::jsonb, ${kind}, ${options?.browserId ?? null}::uuid) RETURNING *`
  const job = publicJob(rows[0])
  // A telemetry failure must not undo or block durable job lifecycle changes.
  const queued = await recordJobEvent(workspaceId, id, { type: 'queued', message: kind === 'browser' ? 'Browser task saved to the queue.' : 'Research request saved to the queue.' }).catch(() => undefined)
  if (queued) job.events.push(queued)
  // A replaced job that is still in flight is superseded now; its stack (if
  // any) stays visible until the replacement publishes into the same slot.
  const cancelled = replaces.length ? await cancelJobs(workspaceId, replaces, `Replaced by “${title}”`) : []
  return { job, cancelled }
}

async function cancelJobs(workspaceId: string, ids: string[], progress: string) {
  const rows = await sql`UPDATE phab_canvas_jobs SET status = 'cancelled', progress = ${progress}, updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND (id::text = ANY(${ids}) OR stack_id::text = ANY(${ids}))
      AND status IN ('queued', 'running') RETURNING *`
  return await Promise.all(rows.map(async (row) => {
    const job = publicJob(row)
    const event = await recordJobEvent(workspaceId, job.id, { type: 'cancelled', message: progress }).catch(() => undefined)
    if (event) job.events.push(event)
    return job
  }))
}

/** Removes stacks from the canvas and stops any in-flight jobs with those IDs. */
export async function removeFromCanvas(workspaceId: string, ids: string[]) {
  // Stop writers before deleting their partial stacks, so they cannot reappear.
  const cancelled = await cancelJobs(workspaceId, ids, 'Removed from the canvas')
  const removed = await sql`DELETE FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid
    AND (id::text = ANY(${ids}) OR id IN (
      SELECT stack_id FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId}::uuid AND id::text = ANY(${ids})
    )) RETURNING id`
  return { removedStackIds: removed.map((row) => String(row.id)), cancelled }
}

/** Compact canvas inventory for the sidecar agent: what is on the canvas and what is still coming. */
export async function canvasInventory(workspaceId: string) {
  const [stacks, jobs] = await Promise.all([
    sql`SELECT id, data->>'title' AS title, jsonb_array_length(data->'sources') AS source_count,
      (SELECT jsonb_agg(s->>'title') FROM (SELECT jsonb_array_elements(data->'sources') s LIMIT 4) t) AS sample_sources, created_at
      FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at DESC LIMIT 40`,
    sql`SELECT id, title, left(task, 400) AS task, status, created_at FROM phab_canvas_jobs
      WHERE workspace_id = ${workspaceId}::uuid AND status IN ('queued', 'running', 'completed') ORDER BY created_at DESC LIMIT 15`,
  ])
  return { stacks, jobs }
}

export async function claimJob(workspaceId: string, id: string) {
  // Atomic lease: duplicate workflow deliveries cannot create duplicate stacks.
  const rows = await sql`UPDATE phab_canvas_jobs SET status = 'running',
    progress = CASE WHEN kind = 'browser' THEN 'Attaching to the browser' ELSE 'Finding sources' END, updated_at = now(),
    worker_id = ${process.env.FLY_MACHINE_ID ?? null}, worker_region = ${process.env.FLY_REGION ?? null},
    started_at = now(), heartbeat_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND (status = 'queued' OR (status = 'running' AND updated_at < now() - interval '12 minutes'))
    RETURNING *`
  const job = rows[0] as (Record<string, unknown> & { task: string; context: CanvasStack[]; kind: JobKind; browser_id: string | null }) | undefined
  if (job) {
    await recordJobEvent(workspaceId, id, {
      type: 'claimed', message: job.kind === 'browser' ? 'Browser agent claimed this task.' : 'Research worker claimed this job.',
      details: { workerId: job.worker_id, workerRegion: job.worker_region },
    }).catch(() => undefined)
  }
  return job
}

export async function pendingJobs() {
  return await sql`SELECT workspace_id, id, kind FROM phab_canvas_jobs
    WHERE status = 'queued' OR (status = 'running' AND updated_at < now() - interval '12 minutes')
    ORDER BY created_at ASC LIMIT 4` as { workspace_id: string; id: string; kind: JobKind }[]
}

export async function updateJob(workspaceId: string, id: string, status: CanvasJob['status'], progress: string) {
  const rows = await sql`UPDATE phab_canvas_jobs SET status = ${status}, progress = ${progress}, updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND status <> 'cancelled' RETURNING id`
  if (status === 'failed' && rows.length) {
    await recordJobEvent(workspaceId, id, { type: 'failed', message: progress }).catch(() => undefined)
  }
}

export async function recordJobEvent(workspaceId: string, jobId: string, event: Omit<JobEvent, 'id' | 'at'>) {
  const rows = await sql`INSERT INTO phab_job_events (workspace_id, job_id, type, message, tool, duration_ms, details)
    SELECT workspace_id, id, ${event.type}, ${event.message}, ${event.tool ?? null},
      ${event.durationMs ?? null}, ${JSON.stringify(event.details ?? {})}::jsonb
    FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId}::uuid AND id = ${jobId}::uuid
    RETURNING id, created_at, type, message, tool, duration_ms, details`
  return rows[0] ? publicEvent(rows[0]) : undefined
}

export async function heartbeatJob(workspaceId: string, jobId: string) {
  const rows = await sql`UPDATE phab_canvas_jobs SET heartbeat_at = now(), updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${jobId}::uuid AND status = 'running' RETURNING id`
  return rows.length > 0
}

export async function upsertPartialStack(workspaceId: string, jobId: string, stack: CanvasStack) {
  const partial: CanvasStack = {
    ...stack, status: 'working', statusText: (stack.statusText ?? 'Research is still running.').slice(0, 500),
  }
  // Lock the job before its stack, matching completeJob. Late partial updates
  // cannot overwrite the final result after the job has completed.
  const rows = await sql`WITH active_job AS (
    UPDATE phab_canvas_jobs SET stack_id = ${stack.id}::uuid, updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${jobId}::uuid AND status IN ('queued', 'running')
    RETURNING workspace_id
  ) INSERT INTO phab_canvas_stacks (workspace_id, id, data)
    SELECT workspace_id, ${stack.id}::uuid, ${JSON.stringify(partial)}::jsonb FROM active_job WHERE true
    ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data
    RETURNING id`
  return rows.length > 0
}

export async function markPartialStackFailed(workspaceId: string, jobId: string, message: string) {
  await sql`UPDATE phab_canvas_stacks AS stacks
    SET data = stacks.data || jsonb_build_object('status', 'failed', 'statusText', ${message.slice(0, 500)}::text)
    FROM phab_canvas_jobs AS jobs
    WHERE jobs.workspace_id = ${workspaceId}::uuid AND jobs.id = ${jobId}::uuid
      AND stacks.workspace_id = jobs.workspace_id AND stacks.id = jobs.stack_id
      AND jobs.status NOT IN ('completed', 'cancelled') AND stacks.data->>'status' IS DISTINCT FROM 'complete'`
}

export async function completeJob(workspaceId: string, id: string, stack: CanvasStack) {
  const completed: CanvasStack = {
    ...stack, status: 'complete',
    statusText: ((stack.status === 'complete' ? stack.statusText : undefined) ?? 'Research complete.').slice(0, 500),
  }
  // Lock the job before touching stacks, matching progressive writes. A
  // cancellation wins if it committed first; otherwise publication is atomic.
  const [published] = await sql.transaction([
    sql`UPDATE phab_canvas_jobs SET status = 'completed', progress = 'Added to your canvas', stack_id = ${stack.id}::uuid, updated_at = now()
      WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND status <> 'cancelled' RETURNING id`,
    sql`INSERT INTO phab_canvas_stacks (workspace_id, id, data, created_at)
      SELECT ${workspaceId}::uuid, ${stack.id}::uuid, ${JSON.stringify(completed)}::jsonb, COALESCE((
        SELECT min(old.created_at) FROM phab_canvas_stacks old
        WHERE old.workspace_id = ${workspaceId}::uuid AND (
          old.id::text IN (SELECT jsonb_array_elements_text(job.replaces)) OR old.id IN (
            SELECT stack_id FROM phab_canvas_jobs prior WHERE prior.workspace_id = ${workspaceId}::uuid
              AND prior.id::text IN (SELECT jsonb_array_elements_text(job.replaces))
          )
        )
      ), (SELECT created_at FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid AND id = ${stack.id}::uuid), now())
      FROM phab_canvas_jobs job WHERE job.workspace_id = ${workspaceId}::uuid AND job.id = ${id}::uuid AND job.status = 'completed'
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
    sql`DELETE FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid AND id <> ${stack.id}::uuid AND id::text IN (
      SELECT jsonb_array_elements_text(replaces) FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId}::uuid AND id = ${id}::uuid AND status = 'completed'
      UNION
      SELECT prior.stack_id::text FROM phab_canvas_jobs prior, phab_canvas_jobs job
        WHERE prior.workspace_id = ${workspaceId}::uuid AND job.workspace_id = ${workspaceId}::uuid AND job.id = ${id}::uuid AND job.status = 'completed'
          AND prior.id::text IN (SELECT jsonb_array_elements_text(job.replaces))
    )`,
  ])
  return published.length > 0
}

/**
 * Empties a workspace's board: research stacks, notes and saved positions go,
 * and any queued or running job is cancelled so it cannot republish a stack.
 * Chat history and share codes stay, so a shared board keeps its link and name.
 */
export async function clearCanvas(workspaceId: string) {
  await sql`UPDATE phab_canvas_jobs SET status = 'cancelled', progress = 'Canvas cleared', updated_at = now()
    WHERE workspace_id = ${workspaceId}::uuid AND status IN ('queued', 'running')`
  await Promise.all([
    sql`DELETE FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId}::uuid`,
    sql`DELETE FROM phab_canvas_notes WHERE workspace_id = ${workspaceId}::uuid`,
    sql`DELETE FROM phab_canvas_layout WHERE workspace_id = ${workspaceId}::uuid`,
  ])
}
