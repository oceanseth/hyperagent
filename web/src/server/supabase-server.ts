import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Request-scoped Supabase client for route handlers. The session rides in the
// sb-* cookies written by the browser client (src/utils/supabase.ts), so RLS
// sees auth.uid() when queries run through this client. The URL and
// publishable key are public by design; env vars can swap the project.
const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || 'https://srtrucncutffceakivux.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_KEY?.trim() || 'sb_publishable_CKkkRTJvWECPp8dYk3ijsg_nJjLaIYq'

export type ServerSupabase = {
  client: SupabaseClient
  /** Set-Cookie values collected from auth calls (refresh, sign-out). Append to the response when the handler controls one. */
  cookies: string[]
}

export function supabaseServer(request: Request): ServerSupabase {
  const cookies: string[] = []
  const client = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie') ?? '').map(({ name, value }) => ({ name, value: value ?? '' }))
      },
      setAll(next) {
        for (const { name, value, options } of next) cookies.push(serializeCookieHeader(name, value, options))
      },
    },
  })
  return { client, cookies }
}
