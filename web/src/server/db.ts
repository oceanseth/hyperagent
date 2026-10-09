import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { phabPrisma?: PrismaClient }

// Prisma's default pool (num_cpus * 2 + 1, 10s wait) starves under one board
// assistant plus a few MCP agents. The URL goes to the pgbouncer pooler, so a
// larger client-side pool is cheap. Explicit params on the URL still win.
function tunedUrl(raw: string): string {
  let url = raw
  for (const param of ['connection_limit=20', 'pool_timeout=30']) {
    const name = param.split('=')[0]
    if (new RegExp(`[?&]${name}=`).test(url)) continue
    url += (url.includes('?') ? '&' : '?') + param
  }
  return url
}

/** Lazily constructed so Vite SSR reloads reuse one pool. */
export function client(): PrismaClient {
  if (!process.env.SUPABASE_DATABASE_URL) throw new Error('Canvas storage is not configured.')
  globalForPrisma.phabPrisma ??= new PrismaClient({ datasourceUrl: tunedUrl(process.env.SUPABASE_DATABASE_URL) })
  return globalForPrisma.phabPrisma
}

/** Tagged-template queries. Plain writes return rows the same way reads and RETURNING do. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return client().$queryRaw<Record<string, unknown>[]>(strings, ...values as never[])
}

export type Sql = typeof sql

sql.transaction = <T extends ReturnType<typeof sql>[]>(queries: [...T]) => client().$transaction(queries)
