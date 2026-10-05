---
type: C4 Component
title: Product introduction
status: stable
groma:
  id: about
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/routes/about.tsx
    - scanner: typescript
      file: web/src/routes/about.tsx
      symbol: Route
    - scanner: react
      file: web/src/components/canvas/welcome-dialog.tsx
    - scanner: typescript
      file: web/src/components/canvas/welcome-dialog.tsx
      symbol: WelcomeDialog
  group: Web application
  technology: React, HTML video
description: Explains Hyperagent through the product page and welcome film.
---

The about page and first-visit dialog introduce the shared canvas and show the project explainer film.
