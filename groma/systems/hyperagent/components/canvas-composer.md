---
type: C4 Component
title: Conversation workspace
status: stable
groma:
  id: canvas-composer
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/canvas-composer.tsx
    - scanner: typescript
      file: web/src/components/canvas/canvas-composer.tsx
      symbol: CanvasComposer
    - scanner: typescript
      file: web/src/hooks/use-canvas-composer.ts
    - scanner: react
      file: web/src/components/canvas/chat-history.tsx
    - scanner: typescript
      file: web/src/components/canvas/chat-history.tsx
      symbol: ChatHistoryPanel
    - scanner: react
      file: web/src/assistant.tsx
    - scanner: typescript
      file: web/src/assistant.tsx
      symbol: Assistant
  group: Shared canvas
  technology: Assistant UI, AI SDK
description: Connects text input, conversation history and selected context to the assistant.
---

The composer keeps the conversation available while research runs in the background. The assistant runtime streams replies and renders tool results alongside the shared board.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/components/canvas/canvas-composer.tsx](../../../../web/src/components/canvas/canvas-composer.tsx) | [web/src/routes/api/chat.ts](../../../../web/src/routes/api/chat.ts) | Streams conversation | HTTP |
| [web/src/components/canvas/canvas-composer.tsx](../../../../web/src/components/canvas/canvas-composer.tsx) | [web/src/components/assistant-ui/elements/thread.aui.tsx](../../../../web/src/components/assistant-ui/elements/thread.aui.tsx) | Renders streamed messages | Assistant UI |
