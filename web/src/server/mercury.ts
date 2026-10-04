export type MercuryAccount = {
  name: string
  last4: string
  routingLast4?: string
  type?: string
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

export function mercuryConfigured() {
  return Boolean(process.env.MERCURY_API_TOKEN?.trim())
}

export async function listOperatingAccounts(companyName?: string): Promise<MercuryAccount[]> {
  const token = process.env.MERCURY_API_TOKEN?.trim()
  if (!token) {
    throw new Error('Mercury is not connected. Set MERCURY_API_TOKEN after the account exists, then run this state again. The API can list accounts; it cannot open a new one.')
  }
  const response = await fetch('https://api.mercury.com/api/v1/accounts', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('Mercury did not accept the API token. Check MERCURY_API_TOKEN.')
  const payload = await response.json() as unknown
  const accounts: MercuryAccount[] = []
  walk(payload, (record) => {
    const number = String(record.accountNumber ?? record.account_number ?? '')
    const name = String(record.name ?? record.nickname ?? record.legalBusinessName ?? '')
    const status = String(record.status ?? '')
    if (!number || /closed|archived/i.test(status)) return
    const last4 = number.replace(/\D/g, '').slice(-4)
    if (last4.length !== 4) return
    if (companyName && name && !name.toLowerCase().includes(companyName.toLowerCase().slice(0, 12))) return
    accounts.push({
      name: name || 'Mercury account',
      last4,
      routingLast4: String(record.routingNumber ?? record.routing_number ?? '').replace(/\D/g, '').slice(-4) || undefined,
      type: String(record.kind ?? record.type ?? record.accountType ?? ''),
    })
  })
  return accounts
}
