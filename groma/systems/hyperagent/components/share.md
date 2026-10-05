---
type: C4 Component
title: Board sharing
status: stable
groma:
  id: share
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/share.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/workspaces.ts
      symbol: Route
    - scanner: typescript
      file: web/src/server/share-card.ts
      symbol: loadShareCard
    - scanner: typescript
      file: web/src/server/og-card.ts
      symbol: renderOgCard
    - scanner: typescript
      file: web/src/routes/api/og/$code.ts
      symbol: Route
    - scanner: typescript
      file: web/src/server/board-names.ts
      symbol: uniqueBoardName
  group: Web application
  technology: TanStack server routes, SVG
description: Creates shared board links and the previews used to introduce them.
---

Sharing resolves durable board records, membership and names. Open Graph handlers generate link previews from board content.
