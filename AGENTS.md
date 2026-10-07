# Hackalon

Shared instructions for Codex and Claude. Keep project guidance here; do not
create a separate `CLAUDE.md`.

## UI components

- Use Assistant UI for every UI component it provides. Check Assistant UI before
  building a custom component or choosing one from another library.
- Use custom components or another library only when Assistant UI does not
  provide the needed component.

## Delivery into dev

For Saida-managed work, follow the city delivery policy at
`/home/debian/saida/workflow/POLICY.md` and the Hyperagent rig override. This
section replaces the previous hackathon policy to skip tests and push dev
directly.

- Plan with the user, then implement approved work; an explicit "run this
  through" request also authorizes implementation. Each bead must carry a
  clear, approved contract with acceptance, scope, prerequisites and proofs.
- Work in a separate worktree and named branch based on current `origin/dev`.
  Run the rig setup script before implementation. Missing env files, services,
  dependencies or failing baseline tests block work.
- Own an isolated development environment per worktree. The documented hosted
  dev environment shares production resources and must not be used as a test
  baseline. Keep credentials out of Git, bead metadata and logs.
- Add meaningful stateful integration tests that exercise behavior and state
  transitions. Keep tests green; do not add tests that merely mirror code.
- Open a draft PR targeting `dev`, then obtain an independent review from a
  better model or higher reasoning effort. A fresh agent applies findings with
  the full bead, environment, diff and review context. Use at most three review
  rounds total, including reviews after rebase; escalate exhaustion to the user.
- Readiness requires current-head test and acceptance evidence, approved review,
  and all required PR CI checks passing. Only the Saida delivery integrator
  merges ready work into `dev`, using the city's serialized merge queue.
  Workers must push their feature branches rather than push `dev` directly.
- **Never push or merge `production` without explicit human instruction.**
  A push to `dev` triggers the existing deployment; production releases remain
  a separate decision.

## Shared beads on Saida

The existing `hackalon` database, project ID and issue history are preserved.
Saida uses a central Dolt server. Public clients connect with separate writer
accounts over verified TLS; no Tailscale membership is needed. See
`docs/saida-collaboration.md` and use `bin/beads-public.py` for this mode.

When using the central database, read/claim/update it directly. Do not run
`bd dolt pull`, `bd dolt push` or `bin/setup-beads` against it: the designated
city maintainer handles backup and `refs/dolt/data` publication. Embedded
clones can still use the existing setup and sync workflow, but live
collaborators should use the central database so claims are visible immediately.

## Environment

Tooling is pinned with [Hermit](https://cashapp.github.io/hermit/): `bd`
(Beads 1.3.0) and `dolt` (2.4.0) live in `bin/` and download themselves on
first use. Nothing to install globally; ignore any `bd` from Homebrew.

- New clone: run `bin/setup-beads` once. It installs the Beads git, Codex and
  Claude hooks, pulls the shared issues and prints `bd ready`.
- Activate the environment with `. bin/activate-hermit` (or `direnv allow`, or
  `hermit shell-hooks` for auto-activation). That puts the pinned tools on
  `PATH` and sets `BEADS_DIR`.
- Without activating, prefix commands with `bin/with-env`, which also loads
  `.env`. Launch agents with `bin/with-env codex` or `bin/with-env claude`.
- Codex hooks resolve the Git root and run its `bin/bd` directly.
  Keep `.codex/hooks.json` versioned; never run stock `bd setup codex`, which
  overwrites these commands with bare `bd` and brings back exit 127.
- Add a tool with `. bin/activate-hermit && hermit install <pkg>`; commit the
  new `bin/` symlinks.
- Never print or commit `.env` values or credentials in local MCP configuration.
- Build commands are documented in `web/README.md` and `macos/README.md`.

## Task tracking

- Both agents use the same `.beads` store. Run `bd ready` before choosing work.
- Claim an issue with `bd update <id> --claim` before working on it. Respect work
  claimed by another session; do not reset, delete, or overwrite it.
- Record decisions and handoff notes in the issue. Close completed work with
  `bd close <id> --reason "..."`; leave unfinished work with clear next steps.
- Repo: `oceanseth/hyperagent` is the shared hub (`origin`). Push code and
  Beads there. `oxfern/phab` is the old repo, kept as `upstream` in some clones.
- For embedded clones only, Beads sync through GitHub (`refs/dolt/data` on `oceanseth/hyperagent`). New clone:
  `bin/setup-beads`, then `bd dolt pull`. Run `bd dolt pull` before picking
  work and `bd dolt push` right after claiming or changing issues, so other
  agents see your claims quickly.
- Central server clients use the public helper instead of these embedded sync commands.
- After compaction, follow the Beads context injected by the lifecycle hooks.
- At session end, report issue IDs and remaining work, then commit, push, and
  deploy (see below).

## Unused harnesses

Pi and OpenCode are not used. Never create their project directories or install
skills, plugins, or MCP servers for them.

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->

<!-- groma:start -->
## Groma

Groma and Backlog are installed only in this project. Before architecture work,
run `npm run groma -- agent-instructions` and read the relevant guide. Use the
local CLI to curate Groma-owned Markdown. Generate the published map and guided
flows with `npm run architecture:generate`; preview with `npm run architecture:dev`.
The sponsor showcase is in `web/public/architecture/`. Beads remains the source
of truth for task tracking; do not duplicate its tasks in Backlog.
<!-- groma:end -->
