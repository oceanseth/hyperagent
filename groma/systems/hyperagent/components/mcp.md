---
type: C4 Component
title: Executor tool gateway
status: stable
groma:
  id: mcp
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/mcp.ts
  group: Platform integrations
  technology: Executor, MCP, Mastra MCPClient
description: Discovers connected tools and records redacted tool lifecycle events.
---

Executor exposes connected service capabilities to the agents. Discovery happens per job or request, so changing a connection does not require redeploying application code.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/mcp.ts](../../../../web/src/server/mcp.ts) | [executor](../../../externals/executor.md) | Discovers connected tools | MCP |
