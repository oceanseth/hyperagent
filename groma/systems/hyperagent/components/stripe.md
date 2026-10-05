---
type: C4 Component
title: Stripe account adapter
status: stable
groma:
  id: stripe
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/stripe.ts
  group: Platform integrations
  technology: Stripe API
description: Resolves supported Stripe account operations with configured credentials.
---

Stripe credentials support connected account operations. Stripe Atlas filing remains a browser workflow with explicit confirmation rather than an invented public formation API.
