---
type: C4 System
title: Hyperagent
status: stable
groma:
  id: hyperagent
description: A collaborative canvas where agents research, browse and plan alongside people.
---

People share one workspace of conversations, source stacks, browser sessions and plans. Assistant UI presents the conversation, Mastra coordinates the agents, Neon provides storage and inference, Executor supplies connected tools, Exa supplies search, KERNEL supplies live browsers, Fly.io runs background work, and AgentMail provides optional per-agent inboxes.

Runtime boundaries: browser-based React client; TanStack/Nitro Node web app on AWS App Runner; a separate Node worker on Fly.io; and Neon Postgres. Shared modules may run in both server processes. Scanner limitations leave these as responsibility groups rather than invented container records.
