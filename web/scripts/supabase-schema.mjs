import { Prisma, PrismaClient } from '@prisma/client'

const expected = [
  'phab_canvas_stacks',
  'phab_canvas_jobs',
  'phab_job_events',
  'phab_chat_messages',
  'phab_canvas_notes',
  'phab_canvas_layout',
  'phab_share_codes',
  'phab_board_members',
  'phab_canvas_browsers',
  'phab_plans',
  'phab_published_plans',
  'phab_payment_methods',
  'phab_workspace_settings',
].sort()

const client = new PrismaClient()
const names = Object.values(Prisma.ModelName).sort()
const same = names.length === expected.length && names.every((name, index) => name === expected[index])
console.log(`${same ? 'PASS' : 'FAIL'} models`)
await client.$disconnect()
if (!same) process.exit(1)
console.log('PASS client')
