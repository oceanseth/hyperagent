---
type: C4 Component
title: Mastra assistant
status: stable
groma:
  id: agents-assistant
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/mastra/agents/assistant.ts
      symbol: assistantAgent
    - scanner: typescript
      file: web/src/mastra/index.ts
      symbol: mastra
  group: Assistant and tools
  technology: Mastra Agent
description: Coordinates conversation, research, plans and browser tools.
---

The conversational agent delegates research to a sidecar and browser work to a queued agent. It uses confirmed plan state before consequential actions and obtains model inference through Neon AI Gateway.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/mastra/agents/assistant.ts](../../../../web/src/mastra/agents/assistant.ts) | [web/src/mastra/gateway.ts](../../../../web/src/mastra/gateway.ts) | Resolves inference model | TypeScript |
