import { readFileSync } from 'node:fs'
import { deleteWorkspace, disconnect } from './supabase-cleanup'

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ids = new Set<string>()
for (const file of process.argv.slice(2)) {
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    if (!line.includes('phab-workspace')) continue
    const found = line.match(uuid)
    if (found) ids.add(found[1] ? found[1] : found[0])
  }
}
let failed = false
for (const id of ids) {
  try {
    await deleteWorkspace(id)
  } catch {
    failed = true
  }
}
await disconnect().catch(() => undefined)
console.log(`${failed ? 'FAIL' : 'PASS'} http-cleanup`)
if (failed) process.exit(1)
