import { createBrowserClient } from '@supabase/ssr'

// Cookie-backed browser client. @supabase/ssr skips document.cookie outside
// the browser, so importing this module during SSR does not throw. Auth writes
// still require a browser (or an explicit cookie adapter).
export const supabase = createBrowserClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
)
