---
type: C4 Component
title: Voice assistant endpoint
status: stable
groma:
  id: voice
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/voice.ts
      symbol: Route
  group: Assistant and tools
  technology: Mastra, HTTP
description: Runs a spoken assistant turn against the same workspace context.
---

Voice turns reuse the assistant tools and workspace data so spoken instructions can act on the same board.
