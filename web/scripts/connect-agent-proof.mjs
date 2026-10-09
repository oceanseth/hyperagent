#!/usr/bin/env node
// Acceptance proof for Connect an agent. Run from the worktree root:
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/connect-agent-proof.mjs
//
// Creates a throwaway signed-in board, asserts the hak_ token appears only on
// the first create, list omits the token and its hash, revoke keeps the row,
// and a request that is not a signed-in member is rejected. Deletes every row
// it creates. Never prints the token.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createServerClient } from '@supabase/ssr'

const base = (process.env.HYPERAGENT_URL || '').replace(/\/$/, '')
if (!base) {
  console.error('HYPERAGENT_URL is required (run through setup-hyperagent.sh run)')
  process.exit(1)
}

const root = process.cwd()
loadEnv(join(root, 'web/.env.local'))

const failures = []
const work = mkdtempSync(join(tmpdir(), 'connect-agent-proof-'))
const secrets = []
const workspaceIds = new Set()
let userId = ''
let prisma

function check(name, ok, detail = '') {
  console.log(ok ? `PASS ${name}` : `FAIL ${name}: ${safe(detail)}`)
  if (!ok) failures.push(name)
}

function safe(value) {
  let text = String(value ?? '')
  for (const secret of secrets) {
    if (secret && secret.length > 8) text = text.split(secret).join('[redacted]')
  }
  return text.replace(/hak_[A-Za-z0-9_-]+/g, 'hak_[redacted]').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300)
}

function loadEnv(path) {
  const text = readFileSync(path, 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function publicAuth() {
  const source = readFileSync(join(root, 'web/src/server/supabase-server.ts'), 'utf8')
  const url = process.env.SUPABASE_URL?.trim() || source.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
  const key = process.env.SUPABASE_KEY?.trim() || source.match(/sb_publishable_[A-Za-z0-9_]+/)?.[0]
  if (!url || !key) throw new Error('Supabase URL and publishable key are missing')
  return { url, key }
}

function clientWith(jar) {
  const { url, key } = publicAuth()
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, value]) => ({ name, value }))
      },
      setAll(cookies) {
        for (const cookie of cookies) jar.set(cookie.name, cookie.value)
      },
    },
  })
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ')
}

function remember(jar, response) {
  for (const raw of response.headers.getSetCookie?.() || []) {
    const pair = raw.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq), decodeURIComponent(pair.slice(eq + 1)))
  }
  const workspace = jar.get('phab-workspace')
  if (workspace) workspaceIds.add(workspace)
}

async function call(jar, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookieHeader(jar),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  remember(jar, response)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: response.status, data, text }
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function cleanupWorkspace(id) {
  const file = join(work, `ws-${id}.txt`)
  writeFileSync(file, `# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tphab-workspace\t${id}\n`)
  const run = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', 'scripts/supabase-http-cleanup.ts', file], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  return run.status === 0 && (run.stdout || '').includes('PASS')
}

