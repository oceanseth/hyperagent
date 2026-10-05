---
type: C4 Component
title: Agent layout tools
status: stable
groma:
  id: layout-tools
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/layout-tools.ts
      symbol: layoutTools
  group: Assistant and tools
  technology: Mastra tools
description: Lets the assistant inspect and rearrange real canvas items.
---

The assistant lists actual item IDs before moving cards. Layout changes persist for board participants and can focus the viewport on the next useful item.
