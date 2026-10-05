---
type: C4 Component
title: Source embed policy
status: stable
groma:
  id: embeddable
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/routes/api/embeddable.ts
      symbol: Route
  group: Web application
  technology: HTTP
description: Decides whether source content can be shown inline.
---

The source preview route handles embedding constraints while retaining original links for content that cannot be embedded.
