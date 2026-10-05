---
type: C4 Component
title: Northwest filing adapter
status: stable
groma:
  id: northwest
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/northwest.ts
  group: Platform integrations
  technology: Northwest API
description: Calls the optional registered-agent and filing provider.
---

Used only when the configured company workflow selects Northwest and the required account connection is available.
