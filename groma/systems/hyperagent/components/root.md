---
type: C4 Component
title: Application shell and board routes
status: stable
groma:
  id: root
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/routes/__root.tsx
    - scanner: typescript
      file: web/src/routes/__root.tsx
      symbol: Route
    - scanner: react
      file: web/src/router.tsx
    - scanner: typescript
      file: web/src/router.tsx
      symbol: getRouter
    - scanner: react
      file: web/src/routes/index.tsx
    - scanner: typescript
      file: web/src/routes/index.tsx
      symbol: Route
    - scanner: react
      file: web/src/routes/p.$slug.tsx
    - scanner: typescript
      file: web/src/routes/p.$slug.tsx
      symbol: Route
    - scanner: react
      file: web/src/routes/s.$code.tsx
    - scanner: typescript
      file: web/src/routes/s.$code.tsx
      symbol: Route
    - scanner: react
      file: web/src/routes/boards.tsx
    - scanner: typescript
      file: web/src/routes/boards.tsx
      symbol: Route
  group: Web application
  technology: TanStack Start, TanStack Router
description: Loads the app shell and the personal or shared board experience.
---

The Node web application serves the React shell and board routes. Shared links resolve board membership and load the same canvas workspace for collaborators.
