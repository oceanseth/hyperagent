---
type: C4 Component
title: Shared research canvas
status: stable
groma:
  id: infinite-canvas
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/infinite-canvas.tsx
    - scanner: typescript
      file: web/src/components/canvas/infinite-canvas.tsx
      symbol: InfiniteCanvas
    - scanner: typescript
      file: web/src/hooks/use-infinite-canvas.ts
    - scanner: typescript
      file: web/src/hooks/use-canvas-workspace.ts
    - scanner: typescript
      file: web/src/lib/canvas-workspace.ts
  group: Shared canvas
  technology: React 19, Zustand
description: Presents a shared board of sources, notes, plans and live browser cards.
---

The browser workspace composes independently useful cards on a pannable, zoomable surface. Its workspace hook polls the server for shared state and synchronizes persisted positions. Selected context stacks feed subsequent assistant turns.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/components/canvas/infinite-canvas.tsx](../../../../web/src/components/canvas/infinite-canvas.tsx) | [web/src/routes/api/canvas.ts](../../../../web/src/routes/api/canvas.ts) | Loads shared canvas | HTTP polling |
| [web/src/components/canvas/infinite-canvas.tsx](../../../../web/src/components/canvas/infinite-canvas.tsx) | [web/src/components/canvas/research-cards.tsx](../../../../web/src/components/canvas/research-cards.tsx) | Displays cited results | React |
