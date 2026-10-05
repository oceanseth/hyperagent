---
type: C4 Component
title: Shared browser lifecycle
status: stable
groma:
  id: browser-canvas
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/browser-canvas.ts
  group: Background execution
  technology: Neon, KERNEL
description: Persists browser cards and dispatches browser-agent work.
---

A starting card is saved before cloud session creation, so participants see progress. Closing the card removes it and ends its cloud session; tasks queue against the browser ID.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/browser-canvas.ts](../../../../web/src/server/browser-canvas.ts) | [web/src/server/kernel-browser.ts](../../../../web/src/server/kernel-browser.ts) | Creates cloud session | TypeScript |
| [web/src/server/browser-canvas.ts](../../../../web/src/server/browser-canvas.ts) | [web/src/server/dispatch.ts](../../../../web/src/server/dispatch.ts) | Wakes browser agent | TypeScript |
| [web/src/server/browser-canvas.ts](../../../../web/src/server/browser-canvas.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Persists browser cards | TypeScript |
