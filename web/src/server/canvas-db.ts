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

export async function insertJob(workspaceId: string, title: string, task: string, context: CanvasStack[]) {
  const sql = await ready()
  const id = crypto.randomUUID()
  const rows = await sql`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task, context)
    VALUES (${workspaceId}, ${id}, ${title}, ${task}, ${JSON.stringify(context)}::jsonb) RETURNING *`
  return publicJob(rows[0])
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
    WHERE workspace_id = ${workspaceId} AND id = ${id}`
}

export async function completeJob(workspaceId: string, id: string, stack: CanvasStack) {
  const sql = await ready()
  await sql.transaction([
    sql`INSERT INTO phab_canvas_stacks (workspace_id, id, data) VALUES (${workspaceId}, ${stack.id}, ${JSON.stringify(stack)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`,
    sql`UPDATE phab_canvas_jobs SET status = 'completed', progress = 'Added to your canvas', stack_id = ${stack.id}, updated_at = now()
      WHERE workspace_id = ${workspaceId} AND id = ${id}`,
  ])
}
