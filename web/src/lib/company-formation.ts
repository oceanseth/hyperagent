import { bankProfile } from './bank-profile'
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

function guessed(guesses: Guess[], key: string, fallback: string) {
  return guesses.find((entry) => entry.key === key)?.value ?? fallback
}

export function companyFormationPlan(name: string, guesses: Guess[] = []): { plans: Plan[] } {
  const bank = bankProfile(guessed(guesses, 'bankName', ''))

  const people = node(
    'People & addresses',
    `## People & addresses
Identify organizers, members, and a registered agent. Confirm every address before anything is filed.
Wyoming still needs a physical in-state registered agent even if you skip Northwest.`,
    [
      field('organizer', 'Organizer / founder', guesses),
      field('members', 'Members / ownership', guesses),
      field('registeredAgent', 'Registered agent', guesses, { value: guessed(guesses, 'registeredAgent', 'Northwest Registered Agent'), guessed: true }),
      field('principalAddress', 'Principal address', guesses),
    ],
    [question('Who should be listed as the organizer on the articles?'), question('What is the principal business address?')],
  )

  const payment = node(
    'Payment method',
    `## Payment method
If the filing provider is Northwest, checkout charges a card already saved in that portal (last four + payable id only).
If you self-file on wyobiz or another RA, bind the last four of the card you will use there. This app never stores a PAN.`,
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
Assemble the articles of organization from confirmed name, members, agent, and addresses.
Northwest is used when connected; otherwise this writes a local packet you can file on wyobiz or another RA.
Monid looks up the live filing and bank requirements and writes them onto this packet.`,
    [field('packetReady', 'Packet reviewed', guesses, { required: false, confirmed: false })],
    [question('Does the packet match the confirmed company details?')],
    'prepare-packet',
  )
  const payFee = node(
    'Pay filing fee',
    `## Pay filing fee
Charge the bound card through Northwest when that provider is connected. Otherwise confirm you paid the Secretary of State or other RA yourself.`,
    [field('feeAmount', 'Filing fee', guesses, { required: false })],
    [question('Confirm the filing fee may be charged (Northwest checkout) or that you paid it yourself.')],
    'pay-fee',
  )
  const submit = node(
    'Submit to state',
    `## Submit to state
Submit through Northwest when connected. Self-file path: finish wyobiz (or the other RA) and paste the real filing confirmation.`,
    [
      field('jurisdiction', 'Filing jurisdiction', guesses, { value: guessed(guesses, 'state', 'Wyoming'), guessed: true }),
      field('filingConfirmation', 'Filing confirmation / id', guesses, { required: false }),
    ],
    [question('File with this jurisdiction now, or paste the confirmation if you already filed?')],
    'file-articles',
  )
  const stamped = node(
    'Receive stamped copy',
    `## Receive stamped copy
Pull stamped articles from Northwest when connected. Otherwise paste the stamped confirmation so later states (EIN, bank) can reuse it.`,
    [field('filingConfirmation', 'Filing confirmation / id', guesses, { required: false })],
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

  const chooseBank = node(
    'Choose bank',
    `## Choose bank
Ask which bank should hold the operating account. Novo, Mercury, and any other name are valid.
No US bank lets this agent open an account through an API. The next states collect what that bank needs, then open or bind.`,
    [field('bankName', 'Bank', guesses, { value: guessed(guesses, 'bankName', bank.name === 'unspecified bank' ? '' : bank.name) || undefined })],
    [question('Which bank should hold the operating account — Novo, Mercury, or another?')],
    'choose-bank',
  )
  const bankNeeds = node(
    'What the bank needs',
    `## What the bank needs
The agent asks for everything this bank requires before an application can start: EIN, stamped articles, owners, and whether an API token is useful after the account exists.
Do not type SSN, full account numbers, or routing numbers onto a shareable canvas.`,
    [
      field('alreadyHaveAccount', 'Already have this account?', guesses, { value: guessed(guesses, 'alreadyHaveAccount', 'no'), guessed: true }),
      field('bankApiNeeded', 'API needed after the account exists', guesses, { required: false }),
    ],
    [
      question('Do you already have this business account, or should we open one during the demo?'),
      question('Who are the beneficial owners and control person the bank will ask for?'),
    ],
    'collect-bank-needs',
  )
  const openBank = node(
    'Open or apply',
    `## Open or apply
Prepare the application packet from the vault. If the bank has a list API and a token is on the worker, pull the real last four after KYC.
Otherwise walk the human through that bank's signup and wait — never invent account numbers.`,
    [],
    [question('Ready to apply / open at this bank with the packet we assembled?')],
    'open-bank',
  )
  const bindBank = node(
    'Bind last four',
    `## Bind last four
After the account exists, store last four only. Full account and routing numbers stay at the bank.`,
    [field('bankLast4', 'Account last four', guesses, { required: false, secret: true })],
    [question('Confirm the last four of the operating account. Do not paste the full number.')],
    'bind-bank',
  )
  const bankStates = [chooseBank, bankNeeds, openBank, bindBank]
  const banking = stamp({
    id: crypto.randomUUID(),
    name: 'Bank account',
    description: 'Ask which bank, collect what it needs, then open or bind a real operating account.',
    template: 'open-bank',
    states: bankStates,
    edges: chain(bankStates),
  })

  const identity = node(
    'Name & structure',
    `## Name & structure
Guessed from the conversation. Confirm the legal name, entity type, and who files.
Northwest is the default filing provider because it can file + RA + EIN from the canvas. Stripe Atlas is a Delaware website with no public formation API — store the Atlas/Stripe key here, then KERNEL opens the Atlas portal after you confirm. wyobiz or another RA works if you confirm the stamped result.`,
    [
      field('companyName', 'Company name', guesses),
      field('entityType', 'Entity type', guesses, { value: guessed(guesses, 'entityType', 'LLC'), guessed: true }),
      field('state', 'Home state', guesses, { value: guessed(guesses, 'state', 'Wyoming'), guessed: true }),
      field('formationProvider', 'Filing provider', guesses, { value: guessed(guesses, 'formationProvider', 'Northwest Registered Agent'), guessed: true }),
      field('northwestCompanyId', 'Northwest company id', guesses, { required: false, secret: true }),
      field('stripeAtlasKey', 'Stripe / Atlas key', guesses, { required: false, secret: true, setting: 'stripe' }),
    ],
    [question('Is this the exact legal name you want reserved and filed?'), question('Who files — Northwest, Stripe Atlas, wyobiz self-file, or another RA?')],
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
Order the EIN through Northwest after articles are on file when that provider is connected.
Otherwise confirm the EIN you received from the IRS and store it in the vault.`,
    [field('responsibleParty', 'Responsible party', guesses), field('ein', 'EIN', guesses, { required: false })],
    [question('Who is the responsible party on the EIN application?')],
    'request-ein',
  )
  const bankNode = node(
    'Bank account',
    `## Bank account
Outer gate for the nested bank machine: choose bank → what it needs → open or apply → bind last four.`,
    [
      field('bankName', 'Bank', guesses, { value: guessed(guesses, 'bankName', '') || undefined, required: false }),
      field('bankLast4', 'Account last four', guesses, { required: false, secret: true }),
    ],
    [question('Open the operating account at this bank?')],
    'open-bank',
  )
  bankNode.childPlanId = banking.id

  const safe = node(
    'SAFE / investor docs',
    `## SAFE
Draft a post-money SAFE so a future investor conversation can reuse the same terms.`,
    [
      field('valuationCap', 'Valuation cap', guesses, { value: guessed(guesses, 'valuationCap', '$10,000,000'), guessed: true }),
      field('discount', 'Discount', guesses, { value: guessed(guesses, 'discount', '20%'), guessed: true }),
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

  const rootStates = [identity, people, payment, fileArticles, ein, bankNode, safe, vault]
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
      { from: ein.id, to: bankNode.id },
      { from: bankNode.id, to: safe.id },
      { from: safe.id, to: vault.id },
    ],
  })
  filing.parentId = root.id
  filing.parentNodeId = fileArticles.id
  banking.parentId = root.id
  banking.parentNodeId = bankNode.id
  return { plans: [root, filing, banking] }
}

export const guessKeys = [
  'companyName', 'entityType', 'state', 'formationProvider', 'organizer', 'members', 'registeredAgent',
  'principalAddress', 'cardBrand', 'cardLast4', 'billingZip', 'feeAmount', 'stripeAtlasKey',
  'responsibleParty', 'bankName', 'alreadyHaveAccount', 'bankApiNeeded', 'valuationCap', 'discount',
] as const
