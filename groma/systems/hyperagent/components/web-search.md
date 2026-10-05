---
type: C4 Component
title: Exa search adapter
status: stable
groma:
  id: web-search
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/web-search.ts
  group: Platform integrations
  technology: Exa, Executor
description: Retrieves live search results and citation evidence through Executor.
---

The adapter discovers the Exa search tool at runtime. It preserves returned URLs and highlight excerpts, emits source events and identifies its evidence as excerpts rather than full document text.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/web-search.ts](../../../../web/src/server/web-search.ts) | [executor](../../../externals/executor.md) | Invokes connected search | MCP |
