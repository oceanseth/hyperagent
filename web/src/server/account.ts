import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ACCOUNT = 'phab-account'
const TX = 'phab-auth-tx'

export type Account = { sub: string; name: string; email: string }

type AuthConfig = { domain: string; clientId: string; clientSecret?: string; secret: string }

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

function authConfig(): AuthConfig | undefined {
  const domain = process.env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  const clientId = process.env.AUTH0_CLIENT_ID?.trim()
  const clientSecret = process.env.AUTH0_CLIENT_SECRET?.trim()
  const secret = process.env.AUTH0_SECRET?.trim() || clientSecret
  if (!domain || !clientId || !secret) return undefined
  return { domain, clientId, clientSecret, secret }
}

export function authConfigured() {
  return Boolean(authConfig())
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
  const cfg = authConfig()
  const raw = cookieValue(request, ACCOUNT)
  if (!cfg || !raw) return undefined
  const data = open<Account & { exp?: number }>(decodeURIComponent(raw), cfg.secret)
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

export function loginResponse(request: Request) {
  const cfg = authConfig()
  const origin = appOrigin(request)
  if (!cfg) return Response.redirect(`${origin}/boards?error=config`, 302)
  const state = randomBytes(16).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const redirectUri = `${origin}/api/auth/callback`
  const authorize = new URL(`https://${cfg.domain}/authorize`)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('client_id', cfg.clientId)
  authorize.searchParams.set('redirect_uri', redirectUri)
  authorize.searchParams.set('scope', 'openid profile email')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('code_challenge', challenge)
  authorize.searchParams.set('code_challenge_method', 'S256')
  const headers = new Headers({ Location: authorize.toString(), 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', setCookie(TX, seal({ state, verifier }, cfg.secret), request, 600))
  return new Response(null, { status: 302, headers })
}

export async function callbackResponse(request: Request) {
  const cfg = authConfig()
  const origin = appOrigin(request)
  const fail = (reason: string) => {
    const headers = new Headers({ Location: `${origin}/boards?error=${reason}`, 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', setCookie(TX, '', request, 0))
    return new Response(null, { status: 302, headers })
  }
  if (!cfg) return fail('config')
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const raw = cookieValue(request, TX)
  const tx = raw ? open<{ state?: string; verifier?: string }>(decodeURIComponent(raw), cfg.secret) : undefined
  if (!code || !state || !tx?.verifier || tx.state !== state) return fail('login')
  const redirectUri = `${origin}/api/auth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: tx.verifier,
  })
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret)
  try {
    const tokenResponse = await fetch(`https://${cfg.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
    const token = await tokenResponse.json() as { access_token?: string }
    if (!tokenResponse.ok || !token.access_token) return fail('login')
    const infoResponse = await fetch(`https://${cfg.domain}/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(15000),
    })
    const info = await infoResponse.json() as { sub?: string; name?: string; email?: string; nickname?: string }
    if (!infoResponse.ok || !info.sub) return fail('login')
    const account: Account = {
      sub: info.sub,
      name: info.name || info.nickname || info.email || 'Account',
      email: info.email || '',
    }
    const headers = new Headers({ Location: `${origin}/boards`, 'Cache-Control': 'no-store' })
    headers.append('Set-Cookie', accountCookie(account, request, cfg.secret))
    headers.append('Set-Cookie', setCookie(TX, '', request, 0))
    return new Response(null, { status: 302, headers })
  } catch {
    return fail('login')
  }
}

export function logoutResponse(request: Request) {
  const cfg = authConfig()
  const origin = appOrigin(request)
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', setCookie(ACCOUNT, '', request, 0))
  if (!cfg) {
    headers.set('Location', origin)
    return new Response(null, { status: 302, headers })
  }
  const logout = new URL(`https://${cfg.domain}/v2/logout`)
  logout.searchParams.set('client_id', cfg.clientId)
  logout.searchParams.set('returnTo', origin)
  headers.set('Location', logout.toString())
  return new Response(null, { status: 302, headers })
}
