import { createHmac, timingSafeEqual } from 'node:crypto'

const ACCOUNT = 'phab-account'

export type Account = { sub: string; name: string; email: string }

// Google sign-in runs client-side through Firebase Auth; the server verifies the
// ID token against the same Firebase project and keeps its own sealed cookie.
// The Firebase web config is public by design; env vars can swap the project.
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY?.trim() || 'AIzaSyBIEI6RLWvtoDuMWbMtzkjq3lEnywKheWo'
const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN?.trim() || 'chooseyourprotocol.firebaseapp.com'

export function firebaseClientConfig() {
  return { apiKey: FIREBASE_API_KEY, authDomain: FIREBASE_AUTH_DOMAIN }
}

function sessionSecret() {
  return process.env.SESSION_SECRET?.trim() || process.env.AUTH0_SECRET?.trim() || ''
}

export function authConfigured() {
  return Boolean(sessionSecret())
}

export function appOrigin(request: Request) {
  const url = new URL(request.url)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return url.origin
  const allowed = (process.env.PUBLIC_ORIGINS ?? 'https://hyperagent.lol').split(',').map((item) => item.trim()).filter(Boolean)
  const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (forwarded) {
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    const origin = `${proto}://${forwarded}`
    if (allowed.includes(origin) || forwarded.startsWith('localhost')) return origin
  }
  return allowed[0] ?? 'https://hyperagent.lol'
}

function cookieValue(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

function setCookie(name: string, value: string, request: Request, maxAge: number) {
  const secure = appOrigin(request).startsWith('https://') ? '; Secure' : ''
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function seal(value: unknown, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

function open<T>(token: string, secret: string): T | undefined {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return undefined
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payload, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()) as T } catch { return undefined }
}

export function accountFromRequest(request: Request): Account | undefined {
  const secret = sessionSecret()
  const raw = cookieValue(request, ACCOUNT)
  if (!secret || !raw) return undefined
  const data = open<Account & { exp?: number }>(decodeURIComponent(raw), secret)
  if (!data?.sub || !data.exp || data.exp < Date.now()) return undefined
  return {
    sub: String(data.sub).slice(0, 200),
    name: String(data.name ?? '').slice(0, 120),
    email: String(data.email ?? '').slice(0, 200),
  }
}

function accountCookie(account: Account, request: Request, secret: string) {
  const token = seal({ ...account, exp: Date.now() + 30 * 864e5 }, secret)
  return setCookie(ACCOUNT, token, request, 30 * 86400)
}

export async function sessionResponse(request: Request) {
  const secret = sessionSecret()
  if (!secret) return Response.json({ error: 'Login is not configured on this server yet.' }, { status: 503 })
  let idToken = ''
  try {
    const body = await request.json() as { idToken?: unknown }
    if (typeof body?.idToken === 'string') idToken = body.idToken
  } catch { /* fall through to the length check */ }
  if (!idToken || idToken.length > 4096) return Response.json({ error: 'Login did not finish. Try again.' }, { status: 400 })
  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await lookup.json() as { users?: Array<{ localId?: string; email?: string; displayName?: string }> }
    const user = data.users?.[0]
    if (!lookup.ok || !user?.localId) return Response.json({ error: 'Login did not finish. Try again.' }, { status: 401 })
    const account: Account = {
      sub: user.localId,
      name: user.displayName || user.email || 'Account',
      email: user.email || '',
    }
    return Response.json({ account }, { headers: { 'Set-Cookie': accountCookie(account, request, secret), 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Login did not finish. Try again.' }, { status: 502 })
  }
}

export function logoutResponse(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: appOrigin(request) })
  headers.append('Set-Cookie', setCookie(ACCOUNT, '', request, 0))
  return new Response(null, { status: 302, headers })
}
