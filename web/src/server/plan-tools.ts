import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { upsertCustomPlan, upsertTemplatePlan } from './plans'

const fieldInput = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  value: z.string().max(4000).optional(),
  guessed: z.boolean().optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
})

const questionInput = z.object({
  text: z.string().min(1).max(500),
  blocking: z.boolean().optional(),
})

const stateInput = z.object({
  name: z.string().min(1).max(120),
  context: z.string().min(1).max(8000),
  executeHint: z.string().max(80).optional(),
  fields: z.array(fieldInput).max(20).optional(),
  questions: z.array(questionInput).max(10).optional(),
  child: z.object({
    name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    states: z.array(z.object({
      name: z.string().min(1).max(120),
      context: z.string().min(1).max(8000),
      executeHint: z.string().max(80).optional(),
      fields: z.array(fieldInput).max(20).optional(),
      questions: z.array(questionInput).max(10).optional(),
    })).min(1).max(12),
  }).optional(),
})

export function planTools(workspaceId: string, onChange?: () => void) {
  return {
    upsert_plan: createTool({
      id: 'upsert_plan',
      description: 'Create or update a named fractal state machine on the canvas. Use when the humans have a goal that needs an agent (company formation, a multi-step project, etc.). Prefer template=company-formation for forming an LLC/company. Guessed field values from the conversation auto-fill but stay unconfirmed until a human confirms them. Nested child graphs become inner state machines on a node.',
      inputSchema: z.object({
        name: z.string().min(1).max(160),
        description: z.string().max(2000).optional(),
        template: z.enum(['company-formation', 'custom']).default('custom'),
        guesses: z.array(z.object({ key: z.string().min(1).max(80), value: z.string().min(1).max(400) })).max(30).default([]),
        states: z.array(stateInput).max(20).optional(),
      }),
      execute: async ({ name, description, template, guesses, states }) => {
        const plans = template === 'company-formation' || !states?.length
          ? await upsertTemplatePlan(workspaceId, name, guesses)
          : await upsertCustomPlan(workspaceId, { name, description, states })
        onChange?.()
        const root = plans.find((plan) => !plan.parentId) ?? plans[0]
        return {
          planId: root.id,
          name: root.name,
          nodes: root.states.map((node) => ({
            id: node.id,
            name: node.name,
            status: node.status,
            unanswered: node.questions.filter((question) => question.blocking && !question.answer).length,
            unconfirmed: node.fields.filter((field) => field.required && !field.confirmed).length,
            inner: Boolean(node.childPlanId),
          })),
          note: 'The plan is on the canvas. Humans must confirm guessed fields before any state can execute.',
        }
      },
    }),
  }
}
