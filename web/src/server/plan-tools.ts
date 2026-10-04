import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { isSettingKey, putSetting, type SettingKey } from './settings-db'
import { listPlans, patchNode, upsertCustomPlan, upsertTemplatePlan } from './plans'

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

function focusTarget(plans: Awaited<ReturnType<typeof upsertTemplatePlan>>) {
  const root = plans.find((plan) => !plan.parentId) ?? plans[0]
  const secret = root.states.find((node) => node.fields.some((field) => field.secret && !field.confirmed))
  const blocked = root.states.find((node) => node.status === 'blocked' || node.fields.some((field) => field.required && !field.confirmed))
  const node = secret ?? blocked ?? root.states[0]
  return { planId: root.id, nodeId: node?.id, nodeName: node?.name }
}

const SECRET_FIELD: Record<SettingKey, string> = {
  stripe: 'stripeAtlasKey',
  mastra: 'mastraGatewayKey',
  kernel: 'kernelApiKey',
  mercury: 'mercuryToken',
  northwest: 'northwestToken',
  agentmail: 'agentmailKey',
}

export function planTools(workspaceId: string, onChange?: () => void, onFocus?: (id: string) => void) {
  return {
    upsert_plan: createTool({
      id: 'upsert_plan',
      description: 'Create or update a named fractal state machine on the canvas. Use when the humans have a goal that needs an agent (company formation, a multi-step project, etc.). Prefer template=company-formation for forming an LLC/company. Guessed field values from the conversation auto-fill but stay unconfirmed until a human confirms them. Nested child graphs become inner state machines on a node. After creating the plan, the canvas zooms to the first field that still needs input.',
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
        const focus = focusTarget(plans)
        onChange?.()
        if (focus.nodeId) onFocus?.(focus.nodeId)
        const root = plans.find((plan) => !plan.parentId) ?? plans[0]
        return {
          planId: root.id,
          name: root.name,
          focusNodeId: focus.nodeId,
          focusNodeName: focus.nodeName,
          nodes: root.states.map((node) => ({
            id: node.id,
            name: node.name,
            status: node.status,
            unanswered: node.questions.filter((question) => question.blocking && !question.answer).length,
            unconfirmed: node.fields.filter((field) => field.required && !field.confirmed).length,
            inner: Boolean(node.childPlanId),
          })),
          note: 'The plan is on the canvas and the view zoomed to the next input. Humans must confirm guessed fields before any state can execute.',
        }
      },
    }),
    capture_secret: createTool({
      id: 'capture_secret',
      description: 'Store an API key or token the human just spoke or typed (Stripe/Atlas, Mastra Memory Gateway, KERNEL, Mercury, Northwest, AgentMail). Writes it to workspace settings (never shown again in full) and attaches a secret input field on the company plan, then zooms the canvas to that field. Use this instead of treating a key as a research query.',
      inputSchema: z.object({
        key: z.enum(['stripe', 'mastra', 'kernel', 'mercury', 'northwest', 'agentmail']),
        value: z.string().min(8).max(4096),
        companyName: z.string().max(160).optional(),
      }),
      execute: async ({ key, value, companyName }) => {
        if (!isSettingKey(key)) return { stored: false, error: 'Unknown secret.' }
        await putSetting(workspaceId, key, value)
        const existing = await listPlans(workspaceId)
        const hasCompany = existing.some((plan) => plan.template === 'company-formation' && !plan.parentId)
        if (!hasCompany && key !== 'stripe' && !companyName?.trim()) {
          return { stored: true, setting: key, hint: `…${value.slice(-4)}`, note: 'Secret stored in Settings for this workspace.' }
        }
        const guesses = [
          { key: SECRET_FIELD[key], value: 'stored' },
          ...(key === 'stripe' ? [{ key: 'formationProvider', value: 'Stripe Atlas' }] : []),
        ]
        const plans = await upsertTemplatePlan(workspaceId, companyName?.trim() || 'Form a company', guesses)
        const root = plans.find((plan) => !plan.parentId) ?? plans[0]
        const fieldKey = SECRET_FIELD[key]
        const node = root.states.find((entry) => entry.fields.some((field) => field.key === fieldKey)) ?? root.states[0]
        if (node && root.states.some((entry) => entry.fields.some((field) => field.key === fieldKey))) {
          await patchNode(workspaceId, root.id, node.id, { fieldKey, fieldValue: 'stored' })
        }
        onChange?.()
        if (node?.id) onFocus?.(node.id)
        return {
          stored: true,
          setting: key,
          hint: `…${value.slice(-4)}`,
          planId: root.id,
          focusNodeId: node?.id,
          focusNodeName: node?.name,
          note: 'Secret stored for this workspace. The canvas zoomed to the matching plan field. Confirm it there, then continue the formation states.',
        }
      },
    }),
  }
}
