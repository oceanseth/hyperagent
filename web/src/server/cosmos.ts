import type { CosmosSearchInput, CosmosSearchItem, CosmosSearchResult } from '#/lib/cosmos'

export type { CosmosSearchInput, CosmosSearchItem, CosmosSearchResult } from '#/lib/cosmos'

// Taken from cosmos/operations.graphql and cosmos/schema.graphql. Search runs
// only in the background research worker, never in the human-facing chat turn.
const SEARCH = `
  query CanvasCosmosSearch($query: String!, $limit: Int!, $cursor: String) {
    searchElements(searchTerm: $query, meta: { pageSize: $limit, pageCursor: $cursor }) {
      results {
        element {
          __typename
          id
          shareUrl
          isReadyToShow
          hasIllegalReports
          generatedCaption { text }
          source { url title description }
          ... on ElementWithMediaTile {
            media {
              __typename
              url
              ... on Video { thumbnail { url } }
              ... on AnimatedImage { video { thumbnailUrl } }
            }
          }
          ... on ProductElementTile {
            productTitle: name
            productDescription: description
            productBrand: brand
          }
          ... on WebsiteElementTile {
            websiteTitle: title
            websiteDescription: description
          }
          ... on TextElementTile { text }
        }
      }
      meta { nextPageCursor }
    }
  }
`

type CosmosElement = {
  id?: unknown
  shareUrl?: unknown
  isReadyToShow?: boolean
  hasIllegalReports?: boolean
  generatedCaption?: { text?: unknown } | null
  source?: { url?: unknown; title?: unknown; description?: unknown } | null
  media?: {
    __typename?: string
    url?: unknown
    thumbnail?: { url?: unknown } | null
    video?: { thumbnailUrl?: unknown } | null
  } | null
  productTitle?: unknown
  productDescription?: unknown
  productBrand?: unknown
  websiteTitle?: unknown
  websiteDescription?: unknown
  text?: unknown
}

type SearchResponse = {
  data?: {
    searchElements?: {
      results?: Array<{ element?: CosmosElement | null } | null>
      meta?: { nextPageCursor?: unknown }
    } | null
  } | null
  errors?: Array<{ extensions?: { code?: string } }>
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength) || undefined
}

function toItem(element: CosmosElement): CosmosSearchItem | undefined {
  if (element.isReadyToShow === false || element.hasIllegalReports) return undefined
  if (typeof element.id !== 'string' && typeof element.id !== 'number') return undefined
  const sourceUrl = webUrl(element.source?.url)
  const url = webUrl(element.shareUrl) ?? sourceUrl
  if (!url) return undefined
  const media = element.media
  const imageUrl = media?.__typename === 'Video'
    ? webUrl(media.thumbnail?.url)
    : media?.__typename === 'AnimatedImage'
      ? webUrl(media.video?.thumbnailUrl) ?? webUrl(media.url)
      : webUrl(media?.url)
  const title = text(element.productTitle, 160)
    ?? text(element.websiteTitle, 160)
    ?? text(element.source?.title, 160)
    ?? text(element.productBrand, 160)
    ?? text(element.generatedCaption?.text, 160)
    ?? text(element.text, 160)
    ?? 'Cosmos reference'
  const description = text(element.productDescription, 800)
    ?? text(element.websiteDescription, 800)
    ?? text(element.source?.description, 800)
    ?? text(element.generatedCaption?.text, 800)
    ?? text(element.text, 800)
  return { id: String(element.id), title, url, imageUrl, description, sourceUrl }
}

export async function searchCosmos(input: CosmosSearchInput): Promise<CosmosSearchResult> {
  if (typeof input.query !== 'string' || !input.query.trim()) {
    throw new Error('Enter a search query for Cosmos.')
  }
  const query = input.query.trim()
  if (query.length > 300) throw new Error('Keep Cosmos searches under 300 characters.')
  if (input.cursor && (typeof input.cursor !== 'string' || input.cursor.length > 4096)) {
    throw new Error('The Cosmos pagination cursor is invalid. Start a new search.')
  }
  const token = process.env.COSMOS_TOKEN?.trim().replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('Cosmos is not connected. Configure COSMOS_TOKEN on the server.')
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.max(1, Math.min(8, Math.trunc(input.limit)))
    : 8
  const timeout = AbortSignal.timeout(20_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout

  try {
    const response = await fetch('https://api.cosmos.so/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        origin: 'https://www.cosmos.so',
        'x-client-name': 'cosmos-web',
      },
      body: JSON.stringify({
        query: SEARCH,
        variables: { query, limit, cursor: input.cursor ?? null },
      }),
      signal,
    })
    if (response.status === 401 || response.status === 403) {
      throw new Error('Cosmos authentication expired or was rejected. Reconnect Cosmos to search again.')
    }
    if (response.status === 429) throw new Error('Cosmos is rate limiting searches. Try again shortly.')
    if (!response.ok) throw new Error(`Cosmos search is unavailable (HTTP ${response.status}). Try again shortly.`)
    let payload: SearchResponse
    try {
      payload = await response.json() as SearchResponse
    } catch {
      throw new Error('Cosmos returned an unreadable search response. Try again shortly.')
    }
    if (payload?.errors?.length) {
      const needsAuth = payload.errors.some(({ extensions }) =>
        /UNAUTHENTICATED|UNAUTHORIZED|FORBIDDEN|AUTHENTICATION/i.test(extensions?.code ?? ''),
      )
      throw new Error(needsAuth
        ? 'Cosmos authentication expired or was rejected. Reconnect Cosmos to search again.'
        : 'Cosmos could not complete this search. Its API may have changed; try another query or reconnect.')
    }
    const page = payload?.data?.searchElements
    if (!Array.isArray(page?.results)) throw new Error('Cosmos returned an incomplete search response.')
    const items: CosmosSearchItem[] = []
    const seen = new Set<string>()
    for (const row of page.results) {
      if (!row?.element) continue
      const item = toItem(row.element)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      items.push(item)
      if (items.length >= limit) break
    }
    return {
      query,
      items,
      nextCursor: typeof page.meta?.nextPageCursor === 'string'
        ? page.meta.nextPageCursor || undefined
        : undefined,
    }
  } catch (error) {
    if (input.signal?.aborted) throw new Error('Cosmos search was cancelled.')
    if (timeout.aborted) throw new Error('Cosmos search timed out after 20 seconds. Try again shortly.')
    if (error instanceof TypeError) throw new Error('Could not connect to Cosmos. Try again shortly.')
    throw error
  }
}
