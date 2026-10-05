---
type: C4 Component
title: Fly.io job runner
status: stable
groma:
  id: worker-index
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/worker/index.ts
  group: Background execution
  technology: Node.js, Fly.io
description: Runs research and browser jobs independently of open browser tabs.
---

The separately deployed Fly.io worker scans the Neon queue, runs up to two jobs at a time and drains on shutdown. An authenticated wake-up endpoint nudges the runner; a periodic scan also recovers queued jobs and expired leases. This checkout uses a Fly Machine, not Sprites.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/worker/index.ts](../../../../web/worker/index.ts) | [web/src/server/research.ts](../../../../web/src/server/research.ts) | Runs research job | TypeScript |
| [web/worker/index.ts](../../../../web/worker/index.ts) | [web/src/server/browser-agent.ts](../../../../web/src/server/browser-agent.ts) | Runs browser job | TypeScript |
| [web/worker/index.ts](../../../../web/worker/index.ts) | [web/src/server/canvas-db.ts](../../../../web/src/server/canvas-db.ts) | Claims queued work | TypeScript |
