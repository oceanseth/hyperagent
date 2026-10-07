import type { CanvasBrowser, CanvasStack } from '#/lib/canvas'
import type { Plan } from '#/lib/plan'
import {
  claimJob,
  claimWorkspace,
  clearCanvas,
  createOwnedBoard,
  getCanvas,
  insertJob,
  listBoards,
  listChatHistory,
  rememberBoard,
  renameBoard,
  resolveShareCode,
  saveBrowser,
  saveChatMessages,
  saveLayout,
  upsertNote,
  upsertPartialStack,
  completeJob,
} from '#/server/canvas-db'
import { client } from '#/server/db'
import { savePlans } from '#/server/plans'
import { deleteWorkspace, disconnect } from './supabase-cleanup'

const failures: string[] = []
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures.push(name)
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 20))

const subA = crypto.randomUUID()
const subB = crypto.randomUUID()
const created: string[] = []

function plan(name: string): Plan {
  return {
    id: crypto.randomUUID(),
    name,
    description: '',
    states: [{
      id: crypto.randomUUID(),
      name: 'Start',
      status: 'pending',
      context: 'Ready to test.',
      fields: [],
      questions: [],
      documents: [],
    }],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function stack(title: string): CanvasStack {
  return {
    id: crypto.randomUUID(),
    title,
    markdown: 'A cited note.',
    sources: [],
    createdAt: new Date().toISOString(),
    status: 'complete',
    statusText: 'Research complete.',
  }
}

function browser(): CanvasBrowser {
  return { id: crypto.randomUUID(), title: 'Browser', status: 'ready', createdAt: new Date().toISOString() }
}

try {
  const a1 = await createOwnedBoard(subA, 'Board A1')
  await pause()
  const a2 = await createOwnedBoard(subA, 'Board A2')
  await pause()
  const b = await createOwnedBoard(subB, 'Board B')
  created.push(a1.workspaceId, a2.workspaceId, b.workspaceId)
  const distinct = new Set([a1.workspaceId, a2.workspaceId, b.workspaceId, a1.code, a2.code, b.code]).size === 6
  check('create-three-boards', distinct)

  const listedA = await listBoards(subA)
  const listedB = await listBoards(subB)
  check('list-owner-boards', listedA.length === 2 && listedA[0]?.code === a2.code && listedA[1]?.code === a1.code && listedA.every((board) => board.role === 'owner') && listedB.length === 1 && listedB[0]?.code === b.code && listedB[0]?.role === 'owner')

  const noteA = crypto.randomUUID()
  const noteB = crypto.randomUUID()
  await upsertNote(a1.workspaceId, { id: noteA, label: 'A', body: 'note-a', x: 1, y: 2 })
  await upsertNote(b.workspaceId, { id: noteB, label: 'B', body: 'note-b', x: 8, y: 9 })
  await saveLayout(a1.workspaceId, { card: { x: 12, y: 34 } })
  const turns = [
    { id: 'turn-user', role: 'user', text: 'hello' },
    { id: 'turn-assistant', role: 'assistant', text: 'hi' },
  ]
  await saveChatMessages(a1.workspaceId, turns)
  await saveChatMessages(a1.workspaceId, turns)
  const liveBrowser = browser()
  await saveBrowser(a1.workspaceId, liveBrowser)
  const writtenPlan = plan('Isolation plan')
  await savePlans(a1.workspaceId, [writtenPlan])
  const published = stack('Isolation stack')
  const { job } = await insertJob(a1.workspaceId, 'Isolation job', 'Find the note', [])
  const claimed = await claimJob(a1.workspaceId, job.id)
  const partial = claimed ? await upsertPartialStack(a1.workspaceId, job.id, { ...published, status: 'working' }) : false
  const done = partial ? await completeJob(a1.workspaceId, job.id, published) : false
  check('write-board-state', Boolean(claimed) && partial && done)

  const canvasA = await getCanvas(a1.workspaceId)
  const canvasB = await getCanvas(b.workspaceId)
  const canvasA2 = await getCanvas(a2.workspaceId)
  const history = await listChatHistory(a1.workspaceId)
  const aOk = canvasA.shared === true && canvasA.boardTitle === a1.title && canvasA.stacks.length === 1 && canvasA.stacks[0]?.id === published.id && canvasA.notes?.length === 1 && canvasA.notes[0]?.body === 'note-a' && canvasA.positions?.card?.x === 12 && canvasA.browsers?.length === 1 && canvasA.browsers[0]?.id === liveBrowser.id && canvasA.plans.length === 1 && canvasA.plans[0]?.id === writtenPlan.id && canvasA.jobs.length === 1 && canvasA.jobs[0]?.id === job.id && (canvasA.jobs[0]?.events.length ?? 0) > 0
  const bOk = canvasB.notes?.length === 1 && canvasB.notes[0]?.body === 'note-b' && canvasB.stacks.length === 0 && canvasB.jobs.length === 0 && (canvasB.browsers?.length ?? 0) === 0 && canvasB.plans.length === 0
  const a2Ok = canvasA2.stacks.length === 0 && (canvasA2.notes?.length ?? 0) === 0 && canvasA2.jobs.length === 0 && canvasA2.boardTitle === a2.title
  const historyOk = history.length === 2 && history[0]?.text === 'hello' && history[1]?.text === 'hi'
  check('canvas-isolation', aOk && bOk && a2Ok && historyOk)

  const resolved = await resolveShareCode(a1.code)
  await rememberBoard(subB, a1.code)
  const afterRemember = await listBoards(subB)
  const member = afterRemember.find((board) => board.code === a1.code)
  const blocked = await renameBoard({ title: 'Hijacked', code: a1.code, ownerSub: subB })
  const renamed = await renameBoard({ title: 'Board A1 renamed', code: a1.code, ownerSub: subA })
  const afterRename = await getCanvas(a1.workspaceId)
  await claimWorkspace(subB, a1.workspaceId)
  const stillBlocked = await renameBoard({ title: 'Taken', code: a1.code, ownerSub: subB })
  const ownerRow = await client().$queryRaw<{ owner_sub: string | null }[]>`SELECT owner_sub FROM phab_share_codes WHERE code = ${a1.code}`
  check('share-and-ownership', resolved === a1.workspaceId && member?.role === 'member' && blocked === undefined && renamed?.title === 'Board A1 renamed' && afterRename.boardTitle === 'Board A1 renamed' && stillBlocked === undefined && ownerRow[0]?.owner_sub === subA)

  const queued = await insertJob(a1.workspaceId, 'Queued job', 'Stay queued', [])
  const running = await insertJob(a1.workspaceId, 'Running job', 'Stay running', [])
  await claimJob(a1.workspaceId, running.job.id)
  await clearCanvas(a1.workspaceId)
  const cleared = await getCanvas(a1.workspaceId)
  const other = await getCanvas(b.workspaceId)
  const keptHistory = await listChatHistory(a1.workspaceId)
  const keptCode = await resolveShareCode(a1.code)
  const queuedRow = cleared.jobs.find((item) => item.id === queued.job.id)
  const runningRow = cleared.jobs.find((item) => item.id === running.job.id)
  const completedRow = cleared.jobs.find((item) => item.id === job.id)
  check('clear-keeps-share-and-chat', cleared.stacks.length === 0 && (cleared.notes?.length ?? 0) === 0 && Object.keys(cleared.positions ?? {}).length === 0 && other.notes?.[0]?.body === 'note-b' && keptHistory.length === 2 && keptCode === a1.workspaceId && queuedRow?.status === 'cancelled' && runningRow?.status === 'cancelled' && completedRow?.status === 'completed')
} catch (error) {
  console.log('FAIL isolation-threw')
  const message = error instanceof Error ? error.message : String(error)
  console.log(message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted-url]').slice(0, 400))
  failures.push('isolation-threw')
} finally {
  for (const workspaceId of created) await deleteWorkspace(workspaceId).catch(() => undefined)
  await disconnect().catch(() => undefined)
}

if (failures.length) process.exit(1)
