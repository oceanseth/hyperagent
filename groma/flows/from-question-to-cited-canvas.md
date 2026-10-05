---
type: Groma Flow
title: From question to cited canvas
groma:
  id: from-question-to-cited-canvas
---

Ask for research, keep talking, and watch evidence become reusable shared context.

## Steps

| From | To | Action |
| --- | --- | --- |
| [collaborator](../actors/collaborator.md) | [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | Ask a research question on the shared board. |
| [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | [chat](../systems/hyperagent/components/chat.md) | Send the question with selected context stacks. |
| [chat](../systems/hyperagent/components/chat.md) | [assistant-tools](../systems/hyperagent/components/assistant-tools.md) | Make local and connected tools available. |
| [assistant-tools](../systems/hyperagent/components/assistant-tools.md) | [canvas-sidecar](../systems/hyperagent/components/canvas-sidecar.md) | Delegate the research task. |
| [canvas-sidecar](../systems/hyperagent/components/canvas-sidecar.md) | [canvas-db](../systems/hyperagent/components/canvas-db.md) | Persist a job in Neon before acknowledging it. |
| [canvas-sidecar](../systems/hyperagent/components/canvas-sidecar.md) | [dispatch](../systems/hyperagent/components/dispatch.md) | Wake the independent runner. |
| [dispatch](../systems/hyperagent/components/dispatch.md) | [worker-index](../systems/hyperagent/components/worker-index.md) | Notify the Fly.io worker. |
| [worker-index](../systems/hyperagent/components/worker-index.md) | [server-research](../systems/hyperagent/components/server-research.md) | Run the background Mastra research agent. |
| [server-research](../systems/hyperagent/components/server-research.md) | [web-search](../systems/hyperagent/components/web-search.md) | Retrieve live evidence. |
| [web-search](../systems/hyperagent/components/web-search.md) | [executor](../externals/executor.md) | Resolve and invoke the connected Exa search tool. |
| [executor](../externals/executor.md) | [exa](../externals/exa.md) | Return real result URLs and excerpts. |
| [server-research](../systems/hyperagent/components/server-research.md) | [canvas-db](../systems/hyperagent/components/canvas-db.md) | Publish preliminary sources and the final summary. |
| [infinite-canvas](../systems/hyperagent/components/infinite-canvas.md) | [api-canvas](../systems/hyperagent/components/api-canvas.md) | Poll the shared workspace for updates. |
| [infinite-canvas](../systems/hyperagent/components/infinite-canvas.md) | [research-cards](../systems/hyperagent/components/research-cards.md) | Present cited sources as reusable context. |
