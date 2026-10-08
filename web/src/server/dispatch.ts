/** Starts worker compute for a durably queued job. Prefers spawning a
 * self-destructing Fly Machine (zero idle cost); falls back to waking the
 * always-on worker over HTTP where one still exists. */

const WORKER_APP = process.env.FLY_WORKER_APP ?? 'hyperagent-research'
const WORKER_IMAGE = process.env.FLY_WORKER_IMAGE ?? `registry.fly.io/${WORKER_APP}:latest`

/** One machine per job: runs `worker --once` (drain queue, then exit) with
 * auto_destroy, so it deletes itself when done. App secrets are injected by
 * Fly, so no env needs to be passed here. */
async function spawnWorkerMachine(jobId: string): Promise<boolean> {
  const token = process.env.FLY_MACHINES_TOKEN
  if (!token) return false
  try {
    const response = await fetch(`https://api.machines.dev/v1/apps/${WORKER_APP}/machines`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `job-${jobId.slice(0, 8)}-${Date.now().toString(36)}`,
        region: process.env.FLY_WORKER_REGION ?? 'iad',
        config: {
          image: WORKER_IMAGE,
          guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 },
          auto_destroy: true,
          restart: { policy: 'no' },
          init: { cmd: ['node', '--import', 'tsx', 'worker/index.ts', '--once'] },
        },
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      console.warn('fly machine spawn failed', response.status, await response.text().catch(() => ''))
      return false
    }
    return true
  } catch (error) {
    console.warn('fly machine spawn failed', error)
    return false
  }
}

export async function dispatchResearch(workspaceId: string, jobId: string) {
  const spawned = await spawnWorkerMachine(jobId)
  const url = process.env.JOBS_URL
  const secret = process.env.JOBS_SECRET
  if (!url || !secret) {
    if (spawned) return
    throw new Error('Background jobs are not configured.')
  }
  try {
    const response = await fetch(new URL('/enqueue', url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, jobId }),
      signal: AbortSignal.timeout(2000),
    })
    if (!response.ok && !spawned) throw new Error('Could not start the background job. Please try again.')
  } catch (error) {
    // With a machine spawned the wake is best-effort: after the always-on
    // worker is retired there is nothing listening on JOBS_URL.
    if (!spawned) throw error instanceof Error ? error : new Error('Could not start the background job. Please try again.')
  }
}

export const dispatchJob = dispatchResearch
