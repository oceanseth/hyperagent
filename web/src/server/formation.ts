import type { Plan, PlanDocument, PlanNode } from '#/lib/plan'
import { listOperatingAccounts, mercuryConfigured } from './mercury'
import {
  addEin,
  addFormation,
  cart,
  checkout,
  companyEin,
  createCompany,
  filingStatus,
  listPaymentMethods,
  northwestConfigured,
  pullDocuments,
  quoteFormation,
  updateCompany,
  type NorthwestMethod,
} from './northwest'

export type FormationContext = {
  plans: Plan[]
  node: PlanNode
  card?: { brand: string; last4: string; exp: string; zip: string; token?: string }
}

function document(kind: PlanDocument['kind'], title: string, markdown: string): PlanDocument {
  return { id: crypto.randomUUID(), kind, title, markdown, createdAt: new Date().toISOString() }
}

function fields(plans: Plan[]) {
  return plans.flatMap((plan) => plan.states.flatMap((node) => node.fields))
}

function value(plans: Plan[], key: string, fallback = '') {
  return fields(plans).find((field) => field.key === key && field.value?.trim())?.value?.trim() || fallback
}

function requireNorthwest() {
  if (!northwestConfigured()) {
    throw new Error('Northwest is not connected. Set NORTHWEST_ACCESS_TOKEN on the Cloudflare worker before running a live filing.')
  }
}

async function methodFromCard(card: FormationContext['card']): Promise<NorthwestMethod> {
  const methods = await listPaymentMethods()
  const match = methods.find((method) => method.last4 === card?.last4 && (!card?.token || method.payableId === card.token))
    ?? methods.find((method) => method.payableId === card?.token)
  if (!match) {
    throw new Error('No matching Northwest payment method. Save a card in the Northwest portal, then bind last four here.')
  }
  return match
}

async function companyFromPlans(plans: Plan[]) {
  requireNorthwest()
  const name = value(plans, 'companyName')
  if (!name) throw new Error('Confirm the company name before talking to Northwest.')
  const existing = value(plans, 'northwestCompanyId')
  if (existing) return { id: existing, name }
  return createCompany({
    name,
    entityType: value(plans, 'entityType', 'LLC'),
    state: value(plans, 'state', 'Wyoming'),
  })
}

export async function listNorthwestCards() {
  if (!northwestConfigured()) return { connected: false, methods: [] as Awaited<ReturnType<typeof listPaymentMethods>> }
  return { connected: true, methods: await listPaymentMethods() }
}

