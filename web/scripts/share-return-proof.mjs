#!/usr/bin/env node
// Acceptance proof for the share deep link surviving sign-in.
//
//   /home/debian/saida/workflow/setup-hyperagent.sh run node --import tsx web/scripts/share-return-proof.mjs
//
// Checks the return-path helper, the login call sites, and that a second
// cookie jar which joins /s/<code> sees a note the owner wrote. Deletes the
// throwaway board afterwards.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boardsHref, magicLinkRedirect, safeShareReturn } from '../src/lib/share-return.ts'

const base = (process.env.HYPERAGENT_URL || '').replace(/\/$/, '')
if (!base) {
  console.error('HYPERAGENT_URL is required (run through setup-hyperagent.sh run)')
  process.exit(1)
}

const failures = []
const work = mkdtempSync(join(tmpdir(), 'share-return-proof-'))
const ownerJar = join(work, 'owner-cookies')
const friendJar = join(work, 'friend-cookies')
const root = process.cwd()

function check(name, ok, detail = '') {
  const safe = String(detail).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').slice(0, 300)
  console.log(ok ? `PASS ${name}` : `FAIL ${name}: ${safe}`)
  if (!ok) failures.push(name)
}

function cookieHeader(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter((line) => line && !line.startsWith('#')).map((line) => {
      const parts = line.split('\t')
      return parts.length >= 7 ? `${parts[5]}=${parts[6]}` : ''
    }).filter(Boolean).join('; ')
  } catch {
    return ''
  }
}

function remember(file, response) {
  const current = new Map(cookieHeader(file).split('; ').filter(Boolean).map((part) => {
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
  writeFileSync(file, `${lines.join('\n')}\n`)
}

async function call(file, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookieHeader(file),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  remember(file, response)
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { status: response.status, data, text }
}

const code = 'ab12cd34ef'
check('safe-share-path', safeShareReturn(`/s/${code}`) === `/s/${code}`)
check('safe-encoded-path', safeShareReturn(encodeURIComponent(`/s/${code}`)) === `/s/${code}`)
check('reject-open-redirect', safeShareReturn('https://evil.example/s/abcd') === null)
check('reject-protocol-relative', safeShareReturn('//evil.example/s/abcd') === null)
check('reject-backslash', safeShareReturn('/s/abcd\\evil') === null)
check('reject-query', safeShareReturn('/s/abcd?next=/') === null)
check('reject-short', safeShareReturn('/s/ab') === null)
check('boards-href', boardsHref(`/s/${code}`) === `/boards?next=%2Fs%2F${code}`)
check('boards-href-plain', boardsHref(null) === '/boards' && boardsHref('/boards') === '/boards')
const redirect = magicLinkRedirect('https://dev.hyperagent.lol', `/s/${code}`)
check('magic-link-redirect', redirect === `https://dev.hyperagent.lol/boards?next=%2Fs%2F${code}`, redirect)
check('magic-link-plain', magicLinkRedirect('https://dev.hyperagent.lol/', null) === 'https://dev.hyperagent.lol/boards')

try {
  const boards = readFileSync(join(root, 'web/src/routes/boards.tsx'), 'utf8')
  const dock = readFileSync(join(root, 'web/src/components/canvas/canvas-dock.tsx'), 'utf8')
  const settings = readFileSync(join(root, 'web/src/components/canvas/settings-dialog.tsx'), 'utf8')
  check('boards-source', boards.includes('magicLinkRedirect(location.origin, returnTo.current)') && boards.includes('arrivedFromAuth.current') && boards.includes('location.replace(destination)'))
  check('dock-source', dock.includes('boardsHref') && dock.includes("signedIn ? '/boards' : loginHref"))
  check('settings-source', settings.includes('boardsHref(safeShareReturn(window.location.pathname))'))

  const opened = await call(ownerJar, 'GET', '/api/canvas')
  check('owner-canvas', opened.status === 200, `status ${opened.status}`)
  const share = await call(ownerJar, 'POST', '/api/share', { action: 'create', title: 'city-test share return' })
  const shareCode = share.data?.code || ''
  check('share-create', share.status === 200 && /^[a-z0-9]{4,32}$/i.test(shareCode), `status ${share.status}`)

  const joined = await call(friendJar, 'POST', '/api/share', { action: 'join', code: shareCode })
  check('friend-join', joined.status === 200 && joined.data?.joined === true, `status ${joined.status}`)

  const noteId = crypto.randomUUID()
  const wrote = await call(ownerJar, 'POST', '/api/notes', {
    action: 'upsert',
    note: { id: noteId, label: 'From owner', body: 'share-return-proof-note', x: 12, y: 24 },
  })
  check('owner-note', wrote.status === 200 && wrote.data?.ok === true, `status ${wrote.status}`)

  const friendCanvas = await call(friendJar, 'GET', '/api/canvas')
  const friendNote = (friendCanvas.data?.notes || []).find((note) => note.id === noteId)
  check('friend-sees-note', friendCanvas.status === 200 && friendNote?.body === 'share-return-proof-note' && friendCanvas.data?.shared === true, `status ${friendCanvas.status}`)

  const ownerCanvas = await call(ownerJar, 'GET', '/api/canvas')
  const ownerNote = (ownerCanvas.data?.notes || []).find((note) => note.id === noteId)
  check('owner-sees-same-note', ownerCanvas.status === 200 && ownerNote?.body === 'share-return-proof-note', `status ${ownerCanvas.status}`)
} catch (error) {
  check('proof-ran', false, String(error?.message || error))
} finally {
  const cleanup = spawnSync('node_modules/.bin/dotenv', ['-e', '.env.local', '--', 'node', '--import', 'tsx', 'scripts/supabase-http-cleanup.ts', ownerJar, friendJar], {
    cwd: join(root, 'web'),
    encoding: 'utf8',
    timeout: 120_000,
  })
  check('cleanup', cleanup.status === 0 && (cleanup.stdout || '').includes('PASS http-cleanup'), `${cleanup.stdout || ''}${cleanup.stderr || ''}`.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]').trim().slice(-200))
  rmSync(work, { recursive: true, force: true })
}

process.exit(failures.length ? 1 : 0)
