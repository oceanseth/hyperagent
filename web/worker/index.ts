import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { pendingJobs } from '../src/server/canvas-db'
import { runResearchJob } from '../src/server/research'
import { runBrowserAgentJob } from '../src/server/browser-agent'

const secret = process.env.JOBS_SECRET
if (!secret || !process.env.DATABASE_URL || !process.env.NEON_AI_GATEWAY_BASE_URL || !process.env.NEON_AI_GATEWAY_TOKEN) {
  throw new Error('Worker requires JOBS_SECRET, DATABASE_URL, NEON_AI_GATEWAY_BASE_URL, and NEON_AI_GATEWAY_TOKEN.')
}
const running = new Map<string, Promise<void>>()
let scanning = false
let draining = false
const lifecycle = (event: string, details: Record<string, unknown> = {}) => console.info(JSON.stringify({ at: new Date().toISOString(), event, workerId: process.env.FLY_MACHINE_ID, region: process.env.FLY_REGION, activeJobs: running.size, ...details }))

async function drain() {
  if (scanning || draining || running.size >= 2) return
  scanning = true
  try {
    for (const job of await pendingJobs()) {
      if (running.size >= 2) break
      if (running.has(job.id)) continue
      lifecycle('queue.dispatch', { jobId: job.id, kind: job.kind })
      const run = job.kind === 'browser' ? runBrowserAgentJob : runResearchJob
      const work = run(job.workspace_id, job.id)
        .catch(() => lifecycle('job.interrupted', { jobId: job.id }))
        .finally(() => { running.delete(job.id); lifecycle('job.released', { jobId: job.id }); void drain() })
      running.set(job.id, work)
    }
  } catch {
    lifecycle('queue.unavailable')
  } finally { scanning = false }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(draining ? 503 : 200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: draining ? 'draining' : 'ready' }))
    return
  }
  const expected = Buffer.from(`Bearer ${secret}`)
  const provided = Buffer.from(request.headers.authorization ?? '')
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    response.writeHead(401); response.end(); return
  }
  if (request.method !== 'POST' || request.url !== '/enqueue' || draining) {
    response.writeHead(draining ? 503 : 404); response.end(); return
  }
  // Work is already durably queued in Neon. The HTTP request is only a wake-up.
  // A periodic scan also recovers queued jobs and expired leases after restart.
  request.resume()
  response.writeHead(202, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ accepted: true }))
  void drain()
})

const timer = setInterval(() => { void drain() }, 10_000)
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
  lifecycle('worker.ready', { concurrency: 2 })
  void drain()
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    draining = true
    lifecycle('worker.draining')
    clearInterval(timer)
    server.close()
    void Promise.allSettled([...running.values()]).finally(() => process.exit(0))
  })
}
