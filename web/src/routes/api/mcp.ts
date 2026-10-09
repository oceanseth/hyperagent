import { createFileRoute } from '@tanstack/react-router'
import { handleMcpRequest } from '#/server/mcp-board'

// One board, one stateless MCP endpoint. The bearer token is the only auth.
// `?board=<workspace uuid>` pins the server to that board; a token for a
// different board is rejected. Omitting `board` uses the token's own board.
export const Route = createFileRoute('/api/mcp')({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
    },
  },
})
