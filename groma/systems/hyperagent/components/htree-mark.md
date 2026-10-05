---
type: C4 Component
title: Hyperagent identity
status: stable
groma:
  id: htree-mark
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/brand/htree-mark.tsx
    - scanner: typescript
      file: web/src/components/brand/htree-mark.tsx
      symbol: HTreeMark
    - scanner: typescript
      file: web/src/lib/htree.ts
    - scanner: react
      file: web/src/components/brand/htree-thinking.tsx
    - scanner: typescript
      file: web/src/components/brand/htree-thinking.tsx
  group: Conversation interface
  technology: React, SVG
description: Draws the recursive H-tree mark and thinking animation.
---

The same recursive geometry supplies the app identity and the assistant activity treatment.
