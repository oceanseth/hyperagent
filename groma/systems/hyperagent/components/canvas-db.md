---
type: C4 Component
title: Neon workspace store
status: stable
groma:
  id: canvas-db
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/canvas-db.ts
  group: Data and plans
  technology: Neon Postgres, serverless driver
description: Persists shared canvas state, durable jobs, leases and activity events.
---

Both the web app and Fly worker use this data access layer. Workspace IDs scope saved stacks, chat, notes, browser cards, layouts and shared board records. Job claims and heartbeats support independent execution.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | [neon-postgres](../../../externals/neon-postgres.md) | Persists workspace state | SQL over HTTP |
