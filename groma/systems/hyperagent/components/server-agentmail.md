---
type: C4 Component
title: AgentMail inboxes
status: stable
groma:
  id: server-agentmail
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/agentmail.ts
    - scanner: typescript
      file: web/src/routes/api/agentmail.ts
      symbol: Route
  group: Platform integrations
  technology: AgentMail REST API
description: Provisions per-agent inboxes and exposes mail operations to workspace routes.
---

The integration can create or reuse agent inboxes, list messages and send mail when configured. Provisioning reports per-agent failures; a logo on the showcase does not imply a mail send was executed.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/agentmail.ts](../../../../web/src/server/agentmail.ts) | [agentmail](../../../externals/agentmail.md) | Provisions agent inboxes | REST |
