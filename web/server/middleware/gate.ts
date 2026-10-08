import { createHash, timingSafeEqual } from 'node:crypto'
import { defineHandler } from 'nitro'

// One shared access key gates the whole site. Only its SHA-256 lives in the
// repo (public); set GATE_KEY in the environment to rotate without a code change.
const KEY_SHA256 = '7cd36352bf6dd157b92f624cadea88f71818ae5ad8c3d232a78fdb6c26221016'
const COOKIE = 'phab-gate'
const GOODBYE = 'Sorry to see you go.'

const sha = (value: string) => createHash('sha256').update(value).digest()
const expected = () => (process.env.GATE_KEY?.trim() ? sha(process.env.GATE_KEY.trim()) : Buffer.from(KEY_SHA256, 'hex'))
const valid = (key: string | undefined) => {
  if (!key) return false
  const a = sha(key)
  const b = expected()
  return a.length === b.length && timingSafeEqual(a, b)
}

function cookie(request: Request, name: string) {
  const raw = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return raw ? decodeURIComponent(raw.slice(name.length + 1)) : undefined
}

const page = (note = '') => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>hyperagent</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#1b1b1b;color:#eee;font:16px system-ui">
<form method=post action=/__gate style="display:grid;gap:12px;width:min(320px,86vw);text-align:center">
<p style="margin:0">${GOODBYE}</p><p style="margin:0;color:#888;font-size:14px">Access key required.</p>
<input name=key type=password placeholder="access key" autofocus style="padding:10px;border-radius:8px;border:1px solid #444;background:#111;color:#eee">
<button style="padding:10px;border-radius:8px;border:0;background:#eee;color:#111">Enter</button><small style="color:#f88">${note}</small></form></body>`, {
  status: 401,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
})

export default defineHandler(async (event) => {
  const request = event.req as Request
  const url = new URL(request.url)

  if (url.pathname === '/__gate' && request.method === 'POST') {
    const key = String((await request.formData()).get('key') ?? '').trim()
    if (!valid(key)) return page('Wrong key.')
    return new Response(null, {
      status: 303,
      headers: {
        Location: '/',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https' ? '; Secure' : ''}`,
      },
    })
  }

  // /api/mcp authenticates with per-board agent tokens (hak_…, see
  // src/server/agent-tokens.ts), never the gate key. Exempt it before the
  // bearer check so an agent token is not mistaken for a wrong gate key.
  if (url.pathname === '/api/mcp' || url.pathname.startsWith('/api/mcp/')) return

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (valid(cookie(request, COOKIE)) || valid(request.headers.get('x-api-key') ?? bearer)) return

  if ((request.headers.get('accept') ?? '').includes('text/html')) return page()
  return Response.json({ error: 'gate', message: GOODBYE }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
})
