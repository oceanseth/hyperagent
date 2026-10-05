---
type: Groma Flow
title: Watch an agent use the browser
groma:
  id: watch-an-agent-use-the-browser
---

A teammate and agent share one visible KERNEL session while the Fly.io worker performs the task.

## Steps

| From | To | Action |
| --- | --- | --- |
| [collaborator](../actors/collaborator.md) | [canvas-composer](../systems/hyperagent/components/canvas-composer.md) | Ask the assistant to open a website. |
| [chat](../systems/hyperagent/components/chat.md) | [assistant-tools](../systems/hyperagent/components/assistant-tools.md) | Load browser capabilities. |
| [assistant-tools](../systems/hyperagent/components/assistant-tools.md) | [browser-tools](../systems/hyperagent/components/browser-tools.md) | Expose browser creation and task tools. |
| [browser-tools](../systems/hyperagent/components/browser-tools.md) | [browser-canvas](../systems/hyperagent/components/browser-canvas.md) | Persist and open a shared browser card. |
| [browser-canvas](../systems/hyperagent/components/browser-canvas.md) | [kernel-browser](../systems/hyperagent/components/kernel-browser.md) | Request a live cloud session. |
| [kernel-browser](../systems/hyperagent/components/kernel-browser.md) | [kernel-cloud](../externals/kernel-cloud.md) | Create the browser through the configured connection. |
| [browser-card](../systems/hyperagent/components/browser-card.md) | [kernel-cloud](../externals/kernel-cloud.md) | Show the same live session to collaborators. |
| [browser-card](../systems/hyperagent/components/browser-card.md) | [browsers](../systems/hyperagent/components/browsers.md) | Submit a task from the card. |
| [browsers](../systems/hyperagent/components/browsers.md) | [browser-canvas](../systems/hyperagent/components/browser-canvas.md) | Queue the browser job. |
| [browser-canvas](../systems/hyperagent/components/browser-canvas.md) | [dispatch](../systems/hyperagent/components/dispatch.md) | Wake the worker. |
| [dispatch](../systems/hyperagent/components/dispatch.md) | [worker-index](../systems/hyperagent/components/worker-index.md) | Signal the durable job. |
| [worker-index](../systems/hyperagent/components/worker-index.md) | [browser-agent](../systems/hyperagent/components/browser-agent.md) | Run the Mastra browser agent. |
| [browser-agent](../systems/hyperagent/components/browser-agent.md) | [browser-skills](../systems/hyperagent/components/browser-skills.md) | Choose the next page operation. |
| [browser-skills](../systems/hyperagent/components/browser-skills.md) | [kernel-cloud](../externals/kernel-cloud.md) | Perform the operation in the visible session. |
| [browser-agent](../systems/hyperagent/components/browser-agent.md) | [canvas-db](../systems/hyperagent/components/canvas-db.md) | Record progress and publish the result. |
