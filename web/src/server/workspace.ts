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

export function isSameOrigin(request: Request) {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('sec-fetch-site') !== 'cross-site'
}
