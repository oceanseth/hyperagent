---
type: C4 Component
title: Neon inference adapter
status: stable
groma:
  id: gateway
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/mastra/gateway.ts
  group: Platform integrations
  technology: Neon AI Gateway
description: Routes assistant, research and browser-agent inference through Neon AI Gateway.
---

All app model configuration is resolved server-side through the gateway. Each agent role can choose a model via environment configuration while keeping the gateway credentials out of browser code.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/mastra/gateway.ts](../../../../web/src/mastra/gateway.ts) | [neon-ai-gateway](../../../externals/neon-ai-gateway.md) | Requests model inference | HTTPS |
