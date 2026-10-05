---
type: C4 Component
title: Cited source stacks
status: stable
groma:
  id: research-cards
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/research-cards.tsx
    - scanner: typescript
      file: web/src/components/canvas/research-cards.tsx
      symbol: ResearchCard
  group: Shared canvas
  technology: React, Assistant UI Markdown
description: Renders source cards and Markdown summaries with reusable context.
---

Sources can appear before research finishes. Cards preserve real source URLs and show working, complete or partial states; selected stacks become context for future turns.