async function deleteAuthUser(id) {
  if (!id || !prisma) return
  await prisma.$executeRaw`DELETE FROM auth.identities WHERE user_id = ${id}::uuid`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${id}::uuid`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM auth.refresh_tokens WHERE user_id = ${id}::uuid`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ${id}::uuid`
}

async function signInThrowaway() {
  prisma = new PrismaClient()
  const id = randomUUID()
  userId = id
  const email = `city-test-connect-${randomBytes(4).toString('hex')}@hyperagent.lol`
  const password = randomBytes(24).toString('base64url')
  secrets.push(password)
  const instances = await prisma.$queryRaw`SELECT DISTINCT instance_id::text AS instance_id FROM auth.users LIMIT 1`
  const instanceId = instances[0]?.instance_id || '00000000-0000-0000-0000-000000000000'
  await prisma.$executeRaw`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      ${instanceId}::uuid, ${id}::uuid, 'authenticated', 'authenticated', ${email},
      extensions.crypt(${password}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"City Test"}'::jsonb,
      now(), now(), '', '', '', ''
    )`
  await prisma.$executeRaw`
    INSERT INTO auth.identities (
      user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at
    ) VALUES (
      ${id}::uuid, 'email', ${id},
      jsonb_build_object('sub', ${id}::text, 'email', ${email}, 'email_verified', true),
      now(), now(), now()
    )`
  const jar = new Map()
  const supabase = clientWith(jar)
  const signed = await supabase.auth.signInWithPassword({ email, password })
  if (!signed.data?.session?.access_token) {
    throw new Error(signed.error?.code || signed.error?.message || 'sign-in failed')
  }
  secrets.push(signed.data.session.access_token)
  if (signed.data.session.refresh_token) secrets.push(signed.data.session.refresh_token)
  const reader = clientWith(new Map(jar))
  const claims = await reader.auth.getClaims()
  if (claims.data?.claims?.sub !== id) throw new Error(claims.error?.message || 'session cookie was not readable')
  return { id, jar }
}

try {
  const ui = await fetch(`${base}/src/components/canvas/canvas-dock.tsx`)
  const uiText = await ui.text()
  check('ui-connect', ui.status === 200 && uiText.includes('Connect an agent') && uiText.includes('claude mcp add --transport http') && uiText.includes('mcp_servers') && uiText.includes('mcpServers'), `status ${ui.status}`)

  const anon = new Map()
  const canvas = await call(anon, 'GET', '/api/canvas')
  check('canvas-session', canvas.status === 200 && anon.has('phab-workspace'), `status ${canvas.status}`)
  const share = await call(anon, 'POST', '/api/share', { action: 'create', title: 'city-test connect agent' })
  check('share-create', share.status === 200 && !!share.data?.code, `status ${share.status}`)

  const rejected = await call(anon, 'POST', '/api/agents', { action: 'create', name: 'outsider' })
  check('share-cookie-rejected', rejected.status === 401, `status ${rejected.status} ${safe(rejected.text)}`)
  check('share-cookie-has-no-token', !String(rejected.text || '').includes('hak_'), 'anonymous response included a token')

  const session = await signInThrowaway()
  const stranger = new Map(session.jar)
  const strangerCanvas = await call(stranger, 'GET', '/api/canvas')
  const strangerCreate = await call(stranger, 'POST', '/api/agents', { action: 'create', name: 'outsider' })
  check('signed-in-non-member-rejected', strangerCanvas.status === 200 && strangerCreate.status === 403, `canvas ${strangerCanvas.status} create ${strangerCreate.status}`)

  const member = new Map([...anon, ...session.jar])
  const boards = await call(member, 'GET', '/api/workspaces')
  const claimed = Array.isArray(boards.data?.boards) && boards.data.boards.some((board) => board.code === share.data.code)
  check('member-claimed', boards.status === 200 && claimed, `status ${boards.status}`)

  const created = await call(member, 'POST', '/api/agents', { action: 'create', name: 'prophet' })
  const token = created.data?.token
  if (typeof token === 'string') secrets.push(token)
  const agent = created.data?.agent
  const hash = typeof token === 'string' ? tokenHash(token) : ''
  check('color-not-required', created.data?.reason !== 'color_required', safe(created.text))
  check('create-token', created.status === 200 && typeof token === 'string' && /^hak_[A-Za-z0-9_-]+$/.test(token) && token.length > 10, `status ${created.status}`)
  check('create-shape', !!agent && typeof agent.id === 'string' && agent.name === 'prophet' && !('token' in agent) && !('token_hash' in agent) && 'color' in agent, safe(JSON.stringify(agent)))

  const listed = await call(member, 'GET', '/api/agents')
  const listedAgent = (listed.data?.agents || []).find((row) => row.id === agent?.id)
  const listedKeys = listedAgent ? Object.keys(listedAgent).sort() : []
  const listHides = listed.status === 200 && !!listedAgent && typeof token === 'string' && hash.length > 0 && !listed.text.includes(token) && !listed.text.includes(hash) && !listed.text.includes('token_hash') && JSON.stringify(listedKeys) === JSON.stringify(['color', 'id', 'name', 'revoked_at'])
  check('list-hides-secret', listHides, safe(listed.text))

  const revoked = await call(member, 'POST', '/api/agents', { action: 'revoke', id: agent?.id })
  const after = await call(member, 'GET', '/api/agents')
  const kept = (after.data?.agents || []).find((row) => row.id === agent?.id)
  const revokeHides = typeof token === 'string' && hash.length > 0 && !after.text.includes(token) && !after.text.includes(hash)
  check('revoke-keeps-row', revoked.status === 200 && revoked.data?.revoked === true && !!kept?.revoked_at && revokeHides, `status ${revoked.status}`)

  const again = await call(member, 'POST', '/api/agents', { action: 'create', name: 'prophet' })
  const second = again.data?.token
  if (typeof second === 'string') secrets.push(second)
  check('second-token-differs', again.status === 200 && typeof second === 'string' && second !== token && again.data?.agent?.id && again.data.agent.id !== agent?.id, `status ${again.status}`)
} catch (error) {
  check('proof-ran', false, error?.message || error)
} finally {
  let cleared = true
  try {
    if (!prisma) prisma = new PrismaClient()
    for (const id of workspaceIds) {
      await prisma.$executeRaw`DELETE FROM phab_board_agents WHERE workspace_id = ${id}::uuid`
      const codes = await prisma.$queryRaw`SELECT code FROM phab_share_codes WHERE workspace_id = ${id}::uuid`
      for (const row of codes) {
        await prisma.$executeRaw`DELETE FROM phab_board_members WHERE code = ${row.code}`
      }
      if (!cleanupWorkspace(id)) cleared = false
    }
    if (userId) await deleteAuthUser(userId)
    const left = userId ? await prisma.$queryRaw`SELECT id::text AS id FROM auth.users WHERE id = ${userId}::uuid` : []
    if (left.length) cleared = false
  } catch (error) {
    cleared = false
    check('cleanup-error', false, error?.message || error)
  }
  check('rows-cleared', cleared && workspaceIds.size > 0, workspaceIds.size ? '' : 'no workspace')
  await prisma?.$disconnect().catch(() => {})
  rmSync(work, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`FAILED ${failures.length}`)
  process.exit(1)
}
console.log('connect-agent proof passed')
