# AGENTS.md

This repository is edited by humans and coding agents. Keep changes typed, testable, documented, and aligned with the current product contract.

## Read this first

For non-trivial work, read in this order:

1. `README.md` — product/repository entry point.
2. `docs/README.md` — canonical-document map and source-of-truth rules.
3. `docs/status.md` — current implementation and known gaps.
4. The canonical document(s) for the subsystem you are changing.
5. The implementation and tests.

Do not reconstruct current behavior from old commits, closed PRs, or superseded design notes unless investigating a regression. `main` describes the system as it exists now.

## Product invariant

Waitloop is a waiting layer for coding agents, not an engagement platform. Coding-agent attention always takes priority over a game/secondary experience.

## Architecture invariant

- `packages/protocol`: canonical lifecycle contracts/validation.
- `packages/game-core`: pure game-agnostic state/room contracts.
- `packages/doudizhu`: pure Dou Dizhu rules/transitions.
- `packages/cli`: local CLI, pairing, lifecycle installers, Join convenience.
- `worker`: Cloudflare HTTP control plane, Durable Objects, hosted runtime, Join and MCP boundaries.
- `apps/web`: Human presentation only; never source of truth.
- `integrations`: vendor-specific coding-agent lifecycle adapters.

Do not import integration/vendor semantics into core packages. Web/CLI/MCP clients must converge on the same server-authoritative room/runtime rather than reimplement business rules.

## Privacy invariant

Core lifecycle reporting must not require source code, prompts, repository contents/paths, filenames, cwd, tool arguments/output, terminal output, transcripts, assistant output, model reasoning, or native agent session/turn IDs.

If a feature needs more user data, document the data flow, consent, and threat model before implementation.

## Game identity invariant

**Seat is not Actor. Actor is not automatically Controller.**

```text
Seat       one actual game player position / hand / role / history
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to mutate that Seat
Advisor    Actor explicitly bound to a Seat that may inspect/comment but not play until delegated
```

Game packages see Seat IDs only. They must not branch on Codex, Claude, MCP, browser, advisor, or provider concepts.

Runtime authorization is capability-based. Relevant capabilities include:

