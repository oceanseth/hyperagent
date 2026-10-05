---
type: C4 Component
title: Interactive plans
status: stable
groma:
  id: plan-graph
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/plan-graph.tsx
    - scanner: typescript
      file: web/src/components/canvas/plan-graph.tsx
  group: Shared canvas
  technology: React
description: Displays editable state machines, confirmed fields and blockers.
---

Plans make multistep work inspectable on the canvas. Fields and questions must be resolved before guarded transitions can proceed; child graphs expose nested work.
