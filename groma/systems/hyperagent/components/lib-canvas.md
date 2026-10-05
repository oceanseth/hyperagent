---
type: C4 Component
title: Canvas data contracts
status: stable
groma:
  id: lib-canvas
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/lib/canvas.ts
  group: Shared canvas
  technology: TypeScript, Zod
description: Defines the shared shapes of jobs, sources, notes and browser cards.
---

Browser and server code share these types and schemas for canvas snapshots and published source stacks.
