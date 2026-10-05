---
type: C4 Component
title: Mastra formation memory
status: stable
groma:
  id: mastra-memory
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/mastra-memory.ts
  group: Platform integrations
  technology: Mastra Memory Gateway
description: Loads observations and recent messages for company-formation conversations.
---

Optional memory enriches assistant context and records recent turns. Unavailable memory does not interrupt the conversation.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/mastra-memory.ts](../../../../web/src/server/mastra-memory.ts) | [mastra-memory-gateway](../../../externals/mastra-memory-gateway.md) | Loads thread context | HTTPS |
