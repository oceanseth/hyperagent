---
type: C4 Component
title: KERNEL browser adapter
status: stable
groma:
  id: kernel-browser
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/kernel-browser.ts
  group: Platform integrations
  technology: KERNEL, Executor
description: Creates, navigates and deletes cloud sessions via Executor or the KERNEL API.
---

The primary path discovers KERNEL tools in Executor. A direct KERNEL API fallback can use workspace configuration when that connection is unavailable.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/kernel-browser.ts](../../../../web/src/server/kernel-browser.ts) | [kernel-cloud](../../../externals/kernel-cloud.md) | Controls cloud browser | Executor or REST |
