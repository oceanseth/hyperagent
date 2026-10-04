import { neon } from '@neondatabase/serverless'
import type { CanvasJob, CanvasStack, CanvasSnapshot, JobEvent } from '#/lib/canvas'

let schemaReady: Promise<void> | undefined
function database() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Canvas storage is not configured.')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(15000) } })
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
    await sql`ALTER TABLE phab_canvas_jobs
      ADD COLUMN IF NOT EXISTS worker_id text,
      ADD COLUMN IF NOT EXISTS worker_region text,
      ADD COLUMN IF NOT EXISTS started_at timestamptz,
      ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz`
    await sql`CREATE TABLE IF NOT EXISTS phab_job_events (
      workspace_id uuid NOT NULL, job_id uuid NOT NULL,
      id bigserial PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
      type text NOT NULL, message text NOT NULL, tool text,
      duration_ms double precision, details jsonb NOT NULL DEFAULT '{}'
    )`
    await sql`CREATE INDEX IF NOT EXISTS phab_job_events_workspace_job_id_idx
      ON phab_job_events (workspace_id, job_id, id DESC)`
  })().catch((error) => { schemaReady = undefined; throw error })
  await schemaReady
  return sql
}

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
  progress: String(row.progress), createdAt: isoTimestamp(row.created_at), updatedAt: isoTimestamp(row.updated_at),
  ...(row.stack_id ? { stackId: String(row.stack_id) } : {}),
  ...(row.worker_id ? { workerId: String(row.worker_id) } : {}),
  ...(row.worker_region ? { workerRegion: String(row.worker_region) } : {}),
  ...(row.started_at ? { startedAt: isoTimestamp(row.started_at) } : {}),
  ...(row.heartbeat_at ? { heartbeatAt: isoTimestamp(row.heartbeat_at) } : {}),
  events: Array.isArray(row.events) ? row.events.map(publicEvent) : [],
})

export async function getCanvas(workspaceId: string): Promise<CanvasSnapshot> {
  const sql = await ready()
  const [stacks, jobs] = await Promise.all([
    sql`SELECT data FROM (SELECT data, created_at FROM phab_canvas_stacks WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 100) latest ORDER BY created_at ASC`,
    sql`SELECT jobs.*, history.events FROM (
      SELECT workspace_id, id, title, status, progress, stack_id, created_at, updated_at,
        worker_id, worker_region, started_at, heartbeat_at
      FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT 30
    ) jobs LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(event ORDER BY event.id), '[]'::jsonb) AS events FROM (
        SELECT id, created_at, type, message, tool, duration_ms, details FROM phab_job_events
        WHERE workspace_id = jobs.workspace_id AND job_id = jobs.id ORDER BY id DESC LIMIT 80
      ) event
    ) history ON true ORDER BY jobs.created_at DESC`,
  ])
  return { stacks: stacks.map((row) => row.data as CanvasStack), jobs: jobs.map(publicJob) }
}

export async function insertJob(workspaceId: string, title: string, task: string, context: CanvasStack[]) {
  const sql = await ready()
  const id = crypto.randomUUID()
  const rows = await sql`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task, context)
    VALUES (${workspaceId}, ${id}, ${title}, ${task}, ${JSON.stringify(context)}::jsonb) RETURNING *`
  const job = publicJob(rows[0])
  // A telemetry failure must not undo or block durable job lifecycle changes.
  const queued = await recordJobEvent(workspaceId, id, { type: 'queued', message: 'Research request saved to the queue.' }).catch(() => undefined)
  if (queued) job.events.push(queued)
  return job
}

