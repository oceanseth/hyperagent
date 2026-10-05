---
type: C4 Component
title: Company workflow executor
status: stable
groma:
  id: formation
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/formation.ts
  group: Data and plans
  technology: TypeScript
description: Executes the confirmed company-formation steps supported by configured providers.
---

The workflow coordinates filing, EIN and banking-related artifacts. External actions require the relevant confirmed fields and provider connection; unsupported automatic actions remain explicit manual steps.
