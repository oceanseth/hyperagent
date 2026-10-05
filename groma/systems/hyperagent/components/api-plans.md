---
type: C4 Component
title: Plan commands
status: stable
groma:
  id: api-plans
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/plans.ts
      symbol: Route
    - scanner: typescript
      file: web/src/server/plan-tools.ts
      symbol: planTools
  group: Data and plans
  technology: Mastra tools, TanStack routes
description: Exposes structured planning tools and HTTP actions.
---

Assistant tools and user edits feed the same plan model. Secret capture and confirmation requirements are surfaced to the user before provider actions.
