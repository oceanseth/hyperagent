# Hackalon

Shared instructions for Codex and Claude. Keep project guidance here; do not
create a separate `CLAUDE.md`.

## Environment

- Run `bin/setup-beads` once, then `direnv allow`.
- Use `direnv exec /Users/lou/hackalon <command>` when the shell has not loaded
  `.envrc`. This loads `.env`, selects the pinned `bin/bd`, and sets `BEADS_DIR`.
- Never print or commit `.env` values or credentials in local MCP configuration.
- There is no application build or test command yet.

## Task tracking

- Both agents use the same `.beads` store. Run `bd ready` before choosing work.
- Claim an issue with `bd update <id> --claim` before working on it. Respect work
  claimed by another session; do not reset, delete, or overwrite it.
- Record decisions and handoff notes in the issue. Close completed work with
  `bd close <id> --reason "..."`; leave unfinished work with clear next steps.
- After compaction, follow the Beads context injected by the lifecycle hooks.
- At session end, report issue IDs, validation, and remaining work. Do not commit
  or push merely because a generic Beads template suggests it.

## Unused harnesses

Pi and OpenCode are not used. Never create their project directories or install
skills, plugins, or MCP servers for them.
