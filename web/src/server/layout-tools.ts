import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getCanvas, saveLayout } from './canvas-db'
import { browserArtifacts, canvasArtifacts, noteArtifacts, planArtifacts, type WorkspaceState } from '#/lib/canvas-workspace'

type Point = { x: number; y: number }
type ResolvedItem = { id: string; kind: string; label: string; x: number; y: number }

async function resolveItems(workspaceId: string) {
  const snapshot = await getCanvas(workspaceId)
  const state: WorkspaceState = {
    stacks: snapshot.stacks, jobs: snapshot.jobs, plans: snapshot.plans,
    notes: snapshot.notes ?? [], browsers: snapshot.browsers ?? [],
    shared: snapshot.shared ?? false, boardTitle: snapshot.boardTitle ?? '',
    positions: snapshot.positions ?? {}, excludedIds: [], openPlanIds: [],
    focus: null, error: null, loaded: true, syncedAt: null,
  }
  const items: ResolvedItem[] = [
    ...canvasArtifacts(state).map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y })),
    ...planArtifacts(state).map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y })),
    ...browserArtifacts(state).map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y })),
    ...noteArtifacts(state).map((item) => ({ id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y })),
  ]
  return { items, positions: { ...state.positions } }
}

const OFFSET: Record<'right' | 'left' | 'above' | 'below', Point> = {
  right: { x: 340, y: 0 }, left: { x: -340, y: 0 }, below: { x: 0, y: 380 }, above: { x: 0, y: -380 },
}

export function layoutTools(workspaceId: string, onRefresh?: () => void, onFocus?: (id: string) => void) {
  return {
    list_canvas_items: createTool({
      id: 'list_canvas_items',
      description: 'List every item currently on the shared canvas (research stacks and their sources, plan titles and nodes, live browsers, sticky notes) with its id, kind, label and current x/y position. Call this to find real ids before calling rearrange_canvas — never guess an id.',
      inputSchema: z.object({}),
      execute: async () => {
        const { items } = await resolveItems(workspaceId)
        return { items: items.map(({ id, kind, label, x, y }) => ({ id, kind, label, x: Math.round(x), y: Math.round(y) })) }
      },
    }),
    rearrange_canvas: createTool({
      id: 'rearrange_canvas',
      description: 'Move cards around the shared canvas. Get real ids from list_canvas_items first — never guess one. Each move either sets an absolute x/y, or places the item next to another item\'s id with a direction (right/left/above/below spaces them out automatically). Pass resetIds to drop specific items back to their default auto-layout spot, or resetAll to clear every custom position on the board (e.g. "tidy up" or "reset the layout"). Changes apply immediately for everyone watching the board.',
      inputSchema: z.object({
        moves: z.array(z.object({
          id: z.string().min(1).max(120).describe('Id of the item to move, from list_canvas_items.'),
          x: z.number().finite().optional(),
          y: z.number().finite().optional(),
          near: z.string().min(1).max(120).optional().describe('Id of another canvas item to place this one next to, instead of x/y.'),
          direction: z.enum(['right', 'left', 'above', 'below']).default('right'),
        })).max(50).optional(),
        resetIds: z.array(z.string().min(1).max(120)).max(100).optional().describe('Ids to drop back to the default auto-layout position.'),
        resetAll: z.boolean().optional().describe('Clear every saved custom position on this board.'),
        focusId: z.string().max(120).optional().describe('Zoom the canvas to this item once the move is done; defaults to the last moved item.'),
      }),
      execute: async ({ moves, resetIds, resetAll, focusId }) => {
        const { items, positions } = await resolveItems(workspaceId)
        const byId = new Map(items.map((item) => [item.id, item]))
        const next: Record<string, Point> = resetAll ? {} : { ...positions }
        for (const id of resetIds ?? []) delete next[id]
        const moved: string[] = []
        const unresolved: string[] = []
        for (const move of moves ?? []) {
          if (!byId.has(move.id)) { unresolved.push(move.id); continue }
          if (move.x !== undefined && move.y !== undefined) {
            next[move.id] = { x: move.x, y: move.y }
          } else if (move.near) {
            const anchorPos = next[move.near] ?? (byId.has(move.near) ? { x: byId.get(move.near)!.x, y: byId.get(move.near)!.y } : undefined)
            if (!anchorPos) { unresolved.push(move.near); continue }
            const offset = OFFSET[move.direction]
            next[move.id] = { x: anchorPos.x + offset.x, y: anchorPos.y + offset.y }
          } else { unresolved.push(move.id); continue }
          moved.push(move.id)
        }
        const removed = Object.keys(positions).filter((id) => !(id in next))
        const patch: Record<string, Point> = {}
        for (const [id, point] of Object.entries(next)) {
          const previous = positions[id]
          if (!previous || previous.x !== point.x || previous.y !== point.y) patch[id] = point
        }
        await saveLayout(workspaceId, patch, removed)
        onRefresh?.()
        const landed = focusId ?? moved.at(-1)
        if (landed) onFocus?.(landed)
        return {
          ok: unresolved.length === 0,
          moved,
          reset: resetAll ? 'all' as const : resetIds ?? [],
          ...(unresolved.length ? { unresolved, note: 'Some ids were not found on the canvas. Call list_canvas_items again for current ids.' } : {}),
        }
      },
    }),
  }
}
