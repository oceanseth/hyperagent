import { z } from 'zod'
import type { Plan } from './plan'

const publicUrl = z.string().url().max(4096).refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, 'Use a public HTTPS URL')

export const canvasSourceSchema = z.object({
  title: z.string().min(1).max(300),
  url: publicUrl,
  pdfUrl: publicUrl.optional(),
  imageUrl: publicUrl.optional(),
  description: z.string().max(12000).optional(),
})

export const stackInputSchema = z.object({
  title: z.string().min(1).max(200),
  markdown: z.string().min(1).max(30000).describe('A concise Markdown synthesis with citations to the source URLs. Distinguish abstracts or snippets from full documents you actually read.'),
  sources: z.array(canvasSourceSchema).max(8),
})

export const canvasStackSchema = stackInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string(),
  status: z.enum(['working', 'complete', 'failed']).optional(),
  statusText: z.string().max(500).optional(),
  sources: z.array(canvasSourceSchema.extend({ id: z.string().uuid() })).max(8),
})

export type CanvasSource = z.infer<typeof canvasStackSchema>['sources'][number]
export type CanvasStack = z.infer<typeof canvasStackSchema>
export type JobEvent = {
  id: number
  at: string
  type: string
  message: string
  tool?: string
  durationMs?: number
  details?: Record<string, unknown>
}
export type CanvasJob = {
  id: string
  title: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  kind?: 'browser'
  browserId?: string
  progress: string
  createdAt: string
  updatedAt: string
  stackId?: string
  workerId?: string
  workerRegion?: string
  startedAt?: string
  heartbeatAt?: string
  events: JobEvent[]
}

export const canvasNoteSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(200),
  body: z.string().max(20000),
  x: z.number(),
  y: z.number(),
  promotedPlanId: z.string().uuid().optional(),
  promotedNodeId: z.string().uuid().optional(),
})
export type CanvasNote = z.infer<typeof canvasNoteSchema>

export const canvasBrowserSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  url: z.string().max(4096).optional(),
  status: z.enum(['starting', 'ready', 'failed']),
  statusText: z.string().max(500).optional(),
  liveViewUrl: publicUrl.optional(),
  sessionId: z.string().max(200).optional(),
  provider: z.enum(['executor', 'kernel']).optional(),
  // The browser agent (Fly worker) currently or most recently driving this session.
  agent: z.object({
    jobId: z.string().uuid(),
    task: z.string().max(500),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    step: z.string().max(300).optional(),
    result: z.string().max(2000).optional(),
    updatedAt: z.string(),
  }).optional(),
  createdAt: z.string(),
})
export type CanvasBrowser = z.infer<typeof canvasBrowserSchema>

export type CanvasMember = {
  id: string
  name: string
  color: string
  kind: 'human' | 'agent'
}

export type CanvasSnapshot = {
  stacks: CanvasStack[]; jobs: CanvasJob[]; plans: Plan[]
  notes?: CanvasNote[]
  browsers?: CanvasBrowser[]
  members?: CanvasMember[]
  positions?: Record<string, { x: number; y: number }>
  shared?: boolean
  boardTitle?: string
}
