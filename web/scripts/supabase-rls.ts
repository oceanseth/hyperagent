import { PrismaClient, type Prisma } from '@prisma/client'
import { createOwnedBoard, saveLayout, upsertNote } from '#/server/canvas-db'
import { client } from '#/server/db'
import { putSetting } from '#/server/settings-db'
import { deleteWorkspace, disconnect } from './supabase-cleanup'

const directUrl = process.env.SUPABASE_DIRECT_URL
if (!directUrl) {
  console.log('FAIL direct-url-missing')
  process.exit(1)
}

const memberTables = [
  'phab_canvas_stacks', 'phab_canvas_jobs', 'phab_job_events', 'phab_chat_messages',
  'phab_canvas_notes', 'phab_canvas_layout', 'phab_canvas_browsers', 'phab_plans', 'phab_share_codes',
]
const secured = [
  ...memberTables, 'phab_board_members', 'phab_published_plans', 'phab_payment_methods',
  'phab_workspace_settings', '_prisma_migrations',
]
const failures: string[] = []
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures.push(name)
}

const subA = crypto.randomUUID()
const subB = crypto.randomUUID()
const direct = new PrismaClient({ datasourceUrl: directUrl })
const created: { workspaceId: string }[] = []

// Interactive transactions default to a 5s timeout. Right after migrate that
// expires before the role checks finish and Prisma reports the closed
// transaction as "Transaction not found".
const roleTransaction = { maxWait: 20_000, timeout: 30_000 }

function lostTransaction(error: unknown) {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    parts.push(current.message)
    current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined
  }
  return parts.join('\n').includes('Transaction not found')
}

async function asRole<T>(role: 'authenticated' | 'anon', sub: string | null, read: (tx: Prisma.TransactionClient) => Promise<T>) {
  const run = () => direct.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`)
    if (sub) await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`
    return read(tx)
  }, roleTransaction)
  try {
    return await run()
  } catch (error) {
    if (!lostTransaction(error)) throw error
    console.log('retry asRole after Transaction not found')
    return run()
  }
}

