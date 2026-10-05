---
type: C4 Actor
title: Collaborator
description: Researches, talks and works with others on one board.
status: stable
groma:
  id: collaborator
---

A teammate brings a question or task to the shared canvas, inspects sources and watches browser agents work. Text and voice use the same workspace.

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [collaborator](collaborator.md) | [web/src/components/canvas/infinite-canvas.tsx](../../web/src/components/canvas/infinite-canvas.tsx) | Works on shared board | Browser |
| [collaborator](collaborator.md) | [web/src/components/canvas/canvas-composer.tsx](../../web/src/components/canvas/canvas-composer.tsx) | Asks a question | Text or voice |
