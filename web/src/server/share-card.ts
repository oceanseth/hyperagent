import { createServerFn } from '@tanstack/react-start'

export const loadShareCard = createServerFn({ method: 'GET' })
  .validator((code: string) => code)
  .handler(async ({ data: code }) => {
    const origin = (process.env.PUBLIC_ORIGINS ?? 'https://hyperagent.lol').split(',')[0].trim() || 'https://hyperagent.lol'
    const fallback = { title: 'Shared canvas', origin, found: false }
    if (!/^[a-z0-9]{4,32}$/i.test(code)) return fallback
    try {
      const { getShareCard } = await import('./canvas-db')
      const card = await getShareCard(code)
      return { title: card?.title || 'Shared canvas', origin, found: Boolean(card) }
    } catch {
      return fallback
    }
  })
