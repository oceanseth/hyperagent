---
type: C4 Component
title: Canvas HTTP interface
status: stable
groma:
  id: api-canvas
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/canvas.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/notes.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/remove.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/clear.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/layout.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/history.ts
      symbol: Route
  group: Web application
  technology: TanStack server routes
description: Reads workspace snapshots and persists notes, layouts and conversation history.
---

Browser polling and editing use these endpoints. The handlers delegate workspace-scoped state to the Neon-backed store.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/routes/api/canvas.ts](../../../../web/src/routes/api/canvas.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Reads workspace snapshot | TypeScript |