```text
room:view-public
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

Only the Seat's active Controller gets `seat:play`. The Seat owner retains `seat:control`. Delegating control changes authorization only; it must not change the Seat's hand, role, history, or ownership.

An advisor may see the private state of the **single Seat it was explicitly bound to**. Never generalize that grant to another Seat or spectator-wide hidden information.

## Game projection invariant

For hidden-information games, construct viewer projections explicitly. Never serialize internal state and delete private fields afterward.

- Browser Humans use `/play`, `/pass`, `/hint` and do not receive exhaustive machine `legalMoves[]`.
- Human projection can keep the owner's private hand visible while control is delegated, but mutation controls must disable when `seat:play` is absent.
- Hosted/connected Actors select server-generated move IDs.
- Lobby projection must not expose dealt hand/landlord before connected readiness.
- Stale, out-of-turn, illegal, and non-controller mutations must be rejected server-side.

## MCP invariant

MCP is game participation, not coding-agent lifecycle detection.

The fixed MCP endpoint is transport-bound to one room-scoped Actor capability. Model-visible tools stay constrained:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

Room ID, Actor token, Seat binding, and Controller authority are resolved outside tool arguments.

`comment` is a side channel. It must never alter game state, game revision, turn order, or legal moves.

## Client-neutral control plane

Web is not required for operations that do not inherently need Human UI. Room creation and Join must remain usable headlessly through HTTP/CLI/Agent clients.

Current examples:

```text
connected-agent   Human and Agent on separate Seats
companion-agent   Agent advisor bound to Human Seat
agent-bots        Agent controls own Seat against two bots; fully headless
```

Do not make browser cookies/UI a hidden dependency of Agent-only create/join/play flows.

## Documentation model

Documentation on `main` describes **current durable truth**, not design chronology.

Keep long-lived canonical docs: product intent, architecture, protocol, security, current rules, CLI/MCP/Join behavior, pairing, hosted agents, design language, release process, current status, and future roadmap.

Do not leave permanent `*-v2.md`, design drafts, migration scratchpads, or completed phase notes after a feature lands. Use issues/PR descriptions or short-lived branch notes for implementation planning. On merge:

1. extract durable decisions into canonical docs;
2. update `docs/status.md` / `docs/roadmap.md` when relevant;
3. remove transitional material.

When code/tests and docs disagree, code/tests describe runtime reality and the docs are stale. Fix the docs in the same change.

Avoid duplicating changing machine-authoritative values. Exact CLI version belongs in `packages/cli/package.json` and `apps/web/public/agent.json`; stable docs should normally use `npm install -g @waitloop/cli@alpha`.

## Public Agent surface is an API

These are compatibility surfaces, not incidental docs:

```text
apps/web/public/agent.md
apps/web/public/agent.json
apps/web/public/llms.txt
apps/web/public/skills/waitloop/SKILL.md
worker/src/mcp.ts
worker/src/room-api.ts
packages/cli
```

Changing Room modes, Join semantics, MCP tools, Actor capabilities, installation/pairing, lifecycle support, public endpoints, or capability status requires checking the entire relevant surface.

`agent.md` is universal guidance; `agent.json` is machine capability truth; `llms.txt` is discovery; Skill is credential-free operating guidance; `/join/<code>` is one temporary Actor binding.

## Change completeness matrix

| Change | Also inspect/update |
| --- | --- |
| CLI/install/release | CLI tests/readme, `docs/cli.md`, `agent.md`, `agent.json`, Skill, release docs |
| Room modes / Join / connected Actor | Room/Join runtime, Web when Human-facing, CLI compatibility, `game-system.md`, `mcp.md`, protocol/security, all Agent surfaces |
| Seat/Actor/Binding/Controller capability | pure capability tests, GameRoom authorization, Human projection, architecture/game/protocol/security/design/status docs, Agent surfaces |
| MCP tool/auth | MCP + runtime tests, `docs/mcp.md`, protocol/security, `agent.md`, `agent.json`, Skill, `llms.txt` |
| Lifecycle adapter/support | integration + CLI tests, protocol/CLI/status docs, Agent surfaces |
| Game rule | pure rules regression tests, `doudizhu-rules.md`; `game-system.md` only if generic boundary changes |
| Human UI/projection | browser JS validation, privacy/non-leakage tests, `game-system.md`, `design.md` |
| Public endpoint/discovery URL | Worker/static routing, Agent surfaces, canonical protocol/docs |
| Auth/privacy | negative/boundary tests, `security.md`, protocol/CLI/MCP/Agent docs |
| Architecture/module boundary | `architecture.md`, `status.md`, repository map if needed |

If several rows apply, satisfy all of them.

## Testing contract

A feature is not complete because one happy path works.

- Rules bugs get regression tests.
- New trust/capability boundaries get invalid-input/denial tests.
- Hidden-information changes get explicit non-leakage tests.
- Controller/delegation changes must prove only the active Controller can mutate a Seat.
- Comments/side channels must prove they do not mutate game revision/state semantics.
- CLI packaging changes run npm package validation.
- Browser changes pass JS syntax validation and should isolate pure presentation logic for tests where practical.
- Public Agent changes pass `pnpm check:repo-contract`.
- Worker changes pass Wrangler dry-run.

Do not weaken tests merely to fit an implementation unless the documented contract intentionally changed.

## Engineering conventions

- TypeScript strict mode; avoid `any`, validate `unknown` at trust boundaries.
- Prefer small modules with explicit responsibilities/dependencies.
- Pure domain logic must not depend on Cloudflare/browser globals where practical.
- Validate input before mutation.
- Reject stale/out-of-turn/non-controller actions.
- No production secrets in the repository.
- Keep dependencies minimal/justified.
- Refactor a responsibility boundary before repeatedly adding unrelated special cases to a large file.

## Refactoring cycle

Early code may optimize for proving a product contract; it is not automatically permanent architecture.

```text
small correct implementation
  -> real usage/features
  -> patch pressure appears
  -> stable responsibilities emerge
  -> structural refactor
  -> stronger tests + canonical docs
  -> continue feature work
```

Refactor based on structural evidence, not a calendar. Patch-pressure signals include repeated unrelated branches in one file, mixed protocol/auth/domain/persistence/presentation responsibility, duplicated validation/state transitions, features bypassing abstractions, tests becoming only end-to-end, docs no longer matching module ownership, or a new Agent needing substantial historical context to understand the current shape.

Prefer local refactors when boundaries are obvious. For structural refactors:

1. identify behavior/contracts that must stay stable;
2. strengthen tests first;
3. move responsibilities without unnecessary product changes;
4. update canonical architecture/status/docs;
5. remove superseded compatibility/transitional paths when migration is complete.

Do not abstract after one occurrence. Implement the first case, observe the second, and extract when repetition/responsibility are actually stable.

## Required checks

Before merging non-trivial work, run or rely on CI for:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
```

CI additionally validates browser JavaScript and `wrangler deploy --dry-run`.

## Preferred implementation order

1. identify/update durable contract;
2. add/update shared types;
3. implement pure domain/capability logic;
4. add regression/negative tests;
5. wire runtime/API;
6. wire UI/platform adapter;
7. synchronize public Agent surfaces + canonical docs;
8. remove superseded transition material;
9. run complete validation.

Do not bypass layers merely to make a demo work.
