const COOKIE = 'phab-workspace'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// An opaque, server-issued workspace capability. Never accept a workspace ID
// from a browser request body or expose other visitors' stacks.
export function workspaceSession(request: Request) {
  const existing = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  const id = existing && uuid.test(existing) ? existing : crypto.randomUUID()
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (id !== existing) {
    headers.set('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`)
  }
  return { id, headers }
}

// CloudFront rewrites Host to the App Runner origin (AllViewerExceptHostHeader),
// so the server-side URL origin never matches the browser's Origin header on
// the public domain. Accept the public origin(s) explicitly.
const PUBLIC_ORIGINS = new Set(
  (process.env.PUBLIC_ORIGINS ?? 'https://hyperagent.lol').split(',').map((o) => o.trim()).filter(Boolean),
)

export function isSameOrigin(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return false
  return origin === new URL(request.url).origin || PUBLIC_ORIGINS.has(origin)
}