try {
  const boardA = await createOwnedBoard(subA, 'RLS board A')
  const boardB = await createOwnedBoard(subB, 'RLS board B')
  created.push(boardA, boardB)
  for (const board of [boardA, boardB]) {
    const noteId = crypto.randomUUID()
    const stackId = crypto.randomUUID()
    const jobId = crypto.randomUUID()
    const browserId = crypto.randomUUID()
    const planId = crypto.randomUUID()
    await upsertNote(board.workspaceId, { id: noteId, label: 'n', body: board.workspaceId, x: 1, y: 2 })
    await saveLayout(board.workspaceId, { card: { x: 3, y: 4 } })
    const db = client()
    await db.$executeRaw`INSERT INTO phab_canvas_stacks (workspace_id, id, data) VALUES (${board.workspaceId}::uuid, ${stackId}::uuid, ${JSON.stringify({ id: stackId })}::jsonb)`
    await db.$executeRaw`INSERT INTO phab_canvas_jobs (workspace_id, id, title, task) VALUES (${board.workspaceId}::uuid, ${jobId}::uuid, 't', 'task')`
    await db.$executeRaw`INSERT INTO phab_job_events (workspace_id, job_id, type, message) VALUES (${board.workspaceId}::uuid, ${jobId}::uuid, 'queued', 'saved')`
    await db.$executeRaw`INSERT INTO phab_chat_messages (workspace_id, id, role, content) VALUES (${board.workspaceId}::uuid, ${'m'}, 'user', 'hi')`
    await db.$executeRaw`INSERT INTO phab_canvas_browsers (workspace_id, id, data) VALUES (${board.workspaceId}::uuid, ${browserId}::uuid, '{}'::jsonb)`
    await db.$executeRaw`INSERT INTO phab_plans (workspace_id, id, data) VALUES (${board.workspaceId}::uuid, ${planId}::uuid, '{}'::jsonb)`
    await db.$executeRaw`INSERT INTO phab_payment_methods (workspace_id, brand, last4, exp, zip, token) VALUES (${board.workspaceId}::uuid, 'visa', '4242', '12/30', '00000', 'payable')`
    await putSetting(board.workspaceId, 'agentmail', `selftest-${crypto.randomUUID()}`)
  }

  const classes = await direct.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${secured})`
  const byName = new Map(classes.map((row) => [row.relname, row]))
  check('rls-enabled', secured.every((name) => byName.get(name)?.relrowsecurity === true && byName.get(name)?.relforcerowsecurity === false))

  const policies = await direct.$queryRaw<{ tablename: string; policyname: string; cmd: string; roles: string; qual: string | null }[]>`
    SELECT tablename, policyname, cmd, roles::text AS roles, qual
    FROM pg_policies WHERE schemaname = 'public' AND (tablename = ANY(${secured}))`
  const expected = new Set([
    ...memberTables.map((table) => `${table}|member_select|SELECT`),
    'phab_board_members|self_select|SELECT',
  ])
  const actual = new Set(policies.map((row) => `${row.tablename}|${row.policyname}|${row.cmd}`))
  const qualsOk = policies.every((row) => {
    const qual = row.qual ?? ''
    if (row.policyname === 'member_select') return qual.includes('is_board_member') && row.roles.includes('authenticated')
    if (row.policyname === 'self_select') return qual.includes('auth.uid') && row.roles.includes('authenticated')
    return false
  })
  check('policies', actual.size === expected.size && [...expected].every((item) => actual.has(item)) && qualsOk)

  async function visibleWorkspaces(sub: string) {
    return asRole('authenticated', sub, async (tx) => {
      const found = new Set<string>()
      for (const table of memberTables) {
        const rows = await tx.$queryRawUnsafe<{ workspace_id: string }[]>(`SELECT workspace_id::text AS workspace_id FROM ${table}`)
        for (const row of rows) found.add(row.workspace_id)
      }
      const members = await tx.$queryRaw<{ sub: string }[]>`SELECT sub FROM phab_board_members`
      const settings = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM phab_workspace_settings`
      const payments = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM phab_payment_methods`
      return { found, members: members.map((row) => row.sub), settings: Number(settings[0]?.n ?? 0), payments: Number(payments[0]?.n ?? 0) }
    })
  }

  const seenA = await visibleWorkspaces(subA)
  const seenB = await visibleWorkspaces(subB)
  const ownA = seenA.found.has(boardA.workspaceId) && !seenA.found.has(boardB.workspaceId)
  const ownB = seenB.found.has(boardB.workspaceId) && !seenB.found.has(boardA.workspaceId)
  check('member-sees-own-board', ownA && ownB)
  check('member-rows-match-sub', seenA.members.every((sub) => sub === subA) && seenB.members.every((sub) => sub === subB) && seenA.members.length > 0 && seenB.members.length > 0)
  check('server-only-hidden', seenA.settings === 0 && seenB.settings === 0 && seenA.payments === 0 && seenB.payments === 0)

  const anonCounts = await asRole('anon', null, async (tx) => {
    let total = 0
    for (const table of secured.filter((name) => name !== '_prisma_migrations')) {
      const rows = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`)
      total += Number(rows[0]?.n ?? 0)
    }
    const migrations = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM _prisma_migrations`
    return total + Number(migrations[0]?.n ?? 0)
  })
  check('anon-sees-nothing', anonCounts === 0)

  const write = await asRole('authenticated', subA, async (tx) => {
    const attempts = [
      tx.$queryRaw`INSERT INTO phab_canvas_notes (workspace_id, id, label, body) VALUES (${boardA.workspaceId}::uuid, ${crypto.randomUUID()}::uuid, 'nope', 'nope') RETURNING id`,
      tx.$queryRaw`UPDATE phab_canvas_notes SET label = 'nope' WHERE workspace_id = ${boardA.workspaceId}::uuid RETURNING id`,
      tx.$queryRaw`DELETE FROM phab_canvas_notes WHERE workspace_id = ${boardA.workspaceId}::uuid RETURNING id`,
    ]
    const results: boolean[] = []
    for (const attempt of attempts) {
      try {
        const rows = await attempt as unknown[]
        results.push(rows.length === 0)
      } catch {
        results.push(true)
      }
    }
    return results.every(Boolean)
  })
  check('writes-denied', write)
} catch (error) {
  console.log('FAIL rls-threw')
  const message = error instanceof Error ? error.message : String(error)
  console.log(message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').slice(0, 400))
  failures.push('rls-threw')
} finally {
  for (const board of created) await deleteWorkspace(board.workspaceId).catch(() => undefined)
  await direct.$disconnect().catch(() => undefined)
  await disconnect().catch(() => undefined)
}

if (failures.length) process.exit(1)
