import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { CanvasJob, CanvasSnapshot } from '#/lib/canvas'
import { runCanvasSidecar, transcript } from './canvas-sidecar'
import { createKernelClient } from './kernel'
import { createExecutorClient, discoverExecutorTools } from './mcp'
import { browserTools } from './browser-tools'
import { planTools } from './plan-tools'

export type AssistantToolEvents = {
  onJob?: (job: CanvasJob) => void
  onRefresh?: () => void
  onFocus?: (id: string) => void
}

export async function loadAssistantTools(options: {
  workspaceId: string
  selected: CanvasSnapshot['stacks']
  conversation: Array<{ role: string; parts?: unknown[]; text?: string }>
  signal?: AbortSignal
  events?: AssistantToolEvents
}) {
  const { workspaceId, selected, conversation, signal, events } = options
  const canvasSidecar = createTool({
    id: 'canvas_sidecar',
    description: 'Delegate any canvas work to your sidecar agent: new research (documents, sources, images, Exa, Cosmos, web), refinements or corrections of earlier research (it replaces the old cards), and removing stacks. Pass the user’s request in their words plus any needed detail. Returns quickly with what it did; research then runs in the background.',
    inputSchema: z.object({ request: z.string().min(1).max(10000) }),
    execute: async ({ request: canvasRequest }) => {
      const result = await runCanvasSidecar({
        workspaceId, request: canvasRequest, conversation: transcript(conversation as never), selected, signal,
        onJob: events?.onJob,
      })
      if (result.removedStackIds.length) events?.onRefresh?.()
      return {
        summary: result.summary,
        queued: result.jobs.map((job) => ({ jobId: job.id, title: job.title })),
        stopped: result.cancelled.map((job) => job.title),
        removedStacks: result.removedStackIds.length,
        note: result.jobs.length ? 'Running independently. Results will appear on the canvas. You can keep chatting.' : undefined,
      }
    },
  })
  const plans = planTools(workspaceId, events?.onRefresh, events?.onFocus)
  const browsers = browserTools(workspaceId, events?.onRefresh, events?.onFocus)
  const executor = createExecutorClient(signal)
  const kernel = await createKernelClient(workspaceId, signal)
  let executorToolsets = {}
  let kernelToolsets = {}
  if (executor) {
    try { executorToolsets = (await discoverExecutorTools(executor)).toolsets }
    catch { executorToolsets = {} }
  }
  if (kernel) {
    try { kernelToolsets = (await discoverExecutorTools(kernel)).toolsets }
    catch { kernelToolsets = {} }
  }
  return {
    toolsets: {
      canvas: { canvas_sidecar: canvasSidecar, upsert_plan: plans.upsert_plan, capture_secret: plans.capture_secret, ...browsers },
      ...executorToolsets,
      ...kernelToolsets,
    },
    disconnect: async () => {
      await Promise.allSettled([executor?.disconnect(), kernel?.disconnect()])
    },
  }
}
