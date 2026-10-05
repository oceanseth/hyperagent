---
type: C4 Component
title: Live browser cards
status: stable
groma:
  id: browser-card
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/browser-card.tsx
    - scanner: typescript
      file: web/src/components/canvas/browser-card.tsx
      symbol: BrowserCard
  group: Shared canvas
  technology: React, iframe
description: Embeds KERNEL live views with task input and visible agent progress.
---

A browser card displays the cloud session shared by everyone on the board. Task input queues a browser-agent job and shows its progress without hiding the live browser.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/components/canvas/browser-card.tsx](../../../../web/src/components/canvas/browser-card.tsx) | [kernel-cloud](../../../externals/kernel-cloud.md) | Embeds live session | iframe |
| [web/src/components/canvas/browser-card.tsx](../../../../web/src/components/canvas/browser-card.tsx) | [web/src/routes/api/browsers.ts](../../../../web/src/routes/api/browsers.ts) | Submits browser task | HTTP |
