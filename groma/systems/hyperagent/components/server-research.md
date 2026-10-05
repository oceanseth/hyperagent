---
type: C4 Component
title: Background research agent
status: stable
groma:
  id: server-research
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/research.ts
      symbol: runResearchJob
  group: Background execution
  technology: Mastra Agent, Exa, Executor
description: Searches sources and incrementally publishes cited summaries.
---

The research job claims a lease, discovers tools, streams preliminary sources and publishes a final source stack. Heartbeats, bounded execution and recorded events make progress inspectable.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/research.ts](../../../../web/src/server/research.ts) | [web/src/server/mcp.ts](../../../../web/src/server/mcp.ts) | Discovers research tools | MCP |
| [web/src/server/research.ts](../../../../web/src/server/research.ts) | [web/src/server/web-search.ts](../../../../web/src/server/web-search.ts) | Searches live sources | TypeScript |
| [web/src/server/research.ts](../../../../web/src/server/research.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Publishes source stacks | TypeScript |
| [web/src/server/research.ts](../../../../web/src/server/research.ts) | [web/src/mastra/gateway.ts](../../../../web/src/mastra/gateway.ts) | Resolves research model | TypeScript |
