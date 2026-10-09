#!/usr/bin/env node
// Acceptance proof for shared-board presence and cursors.
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/presence-cursors-proof.mjs
//
// Checks the send rate and the 4px deadzone as pure functions, opens one
// throwaway board the way identity_proof.mjs does, and deletes every row it
// creates. SUPABASE_SECRET_KEY is not available here, so the live two-socket
// join is skipped.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = (process.env.HYPERAGENT_URL || '').replace(/\/$/, '')
if (!base) {
  console.error('HYPERAGENT_URL is required (run through setup-hyperagent.sh run)')
  process.exit(1)
}

const failures = []
const work = mkdtempSync(join(tmpdir(), 'presence-cursors-proof-'))
const jar = join(work, 'cookies')
const root = process.cwd()
let code = ''
const sub = `cccc${Math.random().toString(16).slice(2, 10)}`

function check(name, ok, detail = '') {
  const safe = String(detail).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300)
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

async function call(method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookieHeader(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  remember(response)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: response.status, data }
}

function db(action) {
  const script = join(work, 'presence-db.mjs')
  writeFileSync(script, `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(pathToFileURL(process.cwd() + '/package.json'))
const { PrismaClient } = require('@prisma/client')
const [action, code, sub] = process.argv.slice(2)
const prisma = new PrismaClient()
try {
  if (action === 'seed') {
    await prisma.$executeRawUnsafe('INSERT INTO phab_board_members (sub, code, role, color) VALUES ($1, $2, $3, NULL)', sub, code, 'member')
    const rows = await prisma.$queryRawUnsafe('SELECT sub FROM phab_board_members WHERE code = $1 AND sub = $2', code, sub)
    console.log(JSON.stringify({ seeded: rows.length }))
  } else if (action === 'count') {
    const rows = await prisma.$queryRawUnsafe('SELECT sub FROM phab_board_members WHERE code = $1 AND sub = $2', code, sub)
    console.log(JSON.stringify({ rows: rows.length }))
  } else if (action === 'clear') {
    await prisma.$executeRawUnsafe('DELETE FROM phab_board_members WHERE code = $1 AND sub = $2', code, sub)
    const rows = await prisma.$queryRawUnsafe('SELECT sub FROM phab_board_members WHERE code = $1 AND sub = $2', code, sub)
    console.log(JSON.stringify({ left: rows.length }))
  } else {
    throw new Error('unknown action')
  }
} finally {
  await prisma.$disconnect()
}
`)
  const run = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', script, action, code, sub], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 60_000,
  })
  let data = null
  try { data = JSON.parse((run.stdout || '').trim().split('\n').at(-1) || 'null') } catch { data = null }
  const error = `${run.stderr || ''} ${run.stdout || ''}`.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(-180)
  return { status: run.status, data, error }
}

function secretKeyPresent() {
  try {
    return readFileSync(join(root, 'web/.env.local'), 'utf8').split('\n').some((line) => {
      const trimmed = line.trim()
      return trimmed.startsWith('SUPABASE_SECRET_KEY=') && trimmed.slice('SUPABASE_SECRET_KEY='.length).trim().length > 0
    })
  } catch {
    return false
  }
}

