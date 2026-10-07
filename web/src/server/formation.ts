import { bankProfile, lastFour } from '#/lib/bank-profile'
import type { Plan, PlanDocument, PlanNode } from '#/lib/plan'
import { listOperatingAccounts, mercuryConfigured } from './mercury'
import { lookupRequirements, recordMonidActivity, type MonidNote } from './monid'
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
  workspaceId?: string
  monidKey?: string
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

function usesNorthwest(plans: Plan[]) {
  return /northwest/i.test(value(plans, 'formationProvider', 'Northwest')) && !usesAtlas(plans)
}

function usesAtlas(plans: Plan[]) {
  return /atlas|stripe/i.test(value(plans, 'formationProvider', ''))
}

function requireNorthwest() {
  if (!northwestConfigured()) {
    throw new Error('Northwest is not connected. Set NORTHWEST_ACCESS_TOKEN on the Cloudflare worker, or change Filing provider and finish the filing yourself.')
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

async function attachMonid(produced: PlanDocument[], plans: Plan[], context: FormationContext) {
  const state = value(plans, 'state', 'Wyoming')
  const entityType = value(plans, 'entityType', 'LLC')
  const companyName = value(plans, 'companyName', 'Untitled Company')
  const bank = value(plans, 'bankName')
  const query = `${state} ${entityType} secretary of state filing requirements and fees, and ${bank || 'US business'} bank account requirements`
  const key = context.monidKey?.trim()
  const note: MonidNote = key
    ? await lookupRequirements(key, { companyName, state, entityType, query }).catch((error: unknown) => ({
      ok: false,
      events: [{ type: 'failed', message: error instanceof Error ? error.message : 'Monid request failed', tool: 'monid' }],
      markdown: '## Live requirements\n\nMonid did not respond. The packet above is still the local formation packet.',
    }))
    : {
      ok: false,
      events: [{ type: 'failed', message: 'MONID_API_KEY is not set for this workspace.', tool: 'monid' }],
      markdown: '## Live requirements\n\nNo Monid key on this workspace. Add one under Settings → API keys, or set `MONID_API_KEY` on the service.',
    }
  if (produced[0]) produced[0] = { ...produced[0], markdown: `${produced[0].markdown}\n\n${note.markdown}` }
  if (context.workspaceId) await recordMonidActivity(context.workspaceId, query, note).catch(() => undefined)
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
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      const last4 = lastFour(card?.last4 || value(plans, 'cardLast4'))
      if (!last4) throw new Error('Enter the last four of the card you will use to pay filing fees.')
      fieldUpdates.cardBrand = card?.brand || value(plans, 'cardBrand', 'Card')
      fieldUpdates.cardLast4 = last4
      produced.push(document('receipt', `${fieldUpdates.cardBrand} •••• ${last4} noted`, `# Payment method\n\nNo filing portal is connected. **${fieldUpdates.cardBrand} •••• ${last4}** is the card you will charge on ${value(plans, 'formationProvider', 'the filing site')} yourself. The PAN never touched this app.`))
      return { produced, fieldUpdates }
    }
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
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      const atlas = usesAtlas(plans)
      produced.push(document('articles', `Formation packet — ${companyName}`, `# Formation packet\n\n**Company:** ${companyName}\n**Provider:** ${value(plans, 'formationProvider', 'self-file')}\n**Jurisdiction:** ${value(plans, 'state', atlas ? 'Delaware' : 'Wyoming')}\n**Organizer:** ${value(plans, 'organizer') || 'confirmed'}\n**Members:** ${value(plans, 'members') || 'confirmed'}\n**Principal address:** ${value(plans, 'principalAddress') || 'on file'}\n**Registered agent:** ${value(plans, 'registeredAgent') || (atlas ? 'Stripe Atlas RA' : 'required — Wyoming needs an in-state RA')}\n\n${atlas
        ? 'Stripe Atlas has no public form-an-LLC API. After you confirm this packet, Phab can open https://atlas.stripe.com in a KERNEL browser so you finish the Delaware filing there. Paste the real confirmation on Submit to state.\n\nAtlas: https://atlas.stripe.com'
        : 'Northwest is not in this path. File on wyobiz or the RA you chose, then confirm the filing id on Submit to state.\n\nWyoming e-file: https://wyobiz.wyo.gov'}`))
      await attachMonid(produced, plans, context)
      return { produced, fieldUpdates }
    }
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
    await attachMonid(produced, plans, context)
    return { produced, fieldUpdates, northwestCompanyId: company.id }
  }

  if (hint === 'pay-fee') {
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      produced.push(document('receipt', `${companyName} filing fee`, `# Filing fee\n\n**Provider:** ${value(plans, 'formationProvider', 'self-file')}\n**Card noted:** ${value(plans, 'cardBrand', 'Card')} •••• ${value(plans, 'cardLast4', '????')}\n\nNorthwest checkout was skipped. Confirm you paid the Secretary of State or other RA, then submit.`))
      return { produced, fieldUpdates }
    }
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
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      const confirmation = value(plans, 'filingConfirmation')
      if (!confirmation) {
        throw new Error('Northwest is not in this path. Finish the filing on wyobiz or another RA, then paste the real filing confirmation / id into this state.')
      }
      produced.push(document('articles', `${companyName} filing confirmation`, `# Submit to state\n\n**Company:** ${companyName}\n**Provider:** ${value(plans, 'formationProvider', 'self-file')}\n**Confirmation:** ${confirmation}\n\nRecorded from the human-completed filing. Nothing was invented.`))
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
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      const confirmation = value(plans, 'filingConfirmation')
      if (!confirmation) {
        throw new Error('No stamped copy yet. Paste the filing confirmation / id after the Secretary of State or RA finishes.')
      }
      produced.push(document('articles', `${companyName} stamped articles`, `# Stamped copy\n\n**Company:** ${companyName}\n**Provider:** ${value(plans, 'formationProvider', 'self-file')}\n**Confirmation:** ${confirmation}\n\nVaulted from the completed filing. Later states (EIN, bank) can reuse this.`))
      return { produced, fieldUpdates }
    }
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
    const existingEin = value(plans, 'ein')
    if ((!usesNorthwest(plans) || !northwestConfigured()) && existingEin) {
      fieldUpdates.ein = existingEin
      produced.push(document('ein', `EIN confirmation — ${companyName}`, `# EIN Assignment\n\n**Legal name:** ${companyName}\n**EIN:** ${existingEin}\n**Responsible party:** ${value(plans, 'responsibleParty', value(plans, 'organizer'))}\n\nConfirmed by the human. Northwest was not used for this EIN.`))
      return { produced, fieldUpdates }
    }
    if (!usesNorthwest(plans) || !northwestConfigured()) {
      throw new Error('Northwest is not in this path. File the EIN with the IRS, then confirm the EIN field on this state and run it again.')
    }
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

  if (hint === 'choose-bank') {
    const profile = bankProfile(value(plans, 'bankName'))
    if (profile.key === 'other' && !value(plans, 'bankName')) {
      throw new Error('Name the bank first — Novo, Mercury, or another.')
    }
    fieldUpdates.bankName = profile.name
    fieldUpdates.bankApiNeeded = profile.canListViaApi
      ? `${profile.apiTokenEnv} after the account exists (lists last four; cannot open)`
      : 'None. This bank has no public open/list API.'
    produced.push(document('bank', `${companyName} → ${profile.name}`, `# ${profile.name}\n\n**Can the agent open an account via API?** No.\n**Can the agent list an existing account?** ${profile.canListViaApi ? `Yes, with \`${profile.apiTokenEnv}\`` : 'No.'}\n**Apply:** ${profile.applyUrl || 'ask the human for this bank\'s signup URL'}\n\n## What ${profile.name} will ask\n\n${profile.needs.map((item) => `- ${item}`).join('\n')}`))
    return { produced, fieldUpdates }
  }

  if (hint === 'collect-bank-needs') {
    const profile = bankProfile(value(plans, 'bankName'))
    const have = /^(y|yes|true|already)/i.test(value(plans, 'alreadyHaveAccount', 'no'))
    const missing = [
      !value(plans, 'ein') && 'EIN is not in the vault yet',
      !plans.some((plan) => plan.states.some((entry) => entry.documents.some((doc) => doc.kind === 'articles'))) && 'Stamped articles are not in the vault yet',
      !value(plans, 'organizer') && 'Organizer / control person is unconfirmed',
      !value(plans, 'principalAddress') && 'Business address is unconfirmed',
    ].filter(Boolean)
    produced.push(document('bank', `${profile.name} KYC packet — ${companyName}`, `# ${profile.name} application packet\n\n**Company:** ${companyName}\n**EIN:** ${value(plans, 'ein') || 'missing'}\n**State:** ${value(plans, 'state', 'Wyoming')}\n**Organizer:** ${value(plans, 'organizer') || 'missing'}\n**Members:** ${value(plans, 'members') || 'missing'}\n**Address:** ${value(plans, 'principalAddress') || 'missing'}\n**Already have an account?** ${have ? 'Yes — next we bind last four' : 'No — next we apply'}\n**API:** ${value(plans, 'bankApiNeeded') || (profile.canListViaApi ? profile.apiTokenEnv : 'none')}\n\n## Bank checklist\n\n${profile.needs.map((item) => `- ${item}`).join('\n')}\n\n${missing.length ? `## Still blocking\n\n${missing.map((item) => `- ${item}`).join('\n')}` : 'Packet has the fields this canvas can collect. Identity (SSN/ID) stays in the bank portal.'}`))
    return { produced, fieldUpdates }
  }

  if (hint === 'open-bank') {
    if (node.childPlanId) {
      const child = plans.find((plan) => plan.id === node.childPlanId)
      if (!child || child.states.some((state) => state.status !== 'done')) {
        throw new Error('Open the inner bank machine and finish choose → needs → apply → bind first.')
      }
      produced.push(document('bank', `${companyName} bank gate`, `# Bank account\n\nInner bank machine is complete. Last four is in the child vault.`))
      return { produced, fieldUpdates }
    }
    const profile = bankProfile(value(plans, 'bankName'))
    const have = /^(y|yes|true|already)/i.test(value(plans, 'alreadyHaveAccount', 'no'))
    const bound = lastFour(value(plans, 'bankLast4'))
    const packet = [
      `**Company:** ${companyName}`,
      `**Bank:** ${profile.name}`,
      `**EIN:** ${value(plans, 'ein') || 'not in vault yet'}`,
      `**State:** ${value(plans, 'state', 'Wyoming')}`,
      `**Organizer:** ${value(plans, 'organizer')}`,
      `**Address:** ${value(plans, 'principalAddress')}`,
    ].join('\n')
    produced.push(document('bank', `${companyName} ${profile.name} application packet`, `# ${profile.name} application packet\n\n${packet}\n\nNo US bank lets this agent open an account through an API. ${profile.applyUrl ? `Apply at ${profile.applyUrl}.` : 'Use this bank\'s own signup.'}`))
    if (have && bound) {
      fieldUpdates.bankLast4 = bound
      fieldUpdates.bankName = profile.name
      produced.push(document('bank', `${profile.name} •••• ${bound}`, `# Operating account\n\n**Company:** ${companyName}\n**Bank:** ${profile.name}\n**Account:** •••• ${bound}\n\nBound from a confirmed last four. Full account and routing numbers stay at the bank.`))
      return { produced, fieldUpdates }
    }
    if (profile.key === 'mercury' && mercuryConfigured()) {
      const accounts = await listOperatingAccounts(companyName)
      const account = accounts[0]
      if (account) {
        fieldUpdates.bankLast4 = account.last4
        fieldUpdates.bankName = 'Mercury'
        produced.push(document('bank', `${account.name} •••• ${account.last4}`, `# Operating account\n\n**Company:** ${companyName}\n**Bank:** Mercury\n**Account:** •••• ${account.last4}\n${account.routingLast4 ? `**Routing last four:** ${account.routingLast4}\n` : ''}\nPulled live from Mercury. Full account and routing numbers stay at the bank.`))
        return { produced, fieldUpdates }
      }
    }
    if (have && !bound) {
      return { produced, fieldUpdates, blocked: `You said the ${profile.name} account already exists. Confirm the last four (or add MERCURY_API_TOKEN if this is Mercury), then run this state again.` }
    }
    produced.push(document('bank', `Apply at ${profile.name}`, `# Next step\n\n${profile.name} cannot open an account through an API. Finish KYC at ${profile.applyUrl || 'this bank\'s signup'}, then confirm the last four on Bind last four.`))
    return { produced, fieldUpdates }
  }

  if (hint === 'bind-bank') {
    const profile = bankProfile(value(plans, 'bankName'))
    let bound = lastFour(value(plans, 'bankLast4'))
    if (!bound && profile.key === 'mercury' && mercuryConfigured()) {
      const account = (await listOperatingAccounts(companyName))[0]
      if (account) bound = account.last4
    }
    if (!bound) throw new Error(`Confirm the last four of the ${profile.name} account. Do not paste the full number.`)
    fieldUpdates.bankLast4 = bound
    fieldUpdates.bankName = profile.name
    produced.push(document('bank', `${profile.name} •••• ${bound}`, `# Operating account\n\n**Company:** ${companyName}\n**Bank:** ${profile.name}\n**Account:** •••• ${bound}\n\nBound. Full account and routing numbers stay at the bank.`))
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
