---
type: Groma Flow
title: One gateway for agent inference
groma:
  id: one-gateway-for-agent-inference
---

The assistant resolves its model at request time and sends inference through Neon AI Gateway.

## Steps

| From | To | Action |
| --- | --- | --- |
| [collaborator](../actors/collaborator.md) | [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | Start a conversation. |
| [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | [chat](../systems/hyperagent/components/chat.md) | Stream a contextual request. |
| [chat](../systems/hyperagent/components/chat.md) | [agents-assistant](../systems/hyperagent/components/agents-assistant.md) | Run the Mastra assistant. |
| [agents-assistant](../systems/hyperagent/components/agents-assistant.md) | [gateway](../systems/hyperagent/components/gateway.md) | Resolve the server-side model configuration. |
| [gateway](../systems/hyperagent/components/gateway.md) | [neon-ai-gateway](../externals/neon-ai-gateway.md) | Send the model request through Neon AI Gateway. |
| [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | [thread-aui](../systems/hyperagent/components/thread-aui.md) | Present the streamed answer through Assistant UI. |
