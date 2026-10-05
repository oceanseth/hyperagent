---
type: C4 Component
title: KERNEL MCP client
status: stable
groma:
  id: kernel
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/kernel.ts
      symbol: createKernelClient
  group: Platform integrations
  technology: KERNEL MCP
description: Connects the assistant to KERNEL tool capabilities.
---

This client complements the browser session adapter by supplying browser tools to assistant requests when configured.
