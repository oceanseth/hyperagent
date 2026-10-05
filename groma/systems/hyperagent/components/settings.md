---
type: C4 Component
title: Integration configuration
status: stable
groma:
  id: settings
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/settings.ts
      symbol: Route
    - scanner: typescript
      file: web/src/server/settings-db.ts
    - scanner: react
      file: web/src/components/canvas/settings-dialog.tsx
    - scanner: typescript
      file: web/src/components/canvas/settings-dialog.tsx
      symbol: SettingsDialog
    - scanner: react
      file: web/src/components/canvas/stripe-key-tool.tsx
    - scanner: typescript
      file: web/src/components/canvas/stripe-key-tool.tsx
      symbol: StripeKeyTool
  group: Data and plans
  technology: React, server routes
description: Collects workspace provider settings and secure inline key input.
---

Provider keys are collected through dedicated settings and inline forms rather than published source stacks. Server-side resolution supplies only the credentials needed by each integration.
