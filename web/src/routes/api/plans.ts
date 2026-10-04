import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { listNorthwestCards } from '#/server/formation'
import { executeNode, getCard, patchNode, publishPlan, saveCard } from '#/server/plans'
import { isSameOrigin, workspaceSession } from '#/server/workspace'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('patch'),
    planId: z.string().uuid(),
    nodeId: z.string().uuid(),
    context: z.string().max(30000).optional(),
    fieldKey: z.string().max(80).optional(),
    fieldValue: z.string().max(4000).optional(),
    confirmField: z.string().max(80).optional(),
    questionId: z.string().uuid().optional(),
    answer: z.string().max(4000).optional(),
  }),
  z.object({
    action: z.literal('execute'),
    planId: z.string().uuid(),
    nodeId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('publish'),
    planId: z.string().uuid(),
    label: z.string().min(1).max(160),
    description: z.string().max(2000).default(''),
  }),
  z.object({
    action: z.literal('save-card'),
    brand: z.string().min(1).max(40),
    last4: z.string().regex(/^\d{4}$/),
    exp: z.string().max(7).default(''),
    zip: z.string().max(16).default(''),
    payableId: z.string().min(1).max(120),
  }),
])

export const Route = createFileRoute('/api/plans')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = workspaceSession(request)
        try {
          const [card, northwest] = await Promise.all([getCard(session.id), listNorthwestCards().catch(() => ({ connected: false, methods: [] }))])
          return Response.json({ card, ...northwest }, { headers: session.headers })
        }
        catch { return Response.json({ error: 'Could not load payment method.' }, { status: 503, headers: session.headers }) }
      },
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) return Response.json({ error: 'Send this from the app.' }, { status: 403 })
        const session = workspaceSession(request)
        try {
          const parsed = bodySchema.safeParse(await request.json())
          if (!parsed.success) return Response.json({ error: 'Invalid plan request.' }, { status: 400, headers: session.headers })
          const body = parsed.data
          if (body.action === 'patch') {
            const plan = await patchNode(session.id, body.planId, body.nodeId, body)
            return Response.json({ plan }, { headers: session.headers })
          }
          if (body.action === 'execute') {
            const result = await executeNode(session.id, body.planId, body.nodeId)
            return Response.json(result, { headers: session.headers })
          }
          if (body.action === 'publish') {
            const plan = await publishPlan(session.id, body.planId, body.label, body.description)
            return Response.json({ plan, url: `/p/${plan.published?.slug}` }, { headers: session.headers })
          }
          const card = await saveCard(session.id, body)
          return Response.json({ card }, { headers: session.headers })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not update this plan.'
          return Response.json({ error: message }, { status: 400, headers: session.headers })
        }
      },
    },
  },
})
