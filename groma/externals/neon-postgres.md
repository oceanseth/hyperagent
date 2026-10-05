---
type: C4 System
title: Neon Postgres
description: Durable workspace state and job coordination.
status: stable
groma:
  id: neon-postgres
  technology: Neon Postgres
---

![Neon Postgres](https://hyperagent.lol/architecture/assets/neon.svg)

The app and worker persist canvas state, queue jobs, claim leases and record activity through the Neon serverless driver.
