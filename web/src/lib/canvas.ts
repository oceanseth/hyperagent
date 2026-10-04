import { z } from 'zod'

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
  sources: z.array(canvasSourceSchema.extend({ id: z.string().uuid() })).max(8),
})

export type CanvasSource = z.infer<typeof canvasStackSchema>['sources'][number]
export type CanvasStack = z.infer<typeof canvasStackSchema>
export type CanvasJob = {
  id: string
  title: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: string
  createdAt: string
  updatedAt: string
  stackId?: string
}

export type CanvasSnapshot = { stacks: CanvasStack[]; jobs: CanvasJob[] }
