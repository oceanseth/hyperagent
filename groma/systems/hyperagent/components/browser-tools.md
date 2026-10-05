---
type: C4 Component
title: Assistant browser tools
status: stable
groma:
  id: browser-tools
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/browser-tools.ts
      symbol: browserTools
  group: Assistant and tools
  technology: Mastra tools
description: Exposes open, navigate, list, close and agent-task operations.
---

These tools delegate browser lifecycle work to the shared browser service and request a canvas refresh when state changes.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/browser-tools.ts](../../../../web/src/server/browser-tools.ts) | [web/src/server/browser-canvas.ts](../../../../web/src/server/browser-canvas.ts) | Manages shared browsers | TypeScript |
