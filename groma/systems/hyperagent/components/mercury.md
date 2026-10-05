---
type: C4 Component
title: Mercury account adapter
status: stable
groma:
  id: mercury
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/mercury.ts
  group: Platform integrations
  technology: Mercury API
description: Reads connected operating-account information for confirmed banking steps.
---

This adapter supports existing connected accounts; it does not claim to create bank accounts through an API.
