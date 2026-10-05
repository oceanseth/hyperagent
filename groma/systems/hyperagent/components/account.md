---
type: C4 Component
title: Google account sessions
status: stable
groma:
  id: account
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/account.ts
    - scanner: typescript
      file: web/src/routes/api/auth/me.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/auth/session.ts
      symbol: Route
    - scanner: typescript
      file: web/src/routes/api/auth/logout.ts
      symbol: Route
  group: Web application
  technology: Firebase Auth, signed cookies
description: Verifies Firebase identity and manages signed account sessions.
---

Google sign-in uses Firebase tokens. Server session endpoints verify identity and establish the account session used for board ownership and membership.
