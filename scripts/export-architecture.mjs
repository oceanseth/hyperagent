import { spawnSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'web/public/architecture')
const exported = spawnSync(process.execPath, [
  path.join(root, 'node_modules/groma.md/cli.cjs'),
  'export', path.join(output, 'map'),
  '--url', 'https://hyperagent.lol/architecture/map/',
], { cwd: root, stdio: 'inherit' })
if (exported.error) throw exported.error
if (exported.status !== 0) process.exit(exported.status ?? 1)

// The guided presentation reads its steps from the same authored Groma flows.
const flows = {}
const directory = path.join(root, 'groma/flows')
for (const name of await readdir(directory)) {
  if (!name.endsWith('.md') || name === 'index.md') continue
  const markdown = await readFile(path.join(directory, name), 'utf8')
  const id = name.slice(0, -3)
  const steps = [...markdown.matchAll(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|\s*$/gm)]
    .map((match) => ({ from: match[1], to: match[3], action: match[5] }))
  flows[id] = { id, steps }
}
await writeFile(path.join(output, 'flow-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), flows }, null, 2) + '\n')
console.log(`Published ${Object.keys(flows).length} guided flows alongside the architecture map.`)
