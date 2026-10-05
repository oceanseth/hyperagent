---
type: C4 Component
title: Cosmos visual discovery
status: stable
groma:
  id: server-cosmos
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/cosmos.ts
      symbol: searchCosmos
    - scanner: typescript
      file: web/src/lib/cosmos.ts
  group: Platform integrations
  technology: Cosmos HTTP API
description: Retrieves optional visual references for research source stacks.
---

When configured, visual search returns image URLs and source links that the research worker can publish on the canvas.
