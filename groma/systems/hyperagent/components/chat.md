---
type: C4 Component
title: Streaming assistant endpoint
status: stable
groma:
  id: chat
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/chat.ts
      symbol: Route
  group: Assistant and tools
  technology: Mastra, AI SDK
description: Runs contextual Mastra turns and streams AI SDK message events.
---

The route gathers selected source stacks, plans and optional formation memory. It loads tools, streams the assistant and persists conversation messages after the turn.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/routes/api/chat.ts](../../../../web/src/routes/api/chat.ts) | [web/src/mastra/agents/assistant.ts](../../../../web/src/mastra/agents/assistant.ts) | Runs assistant turn | Mastra |
| [web/src/routes/api/chat.ts](../../../../web/src/routes/api/chat.ts) | [web/src/server/assistant-tools.ts](../../../../web/src/server/assistant-tools.ts) | Loads available tools | TypeScript |
| [web/src/routes/api/chat.ts](../../../../web/src/routes/api/chat.ts) | [web/src/server/mastra-memory.ts](../../../../web/src/server/mastra-memory.ts) | Loads remembered context | TypeScript |
