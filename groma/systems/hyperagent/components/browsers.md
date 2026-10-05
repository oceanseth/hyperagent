---
type: C4 Component
title: Browser HTTP interface
status: stable
groma:
  id: browsers
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/browsers.ts
      symbol: Route
  group: Web application
  technology: TanStack server routes
description: Accepts browser-card operations from the shared canvas.
---

The route dispatches workspace-scoped browser lifecycle and task requests to the browser service.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/routes/api/browsers.ts](../../../../web/src/routes/api/browsers.ts) | [web/src/server/browser-canvas.ts](../../../../web/src/server/browser-canvas.ts) | Dispatches browser task | TypeScript |
