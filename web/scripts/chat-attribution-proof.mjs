#!/usr/bin/env node
// Acceptance proof for chat attribution. Run from the worktree root:
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/chat-attribution-proof.mjs
//
// Creates a throwaway board, posts a chat line whose body names a fake author,
// and checks the stored row and GET /api/history. The server identity comes
// from an agent token, not the body. A null-author row still reads as someone.
// Deletes the agent, the messages, and the board either way. Never prints secrets.

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)

if (process.argv[2] === 'db') {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const require = createRequire(pathToFileURL(`${process.cwd()}/package.json`))
  const { PrismaClient } = require('@prisma/client')
  const [action, workspaceId, extra, name] = process.argv.slice(3)
  const prisma = new PrismaClient()
  try {
    let finished = false
    if (action === 'columns') {
      const rows = await prisma.$queryRaw`
        SELECT column_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'phab_chat_messages'
          AND column_name IN ('author_id', 'author_name', 'author_kind')
        ORDER BY column_name`
      console.log(JSON.stringify({ columns: rows }))
      finished = true
    } else if (action === 'seed-agent') {
      const rows = await prisma.$queryRaw`
        INSERT INTO phab_board_agents (id, workspace_id, name, token_hash, created_by)
        VALUES (gen_random_uuid(), ${workspaceId}::uuid, ${name}, ${extra}, 'city-test')
        RETURNING id::text AS id, name`
      console.log(JSON.stringify({ id: rows[0]?.id ?? null, name: rows[0]?.name ?? null }))
      finished = true
    } else if (action === 'read') {
      const rows = await prisma.$queryRaw`
        SELECT id, content, author_id, author_name, author_kind
        FROM phab_chat_messages
        WHERE workspace_id = ${workspaceId}::uuid AND id = ${extra}`
      const row = rows[0] || null
      console.log(JSON.stringify({
        found: Boolean(row),
        id: row?.id ?? null,
        content: row?.content ?? null,
        authorId: row?.author_id ?? null,
        authorName: row?.author_name ?? null,
        authorKind: row?.author_kind ?? null,
      }))
      finished = true
    } else if (action === 'insert-null') {
      await prisma.$executeRaw`
        INSERT INTO phab_chat_messages (workspace_id, id, role, content, author_id, author_name, author_kind)
        VALUES (${workspaceId}::uuid, ${extra}, 'user', 'older line', NULL, NULL, NULL)`
      console.log(JSON.stringify({ inserted: true }))
      finished = true
    } else if (action === 'clear-agent') {
      await prisma.$executeRaw`
        DELETE FROM phab_board_agents
        WHERE workspace_id = ${workspaceId}::uuid AND created_by = 'city-test'`
      console.log(JSON.stringify({ cleared: true }))
      finished = true
    } else {
      throw new Error('unknown action')
    }
    if (!finished) throw new Error('db action did not finish')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').slice(0, 300))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
  process.exit(process.exitCode ?? 0)
}

const base = (process.env.HYPERAGENT_URL || '').replace(/\/$/, '')
if (!base) {
  console.error('HYPERAGENT_URL is required (run through setup-hyperagent.sh run)')
  process.exit(1)
}

const failures = []
const work = mkdtempSync(join(tmpdir(), 'chat-attribution-'))
const jar = join(work, 'cookies')
const root = process.cwd()
const messageId = `proof-${randomBytes(8).toString('hex')}`
const nullId = `null-${randomBytes(8).toString('hex')}`
const fake = 'Fake Author'
const agentName = 'city-proof'
let workspaceId = ''
let agentId = ''

function check(name, ok, detail = '') {
  const safe = String(detail).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').replace(/hak_[A-Za-z0-9_-]+/g, '[redacted-token]').slice(0, 300)
  console.log(ok ? `PASS ${name}` : `FAIL ${name}: ${safe}`)
  if (!ok) failures.push(name)
}

function cookieHeader() {
  try {
    return readFileSync(jar, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
      const parts = line.split('\t')
      return parts.length >= 7 ? `${parts[5]}=${parts[6]}` : ''
    }).filter(Boolean).join('; ')
  } catch {
    return ''
  }
}

function remember(response) {
  const current = new Map(cookieHeader().split('; ').filter(Boolean).map((part) => {
    const eq = part.indexOf('=')
    return [part.slice(0, eq), part.slice(eq + 1)]
  }))
  for (const raw of response.headers.getSetCookie?.() || []) {
    const pair = raw.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) current.set(pair.slice(0, eq), pair.slice(eq + 1))
  }
  const lines = ['# Netscape HTTP Cookie File']
  for (const [name, value] of current) lines.push(`127.0.0.1\tFALSE\t/\tFALSE\t0\t${name}\t${value}`)
  writeFileSync(jar, `${lines.join('\n')}\n`)
}

