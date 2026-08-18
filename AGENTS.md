# AGENTS.md

This repository is designed to be edited by both humans and coding agents. Keep changes small, typed, testable, and aligned with the product constraints below.

## Product invariant

Waitloop is a waiting layer for coding agents, not an engagement platform. When an agent requires attention, work takes priority over any game or secondary experience.

## Architecture invariant

Platform-specific lifecycle details belong in `integrations/`. Core packages consume canonical Waitloop events only.

- `packages/protocol`: wire-level contracts and validation helpers
- `packages/game-core`: game-agnostic contracts
- `packages/doudizhu`: Dou Dizhu rules and state transitions
- `worker`: Cloudflare entry point, APIs, Durable Objects, and MCP boundary
- `apps/web`: presentation only; it must not become the source of truth for game state
- `integrations`: Codex, Claude Code, Cursor, DSH, and future adapters

Do not import from an integration into a core package.

## Privacy invariant

The core waiting flow must not require source code, prompts, repository contents, filenames, tool arguments, or terminal output. Agent lifecycle events should contain only the minimum metadata needed to represent status.

If a proposed feature needs additional user data, document the data flow and threat model before implementation.

## Game invariant

Games implement the contracts in `packages/game-core`. The generic room layer must not contain Dou Dizhu-specific branching.

For hidden-information games, never expose private state belonging to another player. Public views must be produced explicitly; do not serialize internal state and delete fields afterward.

## MCP invariant

MCP is for agent participation in a game. It is not the primary mechanism for detecting whether a coding agent is running, waiting, completed, or failed.

Prefer stable, constrained tool inputs. For game turns, expose generated legal move IDs and accept `moveId` instead of asking a model to reconstruct complex move payloads.

## Engineering conventions

- TypeScript strict mode.
- Avoid `any`; use `unknown` plus validation at trust boundaries.
- Prefer small modules with explicit dependencies.
- Domain logic is pure where practical and must not depend on Cloudflare runtime globals.
- Validate external input before state mutation.
- Reject stale or out-of-turn game mutations.
- Every rules bug gets a regression test.
- No production secrets in the repository.
- Keep dependencies minimal and justified.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

Before committing, run typecheck and relevant tests. If a runtime-dependent integration cannot be exercised locally, state that explicitly in the commit or PR notes.

## Commit order

When implementing a new capability, prefer this order:

1. document the contract or invariant
2. add or update shared types
3. implement pure domain logic
4. add tests
5. add runtime/API wiring
6. add UI or platform adapter

Do not bypass layers just to make a demo work.
