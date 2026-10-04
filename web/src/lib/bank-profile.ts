export type BankProfile = {
  key: 'novo' | 'mercury' | 'other'
  name: string
  applyUrl: string
  canOpenViaApi: false
  canListViaApi: boolean
  apiTokenEnv?: string
  needs: string[]
}

export function lastFour(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

export function bankProfile(name: string): BankProfile {
  const raw = name.trim() || 'unspecified bank'
  const key = raw.toLowerCase()
  if (key.includes('novo')) {
    return {
      key: 'novo',
      name: 'Novo',
      applyUrl: 'https://www.novo.co',
      canOpenViaApi: false,
      canListViaApi: false,
      needs: [
        'Legal company name and EIN',
        'Stamped articles of organization',
        'Business address',
        'Beneficial owners at 25%+ and one control person',
        'Identity check inside the Novo portal — do not type SSN into this canvas',
      ],
    }
  }
  if (key.includes('mercury')) {
    return {
      key: 'mercury',
      name: 'Mercury',
      applyUrl: 'https://mercury.com',
      canOpenViaApi: false,
      canListViaApi: true,
      apiTokenEnv: 'MERCURY_API_TOKEN',
      needs: [
        'Legal company name and EIN',
        'Stamped articles of organization',
        'Business address',
        'Beneficial owners at 25%+ and one control person',
        'Identity check inside the Mercury portal — do not type SSN into this canvas',
        'After the account exists, MERCURY_API_TOKEN on the worker can pull last four',
      ],
    }
  }
  return {
    key: 'other',
    name: raw,
    applyUrl: '',
    canOpenViaApi: false,
    canListViaApi: false,
    needs: [
      'Legal company name and EIN',
      'Stamped articles of organization',
      'Owners and control person as that bank asks',
      'Whatever application URL or API this bank requires — the agent will ask before running',
    ],
  }
}