function workspaceFromCookies() {
  const pair = cookieHeader().split('; ').find((part) => part.startsWith('phab-workspace='))
  return pair ? decodeURIComponent(pair.slice('phab-workspace='.length)) : ''
}

async function call(method, path, body, extraHeaders = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookieHeader(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  remember(response)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: response.status, data }
}

function db(action, ...args) {
  const run = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', script, 'db', action, ...args], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 60_000,
  })
  let data = null
  try { data = JSON.parse((run.stdout || '').trim().split('\n').at(-1) || 'null') } catch { data = null }
  const error = (run.stderr || '').replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').slice(-180)
  return { status: run.status, data, error }
}

try {
  const columns = db('columns')
  const cols = new Map((columns.data?.columns || []).map((column) => [column.column_name, column]))
  const nullable = ['author_id', 'author_name', 'author_kind'].every((name) => cols.get(name)?.is_nullable === 'YES' && (cols.get(name)?.column_default == null || cols.get(name)?.column_default === ''))
  check('columns-nullable', columns.status === 0 && nullable, columns.error || JSON.stringify(columns.data))

  const canvas = await call('GET', '/api/canvas')
  check('canvas-session', canvas.status === 200, `status ${canvas.status}`)
  workspaceId = workspaceFromCookies()
  check('workspace-cookie', /^[0-9a-f-]{36}$/i.test(workspaceId), 'missing workspace')

  const share = await call('POST', '/api/share', { action: 'create', title: 'city-test chat attribution' })
  check('share-create', share.status === 200 && !!share.data?.code, `status ${share.status}`)

  const token = `hak_${randomBytes(32).toString('base64url')}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const seeded = db('seed-agent', workspaceId, tokenHash, agentName)
  agentId = seeded.data?.id || ''
  check('seed-agent', seeded.status === 0 && seeded.data?.name === agentName && !!agentId, seeded.error || 'seed failed')

  const posted = await call('POST', '/api/chat', {
    author: fake,
    authorName: fake,
    authorId: 'fake-id',
    authorKind: 'human',
    contextStackIds: [],
    messages: [{
      role: 'user',
      id: messageId,
      author: fake,
      authorName: fake,
      authorId: 'fake-id',
      authorKind: 'phab',
      parts: [{ type: 'text', text: 'hello from the proof' }],
    }],
  }, { Authorization: `Bearer ${token}` })
  check('chat-accepted', posted.status === 200, `status ${posted.status}`)

  const stored = db('read', workspaceId, messageId)
  check('stored-server-identity', stored.status === 0 && stored.data?.found && stored.data?.authorId === agentId && stored.data?.authorName === agentName && stored.data?.authorKind === 'agent' && stored.data?.authorName !== fake && stored.data?.content === 'hello from the proof', stored.error || JSON.stringify(stored.data))

  const asAgent = await call('GET', '/api/history', undefined, { Authorization: `Bearer ${token}` })
  const agentLine = (asAgent.data?.messages || []).find((message) => message.id === messageId)
  check('history-server-identity', asAgent.status === 200 && agentLine?.authorName === agentName && agentLine?.authorKind === 'agent' && agentLine?.authorId === agentId && agentLine?.label === 'You' && !JSON.stringify(agentLine).includes(fake), JSON.stringify(agentLine))

  const asSomeoneElse = await call('GET', '/api/history')
  const otherLine = (asSomeoneElse.data?.messages || []).find((message) => message.id === messageId)
  check('history-not-you', asSomeoneElse.status === 200 && otherLine?.label === agentName && otherLine?.authorName === agentName, JSON.stringify({ label: otherLine?.label, authorName: otherLine?.authorName }))

  const inserted = db('insert-null', workspaceId, nullId)
  check('insert-null', inserted.status === 0 && inserted.data?.inserted === true, inserted.error || '')
  const withNull = await call('GET', '/api/history')
  const nullLine = (withNull.data?.messages || []).find((message) => message.id === nullId)
  check('null-author-someone', withNull.status === 200 && nullLine?.label === 'someone' && nullLine?.authorName == null && nullLine?.authorKind == null, JSON.stringify(nullLine))
} catch (error) {
  check('proof-ran', false, String(error?.message || error))
} finally {
  if (workspaceId) {
    const cleared = db('clear-agent', workspaceId)
    check('agent-cleared', cleared.status === 0, cleared.error || '')
  }
  const cleanup = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', 'scripts/supabase-http-cleanup.ts', jar], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  check('board-cleared', cleanup.status === 0 && (cleanup.stdout || '').includes('PASS'), (cleanup.stderr || '').replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').slice(-180))
}

if (failures.length) {
  console.log(`FAIL ${failures.length}`)
  process.exit(1)
}
console.log('PASS chat-attribution')
