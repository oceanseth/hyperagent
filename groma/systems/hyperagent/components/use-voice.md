---
type: C4 Component
title: Browser voice input
status: stable
groma:
  id: use-voice
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/hooks/use-voice.ts
  group: Conversation interface
  technology: Browser speech APIs
description: Connects browser speech input and spoken output to assistant turns.
---

Voice is another entry point into the shared assistant workspace. Speech capture and playback remain in the browser; the voice route handles the server turn.
