// Resolves the app's "#/..." alias and extensionless TS imports for plain Node scripts.
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const SRC = new URL('../src/', import.meta.url)
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('#/')) {
    const base = new URL(specifier.slice(2), SRC)
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) { const u = new URL(base.href + ext); if (existsSync(u)) return { url: u.href, shortCircuit: true } }
  }
  return next(specifier, context)
}
