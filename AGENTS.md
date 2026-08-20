# AGENTS.md

This repository is designed to be edited by both humans and coding agents. Keep changes typed, testable, documented, and aligned with the product constraints below.

## Read this first

Before making a non-trivial change, read in this order:

1. `README.md` — product/repository entry point.
2. `docs/README.md` — documentation map and source-of-truth rules.
3. `docs/status.md` — current implemented state and known gaps.
4. The canonical document for the subsystem you are changing.
5. The implementation and tests for that subsystem.

Do not reconstruct the current system from old commits, closed PRs, or superseded design notes unless you are investigating a regression. `main` should describe the system as it exists now.

## Product invariant

Waitloop is a waiting layer for coding agents, not an engagement platform. When an agent requires attention, work takes priority over any game or secondary experience.

## Architecture invariant

Platform-specific lifecycle details belong in `integrations/`. Core packages consume canonical Waitloop events only.

- `packages/protocol`: wire-level contracts and validation helpers
- `packages/game-core`: game-agnostic contracts
- `packages/doudizhu`: Dou Dizhu rules and state transitions
- `packages/cli`: local CLI, pairing, lifecycle installers, room join-code exchange
- `worker`: Cloudflare APIs, Durable Objects, hosted agents, join and MCP boundaries
- `apps/web`: presentation only; it must not become the source of truth for game state
- `integrations`: Codex, Claude Code, Cursor, DSH, and future adapters

Do not import from an integration into a core package.

## Privacy invariant

The core waiting flow must not require source code, prompts, repository contents, filenames, tool arguments, terminal output, transcripts, assistant output, or native agent session IDs.

If a proposed feature needs additional user data, document the data flow and threat model before implementation.

## Game invariant

Games implement contracts in `packages/game-core`. The generic room layer must not contain Dou Dizhu-specific branching.

For hidden-information games, never expose private state belonging to another player. Public views must be constructed explicitly. Lobby/waiting projections must not leak hands, landlord assignment, or other pre-start private state.

Humans and machine players intentionally use different interaction projections:

- browser humans submit card selections through `/play`, `/pass`, and `/hint` and do not receive exhaustive `legalMoves[]`;
- hosted/MCP agents select server-generated move IDs;
- the server remains authoritative for legality, turn ordering, and hidden information.

## MCP invariant

MCP is for agent participation in a game. It is not the primary mechanism for detecting whether a coding agent is running, waiting, completed, or failed.

A game MCP seat is temporary and room-scoped. Prefer stable, constrained tool inputs:

```text
get_turn()
play_move(expectedRevision, moveId)
```

Room ID and seat credentials belong to the transport/auth boundary, not model-visible tool arguments.

## Documentation model

Documentation on `main` describes **current durable truth**, not the chronology of how the design evolved.

### Keep on main

Keep documents that remain authoritative over time: product intent, architecture, protocol, security, current game rules, CLI/MCP behavior, pairing, hosted agents, design language, release procedure, current status, and forward roadmap.

### Do not keep on main

Do not leave implementation-stage documents such as `*-v2.md`, design drafts, migration scratchpads, temporary implementation plans, or completed phase notes after the feature lands.

Use an issue/PR description for temporary planning. When the implementation is merged:

1. extract durable decisions into the relevant canonical document;
2. update `docs/status.md` and `docs/roadmap.md` if the current state or next priorities changed;
3. delete the transitional document.

Do not keep both a canonical document and a historical design document that describe the same behavior differently.

### Source-of-truth precedence

When code/tests and documentation disagree, code + tests describe runtime reality and the documentation is stale. Fix the documentation in the same change. Do not preserve stale prose for historical context.

Avoid duplicating exact values that have a machine-readable authority. In particular, the exact CLI package version belongs in `packages/cli/package.json` and `apps/web/public/agent.json`. Human-facing docs should normally use the channel install command `npm install -g @waitloop/cli@alpha` rather than hard-coding a release number.

