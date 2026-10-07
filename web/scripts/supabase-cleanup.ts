import { client } from '#/server/db'

const WORKSPACE_TABLES = [
  'phab_job_events',
  'phab_canvas_jobs',
  'phab_canvas_stacks',
  'phab_chat_messages',
  'phab_canvas_notes',
  'phab_canvas_layout',
  'phab_canvas_browsers',
  'phab_plans',
  'phab_payment_methods',
  'phab_workspace_settings',
] as const

/** Deletes rows this process created. Identifiers are bound parameters, never other workspaces. */
export async function deleteWorkspace(workspaceId: string) {
  const db = client()
  await db.$transaction(async (tx) => {
    for (const table of WORKSPACE_TABLES) {
      await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE workspace_id = $1::uuid`, workspaceId)
    }
    const codes = await tx.$queryRaw<{ code: string }[]>`SELECT code FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid`
    for (const row of codes) {
      await tx.$executeRaw`DELETE FROM phab_board_members WHERE code = ${row.code}`
    }
    await tx.$executeRaw`DELETE FROM phab_share_codes WHERE workspace_id = ${workspaceId}::uuid`
  })
}

export async function disconnect() {
  await client().$disconnect()
}
