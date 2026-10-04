import { getSecret } from './settings-db'

const STRIPE_API = 'https://api.stripe.com'

export type StripeKeyStatus =
  | { status: 'needs_key'; reason?: string }
  | { status: 'ready'; hint: string; accountId?: string; accountName?: string; livemode?: boolean }
  | { status: 'unverified'; hint: string; reason: string }

/** Server-side check of the workspace Stripe key. Never returns the key itself,
 *  only a masked hint and non-secret account details from Stripe. */
export async function stripeKeyStatus(workspaceId: string, signal?: AbortSignal): Promise<StripeKeyStatus> {
  const key = (await getSecret(workspaceId, 'stripe'))?.trim()
  if (!key) return { status: 'needs_key' }
  const hint = key.length > 4 ? `…${key.slice(-4)}` : '…'
  // Atlas tokens are not Stripe API keys; store them but skip the API check.
  if (!/^(?:sk|rk)_(?:live|test)_/.test(key)) {
    return { status: 'unverified', hint, reason: 'Stored, but it is not a Stripe secret/restricted key, so it was not checked against the Stripe API.' }
  }
  try {
    const timeout = AbortSignal.timeout(8000)
    const response = await fetch(`${STRIPE_API}/v1/account`, {
      headers: { authorization: `Bearer ${key}` },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (response.status === 401) return { status: 'needs_key', reason: 'Stripe rejected the stored key. Enter a valid one.' }
    if (!response.ok) return { status: 'unverified', hint, reason: `Stripe could not be reached (HTTP ${response.status}).` }
    const account = await response.json() as { id?: string; business_profile?: { name?: string | null }; settings?: { dashboard?: { display_name?: string | null } } }
    return {
      status: 'ready',
      hint,
      accountId: account.id,
      accountName: account.settings?.dashboard?.display_name || account.business_profile?.name || undefined,
      livemode: key.includes('_live_'),
    }
  } catch {
    return { status: 'unverified', hint, reason: 'Stripe could not be reached.' }
  }
}
