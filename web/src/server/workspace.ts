const COOKIE = 'phab-workspace'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// An opaque, server-issued workspace capability. Never accept a workspace ID
// from a browser request body or expose other visitors' stacks.
export function workspaceCookie(request: Request, id: string) {
  return `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

function readCookie(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

export function readWorkspaceId(request: Request) {
  const existing = readCookie(request, COOKIE)
  return existing && uuid.test(existing) ? existing : undefined
}

export function workspaceSession(request: Request) {
  const existing = readWorkspaceId(request)
  const id = existing ?? crypto.randomUUID()
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  if (id !== existing) {
    headers.set('Set-Cookie', workspaceCookie(request, id))
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
