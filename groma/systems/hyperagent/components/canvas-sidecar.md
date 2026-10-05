---
type: C4 Component
title: Research sidecar
status: stable
groma:
  id: canvas-sidecar
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/canvas-sidecar.ts
  group: Assistant and tools
  technology: Mastra Agent
description: Turns research requests and refinements into durable jobs.
---

The sidecar can queue research, replace earlier stacks or remove unwanted results. The conversational assistant stays available while the worker performs the research.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/canvas-sidecar.ts](../../../../web/src/server/canvas-sidecar.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Queues durable work | TypeScript |
| [web/src/server/canvas-sidecar.ts](../../../../web/src/server/canvas-sidecar.ts) | [web/src/server/dispatch.ts](../../../../web/src/server/dispatch.ts) | Wakes job runner | TypeScript |
