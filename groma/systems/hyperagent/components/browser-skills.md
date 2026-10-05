---
type: C4 Component
title: Browser skill operations
status: stable
groma:
  id: browser-skills
  parent: hyperagent
  code:
    - scanner: typescript
      file: web/src/server/browser-skills.ts
  group: Background execution
  technology: KERNEL Playwright Execution
description: Translates agent actions into KERNEL Playwright execution.
---

Page reading, navigation, clicking, typing, scrolling and screenshots operate on the existing live session. The agent and collaborators see the same browser.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [web/src/server/browser-skills.ts](../../../../web/src/server/browser-skills.ts) | [kernel-cloud](../../../externals/kernel-cloud.md) | Executes page operations | Playwright Execution |
