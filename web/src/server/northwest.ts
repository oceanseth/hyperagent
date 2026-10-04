import { MCPClient } from '@mastra/mcp'

export type NorthwestMethod = {
  payableId: string
  type: 'card' | 'automatedClearingHouse'
  brand: string
  last4: string
  exp: string
}

type ToolLike = {
  id: string
  execute?: (input: Record<string, unknown>, context?: unknown) => Promise<unknown>
}

const DEFAULT_URL = 'https://mcp.northwestregisteredagent.com'

export function northwestConfigured() {
  return Boolean(process.env.NORTHWEST_ACCESS_TOKEN?.trim())
}

function createClient(signal?: AbortSignal) {
  const key = process.env.NORTHWEST_ACCESS_TOKEN?.trim()
  if (!key) return null
  const endpoint = process.env.NORTHWEST_MCP_URL?.trim() || DEFAULT_URL
  let url: URL
  try { url = new URL(endpoint) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return new MCPClient({
    id: `phab-nw-${crypto.randomUUID()}`,
    servers: {
      northwest: {
        url,
        allowedHosts: [url.host],
        enableServerLogs: false,
        onToolError: 'return',
        connectTimeout: 15_000,
        timeout: 60_000,
        fetch: async (input, init) => {
          const target = new URL(input)
          if (target.origin !== url.origin) throw new Error('Northwest requested an unsupported connection.')
          const headers = new Headers(init?.headers)
          headers.set('Authorization', /^Bearer\s/i.test(key) ? key : `Bearer ${key}`)
          const signals = [signal, init?.signal, AbortSignal.timeout(60_000)].filter((value): value is AbortSignal => Boolean(value))
          const response = await fetch(input, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) })
          if (!response.ok) return new Response('Northwest request failed.', { status: response.status })
          return response
        },
      },
    },
  })
}

function collectText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(collectText).join('\n')
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (Array.isArray(record.content)) return collectText(record.content)
  try { return JSON.stringify(value) } catch { return '' }
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  const record = value as Record<string, unknown>
  visit(record)
  for (const child of Object.values(record)) walk(child, visit)
}

function findString(value: unknown, keys: string[]) {
  let found: string | undefined
  walk(value, (record) => {
    if (found) return
    for (const key of keys) {
      const hit = record[key]
      if (typeof hit === 'string' && hit.trim()) found = hit.trim()
    }
  })
  return found
}

function parseJsonish(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return text
  try { return JSON.parse(trimmed) as unknown } catch { return text }
}

async function call(name: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  const client = createClient(signal)
  if (!client) throw new Error('Northwest is not connected. Set NORTHWEST_ACCESS_TOKEN on the Cloudflare worker.')
  try {
    const discovery = await client.listToolsetsWithErrors({ perServerTimeoutMs: 20_000 })
    const tools = Object.values(discovery.toolsets).flatMap((set) => Object.values(set as Record<string, ToolLike>))
    const tool = tools.find((entry) => entry.id === name || entry.id.endsWith(`.${name}`) || entry.id.endsWith(name))
    if (!tool?.execute) throw new Error(`Northwest tool ${name} is not available on this account.`)
    const result = await tool.execute(input)
    if (result && typeof result === 'object' && 'isError' in result && (result as { isError?: boolean }).isError) {
      throw new Error(collectText(result).slice(0, 400) || 'Northwest tool failed.')
    }
    const text = collectText(result)
    return { raw: result, text, data: parseJsonish(text) }
  } catch (error) {
    if (error instanceof Error && /not connected|not available/i.test(error.message)) throw error
    throw new Error(error instanceof Error ? error.message.slice(0, 400) : 'Northwest request failed.')
  }
}

export async function listPaymentMethods(signal?: AbortSignal): Promise<NorthwestMethod[]> {
  const result = await call('get_payment_methods_tool', { limit: 25 }, signal)
  const methods: NorthwestMethod[] = []
  walk(result.data, (record) => {
    const last4 = String(record.last4 ?? record.last_4 ?? record.card_last4 ?? '').replace(/\D/g, '')
    const payableId = String(record.payable_id ?? record.payableId ?? record.id ?? record.payment_method_id ?? '')
    if (last4.length !== 4 || !payableId || methods.some((method) => method.payableId === payableId)) return
    const type = String(record.payable_type ?? record.type ?? 'card').includes('ach') || String(record.payable_type ?? '').includes('Clearing')
      ? 'automatedClearingHouse' as const
      : 'card' as const
    methods.push({
      payableId,
      type,
      brand: String(record.brand ?? record.card_brand ?? record.name ?? 'Card').slice(0, 40),
      last4,
      exp: String(record.exp ?? record.expiry ?? record.expiration ?? ''),
    })
  })
  return methods
}

export async function findCompany(name: string, signal?: AbortSignal) {
  const result = await call('get_companies_tool', { name, page: { number: 0, size: 25 } }, signal)
  let match: { id: string; name: string } | undefined
  walk(result.data, (record) => {
    if (match) return
    const id = String(record.company_id ?? record.companyId ?? record.id ?? '')
    const label = String(record.company_name ?? record.name ?? record.legal_name ?? '')
    if (id && label && label.toLowerCase().includes(name.toLowerCase().replace(/\s+llc$/i, '').trim())) {
      match = { id, name: label }
    }
  })
  return match
}

