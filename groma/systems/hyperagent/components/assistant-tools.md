---
type: C4 Component
title: Tool assembly
status: stable
groma:
  id: assistant-tools
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/assistant-tools.ts
  group: Assistant and tools
  technology: Mastra tools, MCP
description: Loads canvas tools and discovers connected Executor and KERNEL capabilities.
---

Each request assembles local layout, planning and browser tools with connected MCP toolsets. Connections are closed after the request.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/assistant-tools.ts](../../../../web/src/server/assistant-tools.ts) | [web/src/server/canvas-sidecar.ts](../../../../web/src/server/canvas-sidecar.ts) | Delegates research | Mastra tool |
| [web/src/server/assistant-tools.ts](../../../../web/src/server/assistant-tools.ts) | [web/src/server/browser-tools.ts](../../../../web/src/server/browser-tools.ts) | Loads browser operations | TypeScript |
