export type CosmosSearchItem = {
  id: string
  title: string
  url: string
  imageUrl?: string
  description?: string
  sourceUrl?: string
}

export type CosmosSearchResult = {
  query: string
  items: CosmosSearchItem[]
  nextCursor?: string
}

export type CosmosSearchInput = {
  query: string
  limit?: number
  cursor?: string
  signal?: AbortSignal
}
