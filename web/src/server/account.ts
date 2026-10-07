import { supabaseServer } from './supabase-server'

export type Account = { sub: string; name: string; email: string }

// Sign-in runs client-side through Supabase Auth; the session lives in sb-*
// cookies, so the server verifies the JWT from the same request it serves.
// sub is the Supabase auth.users.id — board/canvas ownership keys on it.
export function authConfigured() {
  return true
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

export async function accountFromRequest(request: Request): Promise<Account | undefined> {
  const { client } = supabaseServer(request)
  try {
    const { data, error } = await client.auth.getClaims()
    const claims = data?.claims
    if (error || !claims?.sub) return undefined
    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>
    const name = [meta.full_name, meta.name, meta.user_name, claims.email].find((item) => typeof item === 'string' && item)
    return {
      sub: String(claims.sub).slice(0, 200),
      name: String(name ?? '').slice(0, 120),
      email: String(claims.email ?? '').slice(0, 200),
    }
  } catch {
    return undefined
  }
}

export async function logoutResponse(request: Request) {
  const { client, cookies } = supabaseServer(request)
  try {
    await client.auth.signOut({ scope: 'local' })
  } catch { /* clear cookies regardless */ }
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: appOrigin(request) })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  if (cookies.length === 0) {
    // signOut found no live session (e.g. expired token): expire sb-* cookies anyway.
    const secure = appOrigin(request).startsWith('https://') ? '; Secure' : ''
    for (const part of request.headers.get('cookie')?.split(';') ?? []) {
      const name = part.trim().split('=')[0]
      if (name?.startsWith('sb-')) headers.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`)
    }
  }
  return new Response(null, { status: 302, headers })
}