## Public Agent surface is an API

These files are product-facing compatibility surfaces, not incidental docs:

```text
apps/web/public/agent.md
apps/web/public/agent.json
apps/web/public/llms.txt
apps/web/public/skills/waitloop/SKILL.md
worker/src/mcp.ts
packages/cli
```

Changing installation, pairing, join flow, MCP tools, lifecycle support, public endpoints, or capability status requires checking the full surface for consistency.

`agent.md` is the stable universal integration guide. `/join/<code>` is room-specific onboarding. `agent.json` is the machine-readable capability manifest. `llms.txt` is discovery. `SKILL.md` is credential-free operating guidance.

## Change completeness matrix

Before considering a change complete, check the relevant row(s):

| Change | Also inspect/update |
| --- | --- |
| CLI command/install/release behavior | `packages/cli/README.md`, `docs/cli.md`, `agent.md`, `agent.json`, `SKILL.md`, release docs/tests |
| Join-code or connected-agent flow | room/join Worker code, CLI join, web lobby/join UI, `docs/mcp.md`, `docs/cli.md`, `agent.md`, `agent.json`, `SKILL.md`, `llms.txt` |
| MCP tool/auth behavior | MCP + GameRoom tests, `docs/mcp.md`, `docs/protocol.md`, `docs/security.md`, `agent.md`, `agent.json`, `SKILL.md` |
| Lifecycle adapter/support status | integration + CLI tests, `docs/protocol.md`, `docs/cli.md`, `status.md`, `agent.md`, `agent.json`, `SKILL.md` |
| Public endpoint or discovery URL | Worker/static routing, `agent.md`, `agent.json`, `llms.txt`, `SKILL.md`, relevant docs |
| Game rule change | pure rules tests, `docs/doudizhu-rules.md`, `docs/game-system.md` if the generic boundary changes |
| Human game projection/UI | browser JS validation, hidden-information regression tests, `docs/game-system.md`, `docs/design.md` |
| Auth/privacy/security behavior | boundary tests, `docs/security.md`, relevant protocol/CLI/MCP docs and public Agent guidance |
| Architecture/module boundary | `docs/architecture.md`, `docs/status.md`, repository map if needed |

If several rows apply, satisfy all of them.

## Testing contract

A feature is not complete because one happy-path test passes.

- Every rules bug gets a regression test.
- Every new trust boundary gets invalid-input tests.
- Hidden-information changes get explicit non-leakage tests.
- Stale/out-of-turn mutations remain rejected.
- CLI behavior gets CLI tests and npm package validation when packaging is affected.
- Browser changes must pass JavaScript syntax validation and should cover pure presentation logic with tests where practical.
- Public Agent surface changes must pass the repository-contract validator.
- Worker changes must pass Wrangler dry-run bundling.

Do not weaken a test to make an implementation pass unless the documented contract itself intentionally changed.

## Engineering conventions

- TypeScript strict mode.
- Avoid `any`; use `unknown` plus validation at trust boundaries.
- Prefer small modules with explicit dependencies.
- Domain logic is pure where practical and must not depend on Cloudflare runtime globals.
- Validate external input before state mutation.
- Reject stale or out-of-turn game mutations.
- No production secrets in the repository.
- Keep dependencies minimal and justified.
- Prefer refactoring a growing responsibility boundary before adding another unrelated branch to a large entry-point file.

## Required checks

Before merging a non-trivial change, run or rely on CI for:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
```

CI additionally validates browser JavaScript and performs `wrangler deploy --dry-run`.

## Commit order

When implementing a new capability, prefer this order:

1. identify/update the durable contract;
2. add or update shared types;
3. implement pure domain logic;
4. add regression/boundary tests;
5. add runtime/API wiring;
6. add UI/platform adapter;
7. synchronize public Agent surfaces and canonical docs;
8. remove superseded transitional notes;
9. run the complete validation set.

Do not bypass layers just to make a demo work.