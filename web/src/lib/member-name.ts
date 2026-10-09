/** Display name for a board member. Never returns the raw auth sub. */
export function memberName(sub: string, auth: { name?: string | null; email?: string | null } | null | undefined) {
  const name = auth?.name?.trim()
  if (name) return name
  const local = auth?.email?.trim().split('@')[0]
  if (local) return local
  return `anon${sub.slice(0, 4)}`
}