try {
  const realtime = await import(pathToFileURL(resolve(root, 'web/src/lib/canvas-realtime.ts')).href)
  const rates = [
    [1, 8],
    [2, 8],
    [3, 4],
    [4, 2],
    [5, 2],
  ]
  for (const [present, expected] of rates) {
    check(`rate-k${present}`, realtime.cursorRateHz(present) === expected, String(realtime.cursorRateHz(present)))
  }
  check('deadzone-at-4', realtime.cursorPastDeadzone({ x: 0, y: 0 }, { x: 4, y: 0 }) === false)
  check('deadzone-past-4', realtime.cursorPastDeadzone({ x: 0, y: 0 }, { x: 0, y: 4.01 }) === true)
  check('deadzone-diagonal', realtime.cursorPastDeadzone({ x: 1, y: 1 }, { x: 4, y: 4 }) === true)
  check('deadzone-short', realtime.cursorPastDeadzone({ x: 2, y: 2 }, { x: 2, y: 5 }) === false)
  check('deadzone-first', realtime.cursorPastDeadzone(null, { x: 12, y: 12 }) === false)
  const payload = realtime.presencePayload({ id: 'member-1', name: 'Ada', color: '#8AA2FF', kind: 'human', x: 12, y: 40 })
  check('presence-who-is-here', payload.x === undefined && payload.y === undefined && Object.keys(payload).sort().join(',') === 'color,id,kind,name')
  const people = [
    { id: 'b', name: 'Bea', color: '#F2A3C7', kind: 'human' },
    { id: 'a', name: 'Ada', color: '#8AA2FF', kind: 'human' },
    { id: 'c', name: 'Cy', color: '#F0C36A', kind: 'agent' },
    { id: 'd', name: 'Dee', color: '#7DDBB5', kind: 'human' },
    { id: 'e', name: 'Eli', color: '#FF9B7A', kind: 'human' },
    { id: 'f', name: 'Fay', color: '#C9A6FF', kind: 'human' },
    { id: 'g', name: 'Gil', color: '#7AD7F0', kind: 'human' },
  ]
  const stack = realtime.stackPresence(people, 'a')
  check('stack-self-first', stack.shown[0]?.id === 'a' && stack.shown.length === 5 && stack.extra === 2, JSON.stringify(stack))
  check('rejoin-rate-limit', realtime.shouldRejoinRealtime('CLOSED', { reason: 'Too many messages' }) === true)
  check('no-rejoin-other-close', realtime.shouldRejoinRealtime('CLOSED', 'leave') === false)
  check('no-rejoin-socket-error', realtime.shouldRejoinRealtime('CHANNEL_ERROR', 'socket failed') === false)

  const canvas = await call('GET', '/api/canvas')
  check('canvas-session', canvas.status === 200, `status ${canvas.status}`)
  const share = await call('POST', '/api/share', { action: 'create', title: 'city-test presence' })
  code = share.data?.code || ''
  check('share-create', share.status === 200 && !!code, `status ${share.status}`)

  const seeded = db('seed')
  check('seed-member', seeded.status === 0 && seeded.data?.seeded === 1, seeded.error || JSON.stringify(seeded.data))

  const loaded = await call('GET', '/api/canvas')
  const member = (loaded.data?.members || []).find((entry) => entry.id === sub)
  const topic = loaded.data?.realtimeTopic || ''
  check('member-shape', loaded.status === 200 && member?.kind === 'human' && member?.name === `anon${sub.slice(0, 4)}` && typeof member?.color === 'string' && member.color.startsWith('#'), JSON.stringify(member))
  check('realtime-topic', /^board:[0-9a-f]{64}$/.test(topic))

  const cleared = db('clear')
  check('member-cleared', cleared.status === 0 && cleared.data?.left === 0, cleared.error || JSON.stringify(cleared.data))
  const counted = db('count')
  check('member-gone', counted.status === 0 && counted.data?.rows === 0, counted.error || JSON.stringify(counted.data))

  check('secret-key-absent', secretKeyPresent() === false)
  console.log('LIVE_REALTIME=skipped-no-secret-key')
} catch (error) {
  check('proof-ran', false, String(error?.message || error))
} finally {
  if (code) {
    const cleared = db('clear')
    if (cleared.status !== 0) check('member-cleared-final', false, cleared.error || '')
  }
  const cleanup = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', 'scripts/supabase-http-cleanup.ts', jar], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  check('cleanup', cleanup.status === 0 && (cleanup.stdout || '').includes('PASS http-cleanup'), `${cleanup.stdout || ''}${cleanup.stderr || ''}`.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').trim().slice(-200))
  rmSync(work, { recursive: true, force: true })
}

process.exit(failures.length ? 1 : 0)
