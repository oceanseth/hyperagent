import { spawn } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const direct = process.env.SUPABASE_DIRECT_URL
if (!direct) {
  console.log('FAIL direct-url-missing')
  process.exit(1)
}

const name = `selftest_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
const admin = new PrismaClient({ datasourceUrl: direct })

function withSchema(raw) {
  const join = raw.includes('?') ? '&' : '?'
  return `${raw}${join}schema=${encodeURIComponent(name)}`
}

function redact(text) {
  return text.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]')
}

function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

let failed = false
try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${name}"`)
  const env = { ...process.env, SUPABASE_DIRECT_URL: withSchema(direct) }
  const deployed = await run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], env)
  if (deployed.code !== 0) {
    console.log('FAIL migrate-deploy')
    console.log(redact(deployed.out).slice(-2000))
    failed = true
  } else {
    console.log('PASS migrate-deploy')
  }
  const tables = await admin.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = ${name}`
  const indexes = await admin.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = ${name}`
  const tableNames = new Set(tables.map((row) => row.tablename))
  const indexNames = new Set(indexes.map((row) => row.indexname))
  const requiredTables = [
    'phab_canvas_stacks', 'phab_canvas_jobs', 'phab_job_events', 'phab_chat_messages',
    'phab_canvas_notes', 'phab_canvas_layout', 'phab_share_codes', 'phab_board_members',
    'phab_canvas_browsers', 'phab_plans', 'phab_published_plans', 'phab_payment_methods',
    'phab_workspace_settings',
  ]
  const requiredIndexes = [
    'phab_job_events_workspace_job_id_idx',
    'phab_chat_messages_workspace_created_idx',
    'phab_share_codes_workspace_idx',
  ]
  const tablesOk = requiredTables.every((table) => tableNames.has(table))
  const indexesOk = requiredIndexes.every((index) => indexNames.has(index))
  console.log(`${tablesOk ? 'PASS' : 'FAIL'} tables`)
  console.log(`${indexesOk ? 'PASS' : 'FAIL'} indexes`)
  if (!tablesOk || !indexesOk) failed = true
} catch (error) {
  console.log('FAIL migrate-selftest')
  console.log(redact(error instanceof Error ? error.message : String(error)).slice(0, 500))
  failed = true
} finally {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`).catch(() => undefined)
  await admin.$disconnect()
}
if (failed) process.exit(1)
