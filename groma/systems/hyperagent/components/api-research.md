---
type: C4 Component
title: Research HTTP interface
status: stable
groma:
  id: api-research
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/research.ts
      symbol: Route
  group: Web application
  technology: TanStack server routes
description: Queues research from the workspace.
---

This entry point records requested research and dispatches background execution while the canvas remains responsive.
