import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { phabPrisma?: PrismaClient }

/** Lazily constructed so Vite SSR reloads reuse one pool. */
export function client(): PrismaClient {
  if (!process.env.SUPABASE_DATABASE_URL) throw new Error('Canvas storage is not configured.')
  globalForPrisma.phabPrisma ??= new PrismaClient()
  return globalForPrisma.phabPrisma
}

/** Tagged-template queries. Plain writes return rows the same way reads and RETURNING do. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return client().$queryRaw<Record<string, unknown>[]>(strings, ...values as never[])
}

export type Sql = typeof sql

sql.transaction = <T extends ReturnType<typeof sql>[]>(queries: [...T]) => client().$transaction(queries)
