---
type: C4 Component
title: Worker wake-up
status: stable
groma:
  id: dispatch
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/dispatch.ts
  group: Background execution
  technology: Authenticated HTTP
description: Notifies the Fly worker after a job is durably queued.
---

Jobs already exist in Neon before this call. The request is a wake-up signal rather than the source of truth for whether work exists.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/dispatch.ts](../../../../web/src/server/dispatch.ts) | [web/worker/index.ts](../../../../web/worker/index.ts) | Signals queued work | Authenticated HTTP |
