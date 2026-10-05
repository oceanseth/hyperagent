---
type: C4 Component
title: Browser execution agent
status: stable
groma:
  id: browser-agent
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/browser-agent.ts
  group: Background execution
  technology: Mastra Agent, KERNEL
description: Performs a queued task in the same KERNEL session visible on the board.
---

The agent reads the page, navigates, clicks and fills through browser skills. Each step is recorded and results return to the shared canvas. The Fly worker normally runs it; the app has an inline fallback.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/browser-agent.ts](../../../../web/src/server/browser-agent.ts) | [web/src/server/browser-skills.ts](../../../../web/src/server/browser-skills.ts) | Performs page actions | TypeScript |
| [web/src/server/browser-agent.ts](../../../../web/src/server/browser-agent.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Publishes browser progress | TypeScript |
