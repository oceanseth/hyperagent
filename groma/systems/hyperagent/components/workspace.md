---
type: C4 Component
title: Workspace sessions
status: stable
groma:
  id: workspace
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/workspace.ts
  group: Web application
  technology: HttpOnly cookies
description: Scopes requests to a workspace and enforces origin checks.
---

Workspace cookies bind canvas operations to a board. Origin checks protect state-changing requests from other websites.
