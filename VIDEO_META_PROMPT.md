# Phab hackathon video — meta prompt

You are preparing a short product demo for hackathon judges seeing Phab for the
first time. The product is evolving while we build it. Discover what exists now
before deciding what to show. This document captures the narrative intent, not
a frozen feature list, implementation status, or finished script.

**Default deliverable: a video plan and production prompt only. Do not generate,
record, edit, render, or publish a video until explicitly asked to produce it.**

## Inspect the current product first

1. Read the repository's `AGENTS.md`, `HACKATHON.md`, relevant READMEs, recent Git
   history, and current diff. Respect concurrent work and the project's no-tests
   rule. Do not expose secrets or change the application to make the demo work.
2. Read relevant Beads issues and handoff notes. Starting points from the initial
   build are `hackalon-hya` (research, canvas, context stacks) and `hackalon-av0`
   (Cosmos integration); follow newer issues if these have been superseded.
3. Trace the actual flow through the code: composer/voice → assistant → job
   dispatch → worker/tools → saved results → canvas → follow-up context. Locate
   current files instead of assuming these paths or boundaries remain fixed.
   Useful starting points are `web/src/assistant.tsx`, `web/src/mastra/`,
   `web/src/routes/api/`, `web/src/server/`, `web/worker/`,
   `web/src/hooks/`, and `web/src/components/canvas/`. Cosmos API source material
   is under `cosmos/`.
4. Inspect deployment configuration and the current live product when accessible.
   The initial public URL is https://phab.oxwilde.workers.dev/; confirm it is still
   current. Distinguish local edits, committed code, deployed code, and behavior
   actually observed. If access is unavailable, state what remains unconfirmed.
5. If another implementation agent is available, read its relevant task context
   and ask for current status when communication is authorized. Treat plans and
   agent reports as leads to corroborate, not proof of shipped functionality.
6. Recheck before recording: this repo can change between writing the script and
   making the video. Adapt the story to the latest coherent, supported flow.

Make a compact evidence table for the producer: candidate capability, source
file/issue, deployment or observation evidence, and whether it can be shown as
working, must be labeled as a concept, or should be omitted. This is production
grounding, not material to read aloud in the video.

## Preserve the product's central idea

Phab is a personal assistant with a persistent spatial workspace. The user
thinks and talks with the assistant while it delegates work to tools or other
agents. Useful results become visible, connected material on an infinite canvas.

The human-facing assistant should remain an available orchestrator. A long
search should not monopolize the conversation. Show that distinction through
visible behavior, without promising that software can never freeze.

The intended progression is:

**Ask naturally → delegate work → keep the conversation going → receive real
source cards and a connected synthesis → reuse that context for the next task.**

The canvas is useful because people can inspect sources, understand connections,
and build on previous work. Explain that value in everyday language before
introducing terms such as "context stacks" or technical architecture.

Possible closing line: **"Keep thinking while your agents work."**

Treat these as product intentions until the current implementation supports
them. If a central interaction is unfinished, identify the missing footage or
label a brief concept segment; do not script it as a completed live demo.

## Choose the strongest real demo

Prefer one continuous user story over a tour of disconnected features.

- **Visual research candidate:** ask Cosmos for a small set of coffee-brand
  references, bring actual images and source links onto the canvas, connect a
  summary, and use selected context to compare creative directions.
- **Document research candidate:** ask connected research tools for a few papers
  about a topic, show real document/PDF cards and a connected synthesis, then
  ask a follow-up grounded in those sources.

These are examples, not hardcoded requirements. Choose whichever current flow
best demonstrates the product reliably and honestly. Use actual returned titles,
images, documents, and findings. Do not invent citations, documents, results,
tool connections, or assistant responses to fill gaps.

Make the key moment unmistakable: while a delegated task is visibly in progress,
the user sends another message and the assistant responds. Then show the results
arriving separately on the canvas. If this is not implemented yet, report that
instead of faking simultaneous execution in the edit.

Show context reuse through the product's real selection/include mechanism. Only
show voice-driven research if voice actually reaches the research tools. Only
claim jobs survive closing the tab or shutting down the computer if the hosted
execution path supports it and current evidence establishes it.

## Shape the video

- **Hard limit:** strictly less than three minutes, including title and end card.
  Aim for about 2:20. If current submission rules specify a tighter limit, use it.
- Use natural narration, readable product footage, restrained zooms, and quiet
  music. Preserve the app's actual visual identity; do not fabricate its UI.
- Suggested pacing, adaptable to the chosen flow:
  - 0:00–0:15: relatable problem and Phab's promise.
  - 0:15–0:35: one natural request and delegation acknowledgement.
  - 0:35–0:55: continue talking while work proceeds.
  - 0:55–1:25: source cards arrive; inspect one and its connected summary.
  - 1:25–1:55: use the accumulated context for a meaningful follow-up.
  - 1:55–2:10: briefly explain broader usefulness or the execution model.
  - 2:10–2:20: populated canvas, assistant available, concise closing line.
- Keep narration within a realistic word budget, allowing time to see results.
  Label sped-up or time-skipped waits instead of implying artificial latency.
- Mention technologies only when they clarify the product or satisfy current
  submission requirements. Assistant UI, Neon AI Gateway, Mastra, Executor, Neon,
  Cloudflare, Cosmos, and Fly.io are investigation leads, not guaranteed credits.
  Verify each one's actual role; configuration or an installed package alone
  does not prove it powers the deployed demo.

## Return a production-ready handoff

After inspecting, provide:

1. A short description of what Phab currently does, grounded in the evidence.
2. The chosen user story and why it demonstrates the core value.
3. A timed storyboard pairing screen action, exact narration, and on-screen text.
4. Specific footage/assets needed and any unfinished or unconfirmed interactions.
5. A copy-ready production prompt reflecting the current implementation, with
   target duration, visual direction, and constraints against fabricated behavior.

Identify the repository commit and inspection date, plus any relevant uncommitted
changes and known deployment version, so the producer can recheck for drift.
Prepare this handoff first. Video production begins only when explicitly requested.