export async function createCompany(input: { name: string; entityType: string; state: string }, signal?: AbortSignal) {
  const existing = await findCompany(input.name, signal)
  if (existing) return existing
  const suffix = /llc/i.test(input.entityType) ? 'LLC' : undefined
  const base = input.name.replace(/\s+(llc|l\.l\.c\.|inc\.?|corp\.?)$/i, '').trim()
  const result = await call('create_company_tool', {
    company_name: base,
    entity_type: input.entityType,
    state: input.state,
    ...(suffix ? { entity_suffix: suffix } : {}),
  }, signal)
  const id = findString(result.data, ['company_id', 'companyId', 'id'])
  if (!id) throw new Error(`Northwest created no company id. ${result.text.slice(0, 280)}`)
  return { id, name: input.name }
}

export async function updateCompany(companyId: string, fields: { name: string; value: string }[], signal?: AbortSignal) {
  if (!fields.length) return
  await call('update_company_details_tool', { company_id: companyId, fields }, signal)
}

export async function quoteFormation(companyId: string, signal?: AbortSignal) {
  const result = await call('list_formation_filing_options_tool', { company_id: companyId }, signal)
  const methodId = findString(result.data, ['filing_method_id', 'filingMethodId', 'id'])
  const price = findString(result.data, ['price', 'total', 'amount', 'fee'])
  const speed = /expedit/i.test(result.text) ? 'expedited' : 'standard'
  return { methodId, price, speed, summary: result.text.slice(0, 4000) }
}

export async function addFormation(companyId: string, methodId: string | undefined, signal?: AbortSignal) {
  return call('add_formation_to_cart_tool', {
    company_id: companyId,
    ...(methodId ? { filing_method_id: methodId } : { filing_speed: 'expedited' }),
    include_renewal_service: true,
  }, signal)
}

export async function addEin(companyId: string, signal?: AbortSignal) {
  const existing = await companyEin(companyId, signal)
  if (existing.ein) return { already: true, ...existing }
  return call('add_ein_to_cart_tool', { company_id: companyId, responsible_party_has_ssn: true }, signal)
}

export async function cart(companyId: string, signal?: AbortSignal) {
  const result = await call('get_cart_items_tool', { company_id: companyId }, signal)
  let count = 0
  walk(result.data, (record) => {
    if (record.item_id || record.itemId || record.product_id) count += 1
  })
  if (!count) {
    const match = result.text.match(/(\d+)\s+(item|line)/i)
    count = match ? Number(match[1]) : (result.text.trim() ? 1 : 0)
  }
  const total = findString(result.data, ['total', 'amount', 'price']) ?? ''
  return { count, total, summary: result.text.slice(0, 4000) }
}

export async function checkout(companyId: string, method: NorthwestMethod, expectedItemCount: number, signal?: AbortSignal) {
  const result = await call('checkout_cart_tool', {
    company_id: companyId,
    expected_item_count: expectedItemCount,
    payable_id: method.payableId,
    payable_type: method.type,
  }, signal)
  const confirmation = findString(result.data, ['confirmation', 'confirmation_number', 'order_id', 'orderId', 'invoice_number'])
  if (!confirmation && /fail|error|ineligible|changed/i.test(result.text) && !/success|confirmed|placed|thank/i.test(result.text)) {
    throw new Error(`Northwest checkout did not confirm. ${result.text.slice(0, 280)}`)
  }
  return { confirmation: confirmation ?? 'placed', summary: result.text.slice(0, 4000) }
}

export async function filingStatus(companyId: string, signal?: AbortSignal) {
  const result = await call('get_filing_statuses_tool', { company_id: companyId }, signal)
  return {
    status: findString(result.data, ['status', 'filing_status', 'state']) ?? result.text.slice(0, 160),
    summary: result.text.slice(0, 4000),
    complete: /file[d ]|complete|approved|accepted|stamped|active/i.test(result.text) && !/pending|await|processing|in progress/i.test(result.text.split('\n')[0] ?? ''),
  }
}

export async function companyEin(companyId: string, signal?: AbortSignal) {
  const result = await call('get_company_ein_tool', { company_id: companyId }, signal)
  const ein = findString(result.data, ['ein', 'ein_number', 'tax_id']) ?? result.text.match(/\b\d{2}-\d{7}\b/)?.[0]
  return {
    ein,
    pending: /pending|in progress|processing/i.test(result.text),
    summary: result.text.slice(0, 4000),
  }
}

export async function pullDocuments(companyId: string, signal?: AbortSignal) {
  const listed = await call('get_documents_tool', { company_id: companyId, locked: false, limit: 20 }, signal)
  const ids: { id: string; title: string }[] = []
  walk(listed.data, (record) => {
    const id = String(record.document_id ?? record.documentId ?? record.id ?? '')
    const title = String(record.title ?? record.name ?? record.type ?? record.classification ?? '')
    if (id && !ids.some((entry) => entry.id === id)) ids.push({ id, title: title || 'Northwest document' })
  })
  const documents: { title: string; markdown: string }[] = []
  for (const entry of ids.slice(0, 6)) {
    const content = await call('get_document_content_tool', { document_id: entry.id, company_id: companyId }, signal)
    documents.push({ title: entry.title, markdown: content.text.slice(0, 20000) || listed.text.slice(0, 4000) })
  }
  if (!documents.length && listed.text.trim()) {
    documents.push({ title: 'Northwest document list', markdown: listed.text.slice(0, 8000) })
  }
  return documents
}
