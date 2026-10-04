import { refreshPlanStatuses, type Plan, type PlanField, type PlanNode, type PlanQuestion } from './plan'

type Guess = { key: string; value: string }

function field(key: string, label: string, guesses: Guess[], extra: Partial<PlanField> = {}): PlanField {
  const guessed = guesses.find((entry) => entry.key === key)?.value
  return {
    key, label, required: true, confirmed: false, guessed: Boolean(guessed), secret: false,
    ...(guessed ? { value: guessed } : {}),
    ...extra,
  }
}

function question(text: string): PlanQuestion {
  return { id: crypto.randomUUID(), text, blocking: true }
}

function node(name: string, context: string, fields: PlanField[], questions: PlanQuestion[], executeHint?: string): PlanNode {
  return {
    id: crypto.randomUUID(),
    name, context, fields, questions,
    status: 'pending',
    documents: [],
    ...(executeHint ? { executeHint } : {}),
  }
}

function chain(states: PlanNode[]) {
  return states.slice(1).map((state, index) => ({ from: states[index].id, to: state.id }))
}

function stamp(plan: Omit<Plan, 'createdAt' | 'updatedAt' | 'states' | 'edges'> & { states: PlanNode[]; edges: Plan['edges'] }): Plan {
  const now = new Date().toISOString()
  return refreshPlanStatuses({ ...plan, createdAt: now, updatedAt: now })
}

export function companyFormationPlan(name: string, guesses: Guess[] = []): { plans: Plan[] } {
  const people = node(
    'People & addresses',
    `## People & addresses
Identify organizers, members, and a registered agent. Confirm every address before anything is filed.`,
    [
      field('organizer', 'Organizer / founder', guesses),
      field('members', 'Members / ownership', guesses),
      field('registeredAgent', 'Registered agent', guesses, { value: guesses.find((g) => g.key === 'registeredAgent')?.value ?? 'Northwest Registered Agent', guessed: true }),
      field('principalAddress', 'Principal address', guesses),
    ],
    [question('Who should be listed as the organizer on the articles?'), question('What is the principal business address?')],
  )

  const payment = node(
    'Payment method',
    `## Payment method
Checkout charges a card already saved in the Northwest portal. This app stores last four and a payable id — never the PAN.`,
    [
      field('cardBrand', 'Card brand', guesses, { secret: true }),
      field('cardLast4', 'Card last four', guesses, { secret: true }),
      field('billingZip', 'Billing ZIP', guesses, { required: false }),
    ],
    [question('Which card should pay formation fees?')],
    'save-card',
  )

  const packet = node(
    'Prepare packet',
    `## Prepare packet
Assemble the articles of organization from confirmed name, members, agent, and addresses.`,
    [field('packetReady', 'Packet reviewed', guesses, { required: false, confirmed: false })],
    [question('Does the packet match the confirmed company details?')],
    'prepare-packet',
  )
  const payFee = node(
    'Pay filing fee',
    `## Pay filing fee
Charge the Northwest card for the real formation package. Blocked until the card is bound.`,
    [field('feeAmount', 'Filing fee', guesses, { required: false })],
    [question('Confirm Northwest may charge the bound card for the quoted formation fee.')],
    'pay-fee',
  )
  const submit = node(
    'Submit to state',
    `## Submit to state
Submit the paid Northwest order and track the Secretary of State filing.`,
    [field('jurisdiction', 'Filing jurisdiction', guesses, { value: guesses.find((g) => g.key === 'state')?.value ?? 'Wyoming', guessed: true })],
    [question('File with this jurisdiction now?')],
    'file-articles',
  )
  const stamped = node(
    'Receive stamped copy',
    `## Receive stamped copy
Pull the stamped articles from Northwest into the company vault. Refuses until the filing is complete.`,
    [],
    [],
    'store-articles',
  )
  const filingStates = [packet, payFee, submit, stamped]
  const filing = stamp({
    id: crypto.randomUUID(),
    name: 'File articles',
    description: 'Inner machine for preparing, paying, filing, and storing articles of organization.',
    template: 'file-articles',
    states: filingStates,
    edges: chain(filingStates),
  })

  const identity = node(
    'Name & structure',
    `## Name & structure
Guessed from the conversation. Confirm the legal name and entity type before any filing.`,
    [
      field('companyName', 'Company name', guesses),
      field('entityType', 'Entity type', guesses, { value: guesses.find((g) => g.key === 'entityType')?.value ?? 'LLC', guessed: true }),
      field('state', 'Home state', guesses, { value: guesses.find((g) => g.key === 'state')?.value ?? 'Wyoming', guessed: true }),
      field('northwestCompanyId', 'Northwest company id', guesses, { required: false, secret: true }),
    ],
    [question('Is this the exact legal name you want reserved and filed?')],
  )

  const fileArticles = node(
    'File articles',
    `## File articles
Outer gate for the nested filing machine. Opens the inner packet → pay → submit → stamped-copy graph.`,
    [],
    [question('Proceed to file articles once people, name, and payment are confirmed?')],
    'file-articles',
  )
  fileArticles.childPlanId = filing.id

  const ein = node(
    'EIN',
    `## EIN
Order the EIN through Northwest after articles are on file. Refuses until Northwest has a real EIN.`,
    [field('responsibleParty', 'Responsible party', guesses), field('ein', 'EIN', guesses, { required: false })],
    [question('Who is the responsible party on the EIN application?')],
    'request-ein',
  )
  const bank = node(
    'Bank account',
    `## Bank account
Build the Mercury application packet from vault documents. Pull a real account only after Mercury KYC exists — never invent numbers.`,
    [field('bankName', 'Bank', guesses, { value: guesses.find((g) => g.key === 'bankName')?.value ?? 'Mercury', guessed: true }), field('bankLast4', 'Account last four', guesses, { required: false, secret: true })],
    [question('Open the operating account at this bank?')],
    'open-bank',
  )
  const safe = node(
    'SAFE / investor docs',
    `## SAFE
Draft a post-money SAFE so a future investor conversation can reuse the same terms.`,
    [
      field('valuationCap', 'Valuation cap', guesses, { value: guesses.find((g) => g.key === 'valuationCap')?.value ?? '$10,000,000', guessed: true }),
      field('discount', 'Discount', guesses, { value: guesses.find((g) => g.key === 'discount')?.value ?? '20%', guessed: true }),
    ],
    [question('Are the cap and discount right for the first SAFE?')],
    'draft-safe',
  )
  const vault = node(
    'Company vault',
    `## Company vault
Every produced document lands here. Later conversations can reference and revise these files.`,
    [],
    [],
    'open-vault',
  )

  const rootStates = [identity, people, payment, fileArticles, ein, bank, safe, vault]
  const root = stamp({
    id: crypto.randomUUID(),
    name,
    description: 'Form the company, collect confirmations, file, and store the resulting documents.',
    template: 'company-formation',
    states: rootStates,
    edges: [
      { from: identity.id, to: people.id },
      { from: people.id, to: payment.id },
      { from: payment.id, to: fileArticles.id },
      { from: fileArticles.id, to: ein.id },
      { from: ein.id, to: bank.id },
      { from: bank.id, to: safe.id },
      { from: safe.id, to: vault.id },
    ],
  })
  filing.parentId = root.id
  filing.parentNodeId = fileArticles.id
  return { plans: [root, filing] }
}

export const guessKeys = [
  'companyName', 'entityType', 'state', 'organizer', 'members', 'registeredAgent',
  'principalAddress', 'cardBrand', 'cardLast4', 'billingZip', 'feeAmount',
  'responsibleParty', 'bankName', 'valuationCap', 'discount',
] as const