export async function runFormation(hint: string, context: FormationContext) {
  const { plans, node, card } = context
  const companyName = value(plans, 'companyName', 'Untitled Company')
  const produced: PlanDocument[] = []
  const fieldUpdates: Record<string, string> = {}

  if (!hint) {
    produced.push(document('other', `${companyName} — ${node.name}`, `# ${node.name}\n\nConfirmed. No external filing runs on this state.`))
    return { produced, fieldUpdates }
  }

  if (hint === 'save-card') {
    requireNorthwest()
    const methods = await listPaymentMethods()
    const match = methods.find((method) => method.last4 === card?.last4) ?? methods[0]
    if (!match) throw new Error('Save a card in the Northwest portal first, then run this state.')
    if (card && card.last4 !== match.last4) throw new Error('The bound last four does not match a Northwest payment method.')
    fieldUpdates.cardBrand = match.brand
    fieldUpdates.cardLast4 = match.last4
    produced.push(document('receipt', `${match.brand} •••• ${match.last4} bound`, `# Payment method\n\nNorthwest will charge **${match.brand} •••• ${match.last4}** at checkout. The PAN never touched this app.\n\nPayable type: ${match.type}`))
    return { produced, fieldUpdates, payableId: match.payableId }
  }

  if (hint === 'prepare-packet') {
    const company = await companyFromPlans(plans)
    fieldUpdates.northwestCompanyId = company.id
    const address = value(plans, 'principalAddress')
    const members = value(plans, 'members')
    const organizer = value(plans, 'organizer')
    const updates = [
      ...(address ? [{ name: 'company_principal_address', value: address }] : []),
      ...(members ? [{ name: 'official.member', value: members }] : []),
      ...(organizer ? [{ name: 'official.member', value: organizer }] : []),
    ]
    if (updates.length) await updateCompany(company.id, updates)
    const quote = await quoteFormation(company.id)
    if (quote.price) fieldUpdates.feeAmount = quote.price
    produced.push(document('articles', `Formation packet — ${companyName}`, `# Formation packet\n\n**Company:** ${companyName}\n**Northwest id:** \`${company.id}\`\n**Jurisdiction:** ${value(plans, 'state', 'Wyoming')}\n**Organizer:** ${organizer || 'confirmed'}\n**Members:** ${members || 'confirmed'}\n**Principal address:** ${address || 'on file'}\n**Registered agent:** ${value(plans, 'registeredAgent', 'Northwest Registered Agent')}\n\n## Quote\n\n${quote.summary || 'See Northwest filing options.'}\n\nNothing has been filed yet. Pay the fee to place the order.`))
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'pay-fee') {
    if (!card) throw new Error('Bind a Northwest card before paying the filing fee.')
    const company = await companyFromPlans(plans)
    const method = await methodFromCard(card)
    const quote = await quoteFormation(company.id)
    await addFormation(company.id, quote.methodId)
    const basket = await cart(company.id)
    if (!basket.count) throw new Error('Northwest cart is empty after adding formation. Check the portal and retry.')
    const paid = await checkout(company.id, method, basket.count)
    fieldUpdates.feeAmount = basket.total || quote.price || node.fields.find((field) => field.key === 'feeAmount')?.value || ''
    produced.push(document('receipt', `${companyName} Northwest filing receipt`, `# Filing fee receipt\n\nCharged **${method.brand} •••• ${method.last4}** for ${companyName}.\n\n**Confirmation:** ${paid.confirmation}\n**Cart:** ${basket.total || quote.price || 'see Northwest'}\n\n${paid.summary}`))
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'file-articles') {
    if (node.childPlanId) {
      const child = plans.find((plan) => plan.id === node.childPlanId)
      if (!child || child.states.some((state) => state.status !== 'done')) {
        throw new Error('Open the inner machine and finish packet → pay → submit → stamped copy first.')
      }
      produced.push(document('articles', `${companyName} articles gate`, `# File articles\n\nInner filing machine is complete. Stamped documents are in the child vault.`))
      return { produced, fieldUpdates }
    }
    const company = await companyFromPlans(plans)
    const status = await filingStatus(company.id)
    produced.push(document('articles', `${companyName} filing status`, `# Submit to state\n\n**Company:** ${companyName}\n**Northwest id:** \`${company.id}\`\n**Status:** ${status.status}\n\n${status.summary}`))
    if (!status.complete && !/order|submitted|processing|pending|file/i.test(status.summary)) {
      throw new Error(`Northwest has no filing in progress yet. Pay the fee first. Latest: ${status.status}`)
    }
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'store-articles') {
    const company = await companyFromPlans(plans)
    const status = await filingStatus(company.id)
    if (!status.complete) {
      throw new Error(`Articles are not stamped yet (${status.status}). Run this state again when Northwest shows the filing complete.`)
    }
    const docs = await pullDocuments(company.id)
    if (!docs.length) throw new Error('Filing is marked complete but Northwest returned no readable documents yet. Retry in a moment.')
    for (const entry of docs) {
      produced.push(document('articles', entry.title.includes(companyName) ? entry.title : `${entry.title} — ${companyName}`, `# ${entry.title}\n\n${entry.markdown}`))
    }
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'request-ein') {
    const company = await companyFromPlans(plans)
    const current = await companyEin(company.id)
    if (!current.ein) {
      if (!card) throw new Error('Bind a Northwest card before ordering the EIN.')
      await addEin(company.id)
      const basket = await cart(company.id)
      if (basket.count) await checkout(company.id, await methodFromCard(card), basket.count)
    }
    const latest = await companyEin(company.id)
    if (!latest.ein) {
      throw new Error(`EIN is not on file yet${latest.pending ? ' (Northwest reports it pending)' : ''}. Finish any responsible-party identity step in the Northwest portal, then run this state again.\n\n${latest.summary}`)
    }
    fieldUpdates.ein = latest.ein
    produced.push(document('ein', `EIN confirmation — ${companyName}`, `# EIN Assignment\n\n**Legal name:** ${companyName}\n**EIN:** ${latest.ein}\n**Responsible party:** ${value(plans, 'responsibleParty', value(plans, 'organizer'))}\n\n${latest.summary}`))
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'open-bank') {
    const packet = [
      `**Company:** ${companyName}`,
      `**EIN:** ${value(plans, 'ein') || 'not in vault yet'}`,
      `**State:** ${value(plans, 'state', 'Wyoming')}`,
      `**Organizer:** ${value(plans, 'organizer')}`,
      `**Address:** ${value(plans, 'principalAddress')}`,
    ].join('\n')
    produced.push(document('bank', `${companyName} Mercury application packet`, `# Mercury application packet\n\n${packet}\n\nMercury's public API lists existing accounts; it cannot open a new one ([docs](https://docs.mercury.com/docs/welcome)). Apply at https://mercury.com, then bind \`MERCURY_API_TOKEN\` and run this state again.`))
    if (!mercuryConfigured()) {
      return { produced, fieldUpdates, blocked: 'Application packet is in the vault. Mercury cannot open an account through their public API. Finish KYC at https://mercury.com, add MERCURY_API_TOKEN, then run this state again.' }
    }
    const accounts = await listOperatingAccounts(companyName)
    const account = accounts[0]
    if (!account) {
      return { produced, fieldUpdates, blocked: 'Mercury is connected but has no operating account yet. Finish KYC, then run this state again.' }
    }
    fieldUpdates.bankLast4 = account.last4
    produced.push(document('bank', `${account.name} •••• ${account.last4}`, `# Operating account\n\n**Company:** ${companyName}\n**Bank:** Mercury\n**Account:** •••• ${account.last4}\n${account.routingLast4 ? `**Routing last four:** ${account.routingLast4}\n` : ''}\nPulled live from Mercury. Full account and routing numbers stay at the bank.`))
    return { produced, fieldUpdates }
  }

  if (hint === 'draft-safe') {
    const cap = value(plans, 'valuationCap', node.fields.find((field) => field.key === 'valuationCap')?.value ?? '$10,000,000')
    const discount = value(plans, 'discount', node.fields.find((field) => field.key === 'discount')?.value ?? '20%')
    produced.push(document('safe', `Post-money SAFE terms — ${companyName}`, `# Post-Money SAFE (working instrument)\n\n**Company:** ${companyName}\n**Form:** Y Combinator post-money SAFE structure (use the official YC form for signature)\n**Valuation cap:** ${cap}\n**Discount:** ${discount}\n**Purchase amount:** to be filled per investor\n**Governing law:** ${value(plans, 'state', 'Wyoming')}\n\nThis is the economic term sheet later conversations reuse. It is not a signed investor document until a human executes the official form.\n\nOfficial form: https://www.ycombinator.com/documents`))
    return { produced, fieldUpdates }
  }

  if (hint === 'open-vault') {
    const vault = plans.flatMap((plan) => plan.states.flatMap((entry) => entry.documents))
    produced.push(document('other', `${companyName} vault index`, `# Company vault\n\n${vault.length ? vault.map((entry) => `- ${entry.title}`).join('\n') : '- Empty. Execute earlier states to file documents here.'}`))
    return { produced, fieldUpdates }
  }

  throw new Error(`No live executor for "${hint || node.name}".`)
}
