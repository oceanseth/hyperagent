---
type: C4 System
title: Executor
description: Connected tools behind one MCP gateway.
status: stable
groma:
  id: executor
  technology: MCP over HTTPS
---

![Executor](https://hyperagent.lol/architecture/assets/executor.png)

The app discovers connected service tools per request or job, including Exa search and KERNEL browser operations.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [executor](executor.md) | [exa](exa.md) | Runs web search | Connected tool |
