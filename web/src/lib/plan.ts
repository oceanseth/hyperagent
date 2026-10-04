import { z } from 'zod'

export const planSettingSchema = z.enum(['agentmail', 'northwest', 'mercury', 'stripe', 'mastra', 'kernel'])

export const planFieldSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  value: z.string().max(4000).optional(),
  guessed: z.boolean().default(false),
  confirmed: z.boolean().default(false),
  required: z.boolean().default(true),
  secret: z.boolean().default(false),
  setting: planSettingSchema.optional(),
})

export const planQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(500),
  answer: z.string().max(4000).optional(),
  blocking: z.boolean().default(true),
})

export const planDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  kind: z.enum(['articles', 'ein', 'bank', 'safe', 'receipt', 'other']),
  markdown: z.string().max(50000),
  createdAt: z.string(),
})

export const planNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  status: z.enum(['pending', 'blocked', 'ready', 'running', 'done', 'failed']),
  context: z.string().max(30000),
  fields: z.array(planFieldSchema).max(40),
  questions: z.array(planQuestionSchema).max(20),
  childPlanId: z.string().uuid().optional(),
  documents: z.array(planDocumentSchema).max(20).default([]),
  executeHint: z.string().max(80).optional(),
})

export const planEdgeSchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid(),
})

export const planPublicationSchema = z.object({
  slug: z.string().min(4).max(32),
  label: z.string().min(1).max(160),
  description: z.string().max(2000),
})

export const planSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  parentId: z.string().uuid().optional(),
  parentNodeId: z.string().uuid().optional(),
  template: z.string().max(80).optional(),
  states: z.array(planNodeSchema).min(1).max(40),
  edges: z.array(planEdgeSchema).max(80),
  published: planPublicationSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type PlanField = z.infer<typeof planFieldSchema>
export type PlanQuestion = z.infer<typeof planQuestionSchema>
export type PlanDocument = z.infer<typeof planDocumentSchema>
export type PlanNode = z.infer<typeof planNodeSchema>
export type PlanEdge = z.infer<typeof planEdgeSchema>
export type Plan = z.infer<typeof planSchema>

export function nodeBlocked(node: PlanNode) {
  const fields = node.fields.some((field) => field.required && !field.confirmed)
  const questions = node.questions.some((question) => question.blocking && !question.answer?.trim())
  return fields || questions
}

export function refreshPlanStatuses(plan: Plan): Plan {
  const incoming = new Map<string, string[]>()
  for (const node of plan.states) incoming.set(node.id, [])
  for (const edge of plan.edges) incoming.get(edge.to)?.push(edge.from)
  const byId = new Map(plan.states.map((node) => [node.id, node]))
  const states = plan.states.map((node) => {
    if (node.status === 'running' || node.status === 'done' || node.status === 'failed') return node
    if (nodeBlocked(node)) return { ...node, status: 'blocked' as const }
    const parents = incoming.get(node.id) ?? []
    const parentsReady = parents.every((id) => byId.get(id)?.status === 'done')
    return { ...node, status: parentsReady ? 'ready' as const : 'pending' as const }
  })
  return { ...plan, states }
}

export function planVault(plans: Plan[]): PlanDocument[] {
  return plans.flatMap((plan) => plan.states.flatMap((node) => node.documents))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export function rootPlans(plans: Plan[]) {
  return plans.filter((plan) => !plan.parentId)
}