export async function claimJob(workspaceId: string, id: string) {
  const sql = await ready()
  // Atomic lease: duplicate workflow deliveries cannot create duplicate stacks.
  const rows = await sql`UPDATE phab_canvas_jobs SET status = 'running', progress = 'Finding sources', updated_at = now(),
    worker_id = ${process.env.FLY_MACHINE_ID ?? null}, worker_region = ${process.env.FLY_REGION ?? null},
    started_at = now(), heartbeat_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${id} AND (status = 'queued' OR (status = 'running' AND updated_at < now() - interval '12 minutes'))
    RETURNING *`
  const job = rows[0] as (Record<string, unknown> & { task: string; context: CanvasStack[] }) | undefined
  if (job) {
    await recordJobEvent(workspaceId, id, {
      type: 'claimed', message: 'Research worker claimed this job.',
      details: { workerId: job.worker_id, workerRegion: job.worker_region },
    }).catch(() => undefined)
  }
  return job
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
  if (status === 'failed') {
    await recordJobEvent(workspaceId, id, { type: 'failed', message: progress }).catch(() => undefined)
  }
}

export async function recordJobEvent(workspaceId: string, jobId: string, event: Omit<JobEvent, 'id' | 'at'>) {
  const sql = await ready()
  const rows = await sql`INSERT INTO phab_job_events (workspace_id, job_id, type, message, tool, duration_ms, details)
    SELECT workspace_id, id, ${event.type}, ${event.message}, ${event.tool ?? null},
      ${event.durationMs ?? null}, ${JSON.stringify(event.details ?? {})}::jsonb
    FROM phab_canvas_jobs WHERE workspace_id = ${workspaceId} AND id = ${jobId}
    RETURNING id, created_at, type, message, tool, duration_ms, details`
  return rows[0] ? publicEvent(rows[0]) : undefined
}

export async function heartbeatJob(workspaceId: string, jobId: string) {
  const sql = await ready()
  await sql`UPDATE phab_canvas_jobs SET heartbeat_at = now(), updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${jobId} AND status = 'running'`
}

export async function upsertPartialStack(workspaceId: string, jobId: string, stack: CanvasStack) {
  const sql = await ready()
  const partial: CanvasStack = {
    ...stack, status: 'working', statusText: (stack.statusText ?? 'Research is still running.').slice(0, 500),
  }
  // Lock the job before its stack, matching completeJob. Late partial updates
  // cannot overwrite the final result after the job has completed.
  const rows = await sql`WITH active_job AS (
    UPDATE phab_canvas_jobs SET stack_id = ${stack.id}, updated_at = now()
    WHERE workspace_id = ${workspaceId} AND id = ${jobId} AND status IN ('queued', 'running')
    RETURNING workspace_id
  ) INSERT INTO phab_canvas_stacks (workspace_id, id, data)
    SELECT workspace_id, ${stack.id}::uuid, ${JSON.stringify(partial)}::jsonb FROM active_job WHERE true
    ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data
    RETURNING id`
  return rows.length > 0
}

export async function markPartialStackFailed(workspaceId: string, jobId: string, message: string) {
  const sql = await ready()
  await sql`UPDATE phab_canvas_stacks AS stacks
    SET data = stacks.data || jsonb_build_object('status', 'failed', 'statusText', ${message.slice(0, 500)}::text)
    FROM phab_canvas_jobs AS jobs
    WHERE jobs.workspace_id = ${workspaceId} AND jobs.id = ${jobId}
      AND stacks.workspace_id = jobs.workspace_id AND stacks.id = jobs.stack_id
      AND jobs.status <> 'completed' AND stacks.data->>'status' IS DISTINCT FROM 'complete'`
}

export async function completeJob(workspaceId: string, id: string, stack: CanvasStack) {
  const sql = await ready()
  const completed: CanvasStack = {
    ...stack, status: 'complete',
    statusText: ((stack.status === 'complete' ? stack.statusText : undefined) ?? 'Research complete.').slice(0, 500),
  }
  await sql.transaction([
    sql`UPDATE phab_canvas_jobs SET status = 'completed', progress = 'Added to your canvas', stack_id = ${stack.id}, updated_at = now()
      WHERE workspace_id = ${workspaceId} AND id = ${id}`,
    sql`INSERT INTO phab_canvas_stacks (workspace_id, id, data) VALUES (${workspaceId}, ${stack.id}, ${JSON.stringify(completed)}::jsonb)
      ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data`,
  ])
}
