---
type: C4 Component
title: Activity and traces
status: stable
groma:
  id: job-monitor
  parent: hyperagent
  code:
    - scanner: react
      file: web/src/components/canvas/job-monitor.tsx
    - scanner: typescript
      file: web/src/components/canvas/job-monitor.tsx
      symbol: JobMonitor
    - scanner: react
      file: web/src/components/canvas/monitor-widget.tsx
    - scanner: typescript
      file: web/src/components/canvas/monitor-widget.tsx
      symbol: MonitorWidget
    - scanner: react
      file: web/src/routes/monitor.tsx
    - scanner: typescript
      file: web/src/routes/monitor.tsx
      symbol: Route
    - scanner: typescript
      file: web/src/hooks/use-job-monitor.ts
    - scanner: typescript
      file: web/src/hooks/use-debug-report.ts
      symbol: useDebugReport
  group: Shared canvas
  technology: React, Neon job events
description: Shows job state, worker heartbeats, tool timings and redacted reports.
---

The monitor exposes recorded events from the actual worker. It supports diagnosis of tool failures without presenting a local development log as production telemetry.
