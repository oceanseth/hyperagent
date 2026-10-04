import { neon } from '@neondatabase/serverless'
import type { CanvasJob, CanvasStack, CanvasSnapshot } from '#/lib/canvas'

let schemaReady: Promise<void> | undefined
function database() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Canvas storage is not configured.')
  return neon(url)
}

async function ready() {
  const sql = database()
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS phab_canvas_stacks (
      workspace_id uuid NOT NULL, id uuid NOT NULL, data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, id)
    )`
    await sql`CREATE TABLE IF NOT EXISTS phab_canvas_jobs (
      workspace_id uuid NOT NULL, id uuid NOT NULL, title text NOT NULL,
      task text NOT NULL, context jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'queued', progress text NOT NULL DEFAULT 'Queued',
      stack_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, id)
    )`
    // Stack/job IDs this job supersedes; they are swapped out when it publishes.
    await sql`ALTER TABLE phab_canvas_jobs ADD COLUMN IF NOT EXISTS replaces jsonb NOT NULL DEFAULT '[]'`
  })().catch((error) => { schemaReady = undefined; throw error })
  await schemaReady
  return sql
}

const publicJob = (row: Record<string, unknown>): CanvasJob => ({
  id: String(row.id), title: String(row.title), status: row.status as CanvasJob['status'],
  progress: String(row.progress), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  ...(row.stack_id ? { stackId: String(row.stack_id) } : {}),
})

export async function getCanvas(workspaceId: string): Promise<CanvasSnapshot> {
  const sql = await ready()
  const [stacks, jobs] = await Promise.all([
    sql`SELECT data FROM (SELECT data, created_at FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 100) latest ORDER BY created_at ASC`,
    sql`SELECT id, title, status, progress, stack_id, created_at, updated_at FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 30`,
  ])
  return { stacks: stacks.map((row) => row.data as CanvasStack), jobs: jobs.map(publicJob) }
}

export async function insertJob(workspaceId: string, title: string, task: string, context: CanvasStack[], replaces: string[] = []) {
  const sql = await ready()
  const id = crypto.randomUUID()
  const rows = await sql`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task, context, replaces)
    VALUES (${workspaceId}, ${id}, ${title}, ${task}, ${JSON.stringify(context)}::jsonb, ${JSON.stringify(replaces)}::jsonb) RETURNING *`
  // A replaced job that is still in flight is superseded now; its stack (if
  // any) stays visible until the replacement publishes into the same slot.
  const cancelled = replaces.length ? await cancelJobs(workspaceId, replaces, `Replaced by “${title}”`) : []
  return { job: publicJob(rows[0]), cancelled }
}

async function cancelJobs(workspaceId: string, ids: string[], progress: string) {
  const sql = await ready()
  const rows = await sql`UPDATE phab_canvas_jobs SET status = 'cancelled', progress = ${progress}, updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id::text = ANY(${ids}) AND status IN ('queued', 'running') RETURNING *`
  return rows.map(publicJob)
}

/** Removes stacks from the canvas and stops any in-flight jobs with those IDs. */
export async function removeFromCanvas(workspaceId: string, ids: string[]) {
  const sql = await ready()
  const removed = await sql`DELETE FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId} AND id::text = ANY(${ids}) RETURNING id`
  const cancelled = await cancelJobs(workspaceId, ids, 'Removed from the canvas')
  return { removedStackIds: removed.map((row) => String(row.id)), cancelled }
}

/** Compact canvas inventory for the sidecar agent: what is on the canvas and what is still coming. */
export async function canvasInventory(workspaceId: string) {
  const sql = await ready()
  const [stacks, jobs] = await Promise.all([
    sql`SELECT id, data->>'title' AS title, jsonb_array_length(data->'sources') AS source_count,
      (SELECT jsonb_agg(s->>'title') FROM (SELECT jsonb_array_elements(data->'sources') s LIMIT 4) t) AS sample_sources, created_at
      FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 40`,
    sql`SELECT id, title, left(task, 400) AS task, status, created_at FROM phab_canvas_jobs
      WHERE workspace_id = ${workspaceId} AND status IN ('queued', 'running', 'completed') ORDER BY created_at DESC LIMIT 15`,
  ])
  return { stacks, jobs }
}

export async function claimJob(workspaceId: string, id: string) {
  const sql = await ready()
  // Atomic lease: duplicate workflow deliveries cannot create duplicate stacks.
  const rows = await sql`UPDATE phab_canvas_jobs SET status = 'running', progress = 'Finding sources', updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND (status = 'queued' OR (status = 'running' AND updated_at < now() - interval '12 minutes'))
    RETURNING *`
  return rows[0] as (Record<string, unknown> & { task: string; context: CanvasStack[] }) | undefined
}

export async function pendingJobs() {
  const sql = await ready()
  return await sql`SELECT workspace_id, id FROM phab_canvas_jobs
    WHERE status = 'queued' OR (status = 'running' AND updated_at < now() - interval '12 minutes')
    ORDER BY created_at ASC LIMIT 4` as { workspace_id: string; id: string }[]
}

export async function updateJob(workspaceId: string, id: string, status: CanvasJob['status'], progress: string) {
  const sql = await ready()
  await sql`UPDATE phab_canvas_jobs SET status = ${status}, progress = ${progress}, updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND status <> 'cancelled'`
}

export async function completeJob(workspaceId: string, id: string, stack: CanvasStack) {
  const sql = await ready()
  // A cancelled job never publishes. A replacement takes the earliest slot of
  // the stacks it replaces, so it lands where the old cards were.
  await sql.transaction([
    sql`INSERT INTO phab_canvas_stacks (workspace_id, id, data, created_at)
      SELECT ${workspaceId}, ${stack.id}, ${JSON.stringify(stack)}::jsonb, COALESCE((
        SELECT min(old.created_at) FROM phab_canvas_stacks old
        WHERE old.workspace_id = ${workspaceId} AND old.id::text IN (SELECT jsonb_array_elements_text(job.replaces))
      ), now())
      FROM phab_canvas_jobs job WHERE job.workspace_id = ${workspaceId} AND job.id = ${id} AND job.status <> 'cancelled'
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`,
    sql`DELETE FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId} AND id <> ${stack.id} AND id::text IN (
      SELECT jsonb_array_elements_text(replaces) FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId} AND id = ${id} AND status <> 'cancelled')`,
    sql`UPDATE phab_canvas_jobs SET status = 'completed', progress = 'Added to your canvas', stack_id = ${stack.id}, updated_at = now()
      WHERE workspace_id = ${workspaceId} AND id = ${id} AND status <> 'cancelled'`,
  ])
}
