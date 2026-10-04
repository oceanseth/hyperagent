import { neon } from '@neondatabase/serverless'
import { companyFormationPlan } from '#/lib/company-formation'
import {
  planSchema,
  refreshPlanStatuses,
  type Plan,
  type PlanNode,
} from '#/lib/plan'

let schemaReady: Promise<void> | undefined

function database() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Canvas storage is not configured.')
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(15000) } })
}

async function ready() {
  const sql = database()
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS phab_plans (
      workspace_id uuid NOT NULL, id uuid NOT NULL, data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, id)
    )`
    await sql`CREATE TABLE IF NOT EXISTS phab_published_plans (
      slug text PRIMARY KEY,
      label text NOT NULL,
      description text NOT NULL DEFAULT '',
      tree jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
    await sql`CREATE TABLE IF NOT EXISTS phab_payment_methods (
      workspace_id uuid NOT NULL PRIMARY KEY,
      brand text NOT NULL,
      last4 text NOT NULL,
      exp text NOT NULL,
      zip text NOT NULL,
      token text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  })().catch((error) => { schemaReady = undefined; throw error })
  await schemaReady
  return sql
}

function parsePlan(data: unknown): Plan {
  return refreshPlanStatuses(planSchema.parse(data))
}

export async function listPlans(workspaceId: string): Promise<Plan[]> {
  const sql = await ready()
  const rows = await sql`SELECT data FROM phab_plans WHERE workspace_id = ${workspaceId} ORDER BY created_at ASC`
  return rows.map((row) => parsePlan(row.data))
}

export async function getPlan(workspaceId: string, id: string): Promise<Plan | undefined> {
  const sql = await ready()
  const rows = await sql`SELECT data FROM phab_plans WHERE workspace_id = ${workspaceId} AND id = ${id}`
  return rows[0] ? parsePlan(rows[0].data) : undefined
}

async function writePlan(workspaceId: string, plan: Plan) {
  const sql = await ready()
  const next = refreshPlanStatuses({ ...plan, updatedAt: new Date().toISOString() })
  await sql`INSERT INTO phab_plans (workspace_id, id, data, created_at, updated_at)
    VALUES (${workspaceId}, ${next.id}, ${JSON.stringify(next)}::jsonb, ${next.createdAt}::timestamptz, now())
    ON CONFLICT (workspace_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
  return next
}

export async function savePlans(workspaceId: string, plans: Plan[]) {
  const written: Plan[] = []
  for (const plan of plans) written.push(await writePlan(workspaceId, plan))
  return written
}

export async function upsertTemplatePlan(workspaceId: string, name: string, guesses: { key: string; value: string }[]) {
  const existing = await listPlans(workspaceId)
  const prior = existing.find((plan) => plan.template === 'company-formation' && !plan.parentId)
  if (prior) {
    const overlay = applyGuesses(prior, guesses)
    if (name.trim()) overlay.name = name.trim().slice(0, 160)
    return [await writePlan(workspaceId, overlay), ...existing.filter((plan) => plan.id !== overlay.id && (plan.parentId === overlay.id || plan.id !== prior.id))]
  }
  const { plans } = companyFormationPlan(name.trim() || 'Form a company', guesses)
  return savePlans(workspaceId, plans)
}

function applyGuesses(plan: Plan, guesses: { key: string; value: string }[]): Plan {
  const byKey = new Map(guesses.map((guess) => [guess.key, guess.value]))
  return {
    ...plan,
    states: plan.states.map((node) => ({
      ...node,
      fields: node.fields.map((field) => {
        const value = byKey.get(field.key)
        if (!value || field.confirmed) return field
        return { ...field, value, guessed: true }
      }),
    })),
  }
}

export async function upsertCustomPlan(workspaceId: string, input: {
  id?: string
  name: string
  description?: string
  parentId?: string
  parentNodeId?: string
  states: Array<{
    id?: string
    name: string
    context: string
    executeHint?: string
    fields?: Array<{ key: string; label: string; value?: string; guessed?: boolean; required?: boolean; secret?: boolean }>
    questions?: Array<{ text: string; blocking?: boolean }>
    child?: {
      name: string
      description?: string
      states: Array<{
        name: string
        context: string
        executeHint?: string
        fields?: Array<{ key: string; label: string; value?: string; guessed?: boolean; required?: boolean; secret?: boolean }>
        questions?: Array<{ text: string; blocking?: boolean }>
      }>
    }
  }>
}) {
  const now = new Date().toISOString()
  const existing = input.id ? await getPlan(workspaceId, input.id) : undefined
  const children: Plan[] = []
  const states: PlanNode[] = input.states.map((state, index) => {
    const prior = existing?.states[index]
    const id = state.id ?? prior?.id ?? crypto.randomUUID()
    let childPlanId = prior?.childPlanId
    if (state.child) {
      const childStates = state.child.states.map((child, childIndex) => ({
        id: crypto.randomUUID(),
        name: child.name,
        context: child.context,
        status: 'pending' as const,
        documents: [],
        executeHint: child.executeHint,
        fields: (child.fields ?? []).map((field) => ({
          key: field.key, label: field.label, value: field.value, guessed: field.guessed ?? Boolean(field.value),
          confirmed: false, required: field.required ?? true, secret: field.secret ?? false,
        })),
        questions: (child.questions ?? []).map((question) => ({
          id: crypto.randomUUID(), text: question.text, blocking: question.blocking ?? true,
        })),
      }))
      const child: Plan = refreshPlanStatuses({
        id: childPlanId ?? crypto.randomUUID(),
        name: state.child.name,
        description: state.child.description ?? '',
        parentId: existing?.id ?? crypto.randomUUID(),
        parentNodeId: id,
        states: childStates,
        edges: childStates.slice(1).map((node, childIndex) => ({ from: childStates[childIndex].id, to: node.id })),
        createdAt: now,
        updatedAt: now,
      })
      childPlanId = child.id
      children.push(child)
    }
    return {
      id,
      name: state.name,
      context: state.context,
      status: prior?.status ?? 'pending',
      documents: prior?.documents ?? [],
      executeHint: state.executeHint,
      childPlanId,
      fields: (state.fields ?? prior?.fields ?? []).map((field) => ({
        key: field.key, label: field.label, value: field.value, guessed: field.guessed ?? Boolean(field.value),
        confirmed: prior?.fields.find((entry) => entry.key === field.key)?.confirmed ?? false,
        required: field.required ?? true, secret: field.secret ?? false,
      })),
      questions: (state.questions ?? prior?.questions ?? []).map((question) => ({
        id: 'id' in question && typeof question.id === 'string' ? question.id : crypto.randomUUID(),
        text: question.text,
        answer: 'answer' in question ? question.answer : undefined,
        blocking: question.blocking ?? true,
      })),
    }
  })
  const id = existing?.id ?? input.id ?? crypto.randomUUID()
  for (const child of children) {
    child.parentId = id
  }
  const plan = await writePlan(workspaceId, {
    id,
    name: input.name,
    description: input.description ?? existing?.description ?? '',
    parentId: input.parentId ?? existing?.parentId,
    parentNodeId: input.parentNodeId ?? existing?.parentNodeId,
    states,
    edges: states.slice(1).map((state, index) => ({ from: states[index].id, to: state.id })),
    published: existing?.published,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  const writtenChildren = await savePlans(workspaceId, children)
  return [plan, ...writtenChildren]
}

export async function patchNode(workspaceId: string, planId: string, nodeId: string, patch: {
  context?: string
  fieldKey?: string
  fieldValue?: string
  confirmField?: string
  questionId?: string
  answer?: string
}) {
  const plan = await getPlan(workspaceId, planId)
  if (!plan) throw new Error('Plan not found.')
  const next: Plan = {
    ...plan,
    states: plan.states.map((node) => {
      if (node.id !== nodeId) return node
      return {
        ...node,
        context: patch.context ?? node.context,
        fields: node.fields.map((field) => {
          if (patch.fieldKey && field.key === patch.fieldKey) return { ...field, value: patch.fieldValue, guessed: field.guessed }
          if (patch.confirmField && field.key === patch.confirmField) return { ...field, confirmed: true }
          return field
        }),
        questions: node.questions.map((question) => (
          patch.questionId === question.id ? { ...question, answer: patch.answer } : question
        )),
      }
    }),
  }
  return writePlan(workspaceId, next)
}

export async function saveCard(workspaceId: string, input: { brand: string; last4: string; exp: string; zip: string; payableId: string }) {
  if (!/^\d{4}$/.test(input.last4)) throw new Error('Card last four is required.')
  if (!input.payableId.trim()) throw new Error('Select a Northwest payment method. The PAN is never stored here.')
  const sql = await ready()
  const token = input.payableId.trim().slice(0, 120)
  await sql`INSERT INTO phab_payment_methods (workspace_id, brand, last4, exp, zip, token)
    VALUES (${workspaceId}, ${input.brand.slice(0, 40)}, ${input.last4}, ${input.exp.slice(0, 7)}, ${input.zip.slice(0, 16)}, ${token})
    ON CONFLICT (workspace_id) DO UPDATE SET brand = EXCLUDED.brand, last4 = EXCLUDED.last4, exp = EXCLUDED.exp, zip = EXCLUDED.zip, token = EXCLUDED.token`
  return { brand: input.brand, last4: input.last4, exp: input.exp, zip: input.zip }
}

export async function getCard(workspaceId: string) {
  const sql = await ready()
  const rows = await sql`SELECT brand, last4, exp, zip FROM phab_payment_methods WHERE workspace_id = ${workspaceId}`
  return rows[0] as { brand: string; last4: string; exp: string; zip: string } | undefined
}

export async function getCardSecret(workspaceId: string) {
  const sql = await ready()
  const rows = await sql`SELECT brand, last4, exp, zip, token FROM phab_payment_methods WHERE workspace_id = ${workspaceId}`
  return rows[0] as { brand: string; last4: string; exp: string; zip: string; token: string } | undefined
}

export async function executeNode(workspaceId: string, planId: string, nodeId: string) {
  const { runFormation } = await import('./formation')
  const plans = await listPlans(workspaceId)
  const plan = plans.find((entry) => entry.id === planId)
  if (!plan) throw new Error('Plan not found.')
  const node = plan.states.find((entry) => entry.id === nodeId)
  if (!node) throw new Error('State not found.')
  const readyPlan = refreshPlanStatuses(plan)
  const readyNode = readyPlan.states.find((entry) => entry.id === nodeId)!
  if (readyNode.status !== 'ready' && readyNode.status !== 'failed') {
    throw new Error('This state is not ready. Confirm fields and answer blocking questions first.')
  }
  if (readyNode.childPlanId) {
    const child = plans.find((entry) => entry.id === readyNode.childPlanId)
    if (!child || child.states.some((state) => state.status !== 'done')) {
      throw new Error('Open the inner machine and finish every nested state first.')
    }
  }
  if (readyNode.executeHint === 'save-card' || readyNode.executeHint === 'pay-fee') {
    const card = await getCard(workspaceId)
    if (!card) throw new Error('Bind a Northwest payment method before running this state.')
  }

  const card = await getCardSecret(workspaceId)
  const result = await runFormation(readyNode.executeHint ?? '', { plans, node: readyNode, card })
  const produced = result.produced
  const updates = result.fieldUpdates
  if (result.payableId) {
    const existing = await getCard(workspaceId)
    await saveCard(workspaceId, {
      brand: updates.cardBrand ?? existing?.brand ?? 'Card',
      last4: updates.cardLast4 ?? existing?.last4 ?? '',
      exp: existing?.exp ?? '',
      zip: existing?.zip ?? '',
      payableId: result.payableId,
    })
  }

  const applyFields = (entry: PlanNode): PlanNode => ({
    ...entry,
    fields: entry.fields.map((field) => {
      const next = updates[field.key]
      if (!next) return field
      const confirm = field.key === 'cardBrand' || field.key === 'cardLast4' || field.key === 'billingZip'
      return { ...field, value: next, ...(confirm ? { confirmed: true } : {}) }
    }),
  })

  readyNode.documents = [...readyNode.documents, ...produced]
  const nextPlan = {
    ...readyPlan,
    states: readyPlan.states.map((entry) => applyFields(entry.id === nodeId ? readyNode : entry)),
  }
  for (const other of plans) {
    if (other.id === planId) continue
    await writePlan(workspaceId, { ...other, states: other.states.map(applyFields) })
  }
  const written = await writePlan(workspaceId, nextPlan)
  if (result.blocked) {
    throw new Error(result.blocked)
  }
  const done = written.states.find((entry) => entry.id === nodeId)!
  done.status = 'done'
  const saved = await writePlan(workspaceId, { ...written, states: written.states.map((entry) => entry.id === nodeId ? done : entry) })
  return { plan: saved, documents: produced }
}

function slug() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export async function publishPlan(workspaceId: string, planId: string, label: string, description: string) {
  const plans = await listPlans(workspaceId)
  const root = plans.find((plan) => plan.id === planId)
  if (!root) throw new Error('Plan not found.')
  const tree = [root, ...plans.filter((plan) => plan.parentId === root.id || belongsTo(plans, plan, root.id))]
  const sql = await ready()
  let next = root.published?.slug ?? slug()
  for (let attempt = 0; attempt < 6; attempt++) {
    const publication = { slug: next, label, description }
    try {
      await sql`INSERT INTO phab_published_plans (slug, label, description, tree)
        VALUES (${next}, ${label}, ${description}, ${JSON.stringify(tree)}::jsonb)
        ON CONFLICT (slug) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, tree = EXCLUDED.tree`
      const saved = await writePlan(workspaceId, { ...root, published: publication })
      return saved
    } catch {
      next = slug()
    }
  }
  throw new Error('Could not publish this plan.')
}

function belongsTo(plans: Plan[], plan: Plan, rootId: string) {
  let current: Plan | undefined = plan
  const byId = new Map(plans.map((entry) => [entry.id, entry]))
  while (current?.parentId) {
    if (current.parentId === rootId) return true
    current = byId.get(current.parentId)
  }
  return false
}

export async function importPublishedPlan(workspaceId: string, publishedSlug: string) {
  const sql = await ready()
  const rows = await sql`SELECT tree FROM phab_published_plans WHERE slug = ${publishedSlug}`
  const tree = rows[0]?.tree
  if (!Array.isArray(tree) || !tree.length) throw new Error('Published plan not found.')
  const existing = await listPlans(workspaceId)
  if (existing.some((plan) => plan.published?.slug === publishedSlug || tree.some((entry) => (entry as Plan).id === plan.id))) {
    return existing
  }
  const plans = (tree as unknown[]).map((entry) => parsePlan(entry))
  return savePlans(workspaceId, plans)
}

export async function getPublished(publishedSlug: string) {
  const sql = await ready()
  const rows = await sql`SELECT slug, label, description, tree, created_at FROM phab_published_plans WHERE slug = ${publishedSlug}`
  return rows[0]
}
