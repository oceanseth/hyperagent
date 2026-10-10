// A share deep link may travel through the magic-link round-trip. Only a
// same-site /s/<code> path is accepted, so the return target cannot be an
// open redirect.

const sharePath = /^\/s\/([a-z0-9]{4,32})$/i

export function safeShareReturn(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let path = value.trim()
  if (!path || path.length > 64) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//') || path.includes('\\') || path.includes('@')) return null
  if (path.includes('%')) {
    try { path = decodeURIComponent(path) } catch { return null }
  }
  if (path.includes('%') || path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('@') || path.includes('//')) return null
  const match = sharePath.exec(path)
  if (!match) return null
  return `/s/${match[1]}`
}

export function boardsHref(returnPath: string | null | undefined): string {
  const safe = safeShareReturn(returnPath)
  if (!safe) return '/boards'
  return `/boards?next=${encodeURIComponent(safe)}`
}

export function magicLinkRedirect(origin: string, returnPath: string | null | undefined): string {
  const base = origin.replace(/\/$/, '')
  const safe = safeShareReturn(returnPath)
  if (!safe) return `${base}/boards`
  return `${base}/boards?next=${encodeURIComponent(safe)}`
}
