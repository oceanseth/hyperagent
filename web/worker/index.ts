import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { pendingJobs } from '../src/server/canvas-db'
import { runResearchJob } from '../src/server/research'

const secret = process.env.JOBS_SECRET
if (!secret || !process.env.DATABASE_URL || !process.env.XAI_API_KEY) {
  throw new Error('Worker requires JOBS_SECRET, DATABASE_URL, and XAI_API_KEY.')
}
const running = new Map<string, Promise<void>>()
let scanning = false
let draining = false

async function drain() {
  if (scanning || draining || running.size >= 2) return
  scanning = true
  try {
    for (const job of await pendingJobs()) {
      if (running.size >= 2) break
      if (running.has(job.id)) continue
      const work = runResearchJob(job.workspace_id, job.id)
        .catch(() => console.error('Research job interrupted; its lease will be recovered.', job.id))
        .finally(() => { running.delete(job.id); void drain() })
      running.set(job.id, work)
    }
  } catch {
    console.error('Could not read the research queue; retrying shortly.')
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
  console.info('Phab research worker is ready.')
  void drain()
})

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    draining = true
    clearInterval(timer)
    server.close()
    void Promise.allSettled([...running.values()]).finally(() => process.exit(0))
  })
}
