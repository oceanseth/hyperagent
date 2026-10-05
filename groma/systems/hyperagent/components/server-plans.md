---
type: C4 Component
title: Plan state machines
status: stable
groma:
  id: server-plans
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/plans.ts
    - scanner: typescript
      file: web/src/lib/plan.ts
    - scanner: typescript
      file: web/src/lib/bank-profile.ts
    - scanner: typescript
      file: web/src/lib/company-formation.ts
  group: Data and plans
  technology: TypeScript, Neon Postgres
description: Stores plans and enforces required fields and state transitions.
---

Shared plan contracts and company templates describe states, blockers, fields and documents. The server persists transitions and only advances work when its requirements are met.
