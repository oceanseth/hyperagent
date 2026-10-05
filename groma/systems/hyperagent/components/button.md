---
type: C4 Component
title: Interface primitives
status: stable
groma:
  id: button
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/ui/button.tsx
    - scanner: typescript
      file: web/src/components/ui/button.tsx
    - scanner: react
      file: web/src/components/ui/avatar.tsx
    - scanner: typescript
      file: web/src/components/ui/avatar.tsx
    - scanner: react
      file: web/src/components/ui/collapsible.tsx
    - scanner: typescript
      file: web/src/components/ui/collapsible.tsx
    - scanner: react
      file: web/src/components/ui/dialog.tsx
    - scanner: typescript
      file: web/src/components/ui/dialog.tsx
    - scanner: react
      file: web/src/components/ui/skeleton.tsx
    - scanner: typescript
      file: web/src/components/ui/skeleton.tsx
      symbol: Skeleton
    - scanner: react
      file: web/src/components/ui/textarea.tsx
    - scanner: typescript
      file: web/src/components/ui/textarea.tsx
      symbol: Textarea
    - scanner: react
      file: web/src/components/ui/tooltip.tsx
    - scanner: typescript
      file: web/src/components/ui/tooltip.tsx
    - scanner: typescript
      file: web/src/lib/utils.ts
    - scanner: typescript
      file: web/src/hooks/use-copy-to-clipboard.ts
  group: Conversation interface
  technology: React, Base UI
description: Supplies shared controls, surfaces and interaction helpers.
---

Reusable button, dialog, avatar, tooltip, text input and loading primitives support the app. Shared presentation and clipboard helpers keep interactions consistent.
