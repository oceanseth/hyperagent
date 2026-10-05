---
type: C4 Component
title: Assistant UI message renderer
status: stable
groma:
  id: thread-aui
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/assistant-ui/elements/thread.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/thread.aui.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/artifact-card.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/artifact-card.tsx
      symbol: ArtifactCard
    - scanner: react
      file: web/src/components/assistant-ui/elements/attachment.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/attachment.aui.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/file.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/file.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/follow-up-suggestions.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/follow-up-suggestions.aui.tsx
      symbol: ThreadFollowupSuggestions
    - scanner: react
      file: web/src/components/assistant-ui/elements/image.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/image.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/markdown-text.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/markdown-text.tsx
      symbol: MarkdownText
    - scanner: react
      file: web/src/components/assistant-ui/elements/media-player.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/media-player.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/reasoning.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/reasoning.aui.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/reasoning.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/reasoning.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/surfaces.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/surfaces.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/tool-fallback.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/tool-fallback.aui.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/tool-group.aui.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/tool-group.aui.tsx
    - scanner: react
      file: web/src/components/assistant-ui/elements/tooltip-icon-button.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/elements/tooltip-icon-button.tsx
    - scanner: typescript
      file: web/src/components/assistant-ui/utils/href.ts
    - scanner: typescript
      file: web/src/hooks/use-attachment-src.ts
      symbol: useAttachmentSrc
  group: Conversation interface
  technology: Assistant UI
description: Presents streamed messages, reasoning, tool calls, attachments and media.
---

Assistant UI primitives provide the conversation surfaces. Markdown, attachment and artifact renderers turn agent output into useful content without a second chat implementation.
