---
type: Groma Project
title: Hyperagent · Architecture
groma:
  profile: architecture
description: One shared canvas. Eight building blocks. Agents whose work you can see.
---

Hyperagent turns a conversation into a shared workspace of cited research, live browsers and actionable plans.

Built with Assistant UI, Neon, Executor, AgentMail, Mastra, Exa, Fly.io and KERNEL. Follow the research and browser flows to see their roles in the actual implementation.

The web app runs on AWS App Runner; independent research and browser jobs run on a Fly.io Machine, with shared state in Neon Postgres and inference through Neon AI Gateway. This is a source-grounded architecture snapshot, not a live service-health report.

The current scanners do not infer the TanStack/Nitro or Fly worker container boundaries in this repository. Components are grouped by responsibility; the runtime boundaries are documented here and on the showcase.

[Open Hyperagent](https://hyperagent.lol/) · [Sponsor showcase](https://hyperagent.lol/architecture/index.html)
