# AGENTS.md

This repository is edited by humans and coding agents. Keep changes typed, testable, documented, and aligned with the current product contract.

## Read this first

For non-trivial work read, in order:

1. `README.md`
2. `docs/README.md`
3. `docs/status.md`
4. canonical docs for the subsystem
5. implementation + tests

Do not reconstruct current behavior from old PRs/commits/superseded design notes unless investigating a regression. `main` describes current durable truth.

## Product invariant

Waitloop is a waiting layer for coding agents, not an engagement product. Coding-work attention always outranks the game.

## Architecture invariant

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local convenience/integration
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, MCP, hosted inference
apps/web                 Human presentation + public Agent surfaces
```

Web/CLI/MCP/Agent HTTP must converge on the same server runtime rather than duplicate rules/authorization.

## Privacy invariant

Core lifecycle reporting must not require prompt/source/repository/cwd/transcript/tool/terminal/assistant/native-session content.

If a feature needs more user data, document consent/data-flow/threat model first.

## Game identity invariant

**Seat != Actor != Controller. Identifier != credential.**

```text
Room       one active runtime/game instance
Seat       stable room-scoped player position / hand / role / history
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat
Controller Actor currently allowed to mutate Seat
Advisor    bound Actor that may inspect/comment but not play until delegated
```

New Dou Dizhu Rooms use stable `seat-1`, `seat-2`, `seat-3`. Controller changes must never rewrite Seat ID/hand/role/history/owner.

Relevant capabilities:

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

Only active Controller gets `seat:play`; Seat owner keeps `seat:control`; Room owner gets `room:manage`. Advisor private view is limited to its explicitly bound Seat.

Game packages see Seat IDs only. Never branch game rules on Codex/Claude/MCP/browser/advisor/provider concepts.

## Identity / credential invariant

Never use Room ID, Seat ID, Actor ID, or lifecycle session ID as authorization.

Credential scopes are separate:

```text
wldev_   lifecycle device
wlview_  one Room Human viewer
WL-      one-time Join capability
wlseat_  one Room connected Actor binding
wla_     persistent anonymous browser Actor credential
```

Raw secrets must not be logged, put in URLs/prompts/source/commits, or returned to unrelated clients. Server persistence stores digests where applicable.

Anonymous browser Actor identity is deliberately lightweight and browser/device-local. Do not introduce an account/database dependency merely to resume one active Room.

## Room recovery invariant

Current new-Room lifetime is bounded (~24h); Join capability is much shorter (~20m, one-time).

If a Human's `wl_room_...` viewer cookie is missing, recovery may use the persistent anonymous Actor ID + credential to mint a fresh room viewer credential. **Actor ID alone must fail.**

Connected Actor credential may reconnect during the Room lifetime. Reconnect updates presence only and must not silently change `activeControllerActorId`.

## Temporary Controller invariant

Explicit temporary Bot takeover preserves the original Seat and owner.

```text
before: seat owner/controller = Actor A
after:  seat owner = Actor A; controller = temporary Bot
```

Required properties:

- stable Seat ID/hand/role/history;
- temporary Bot Actor/binding is removable;
- native Bot Seats cannot be re-wrapped by fallback;
- elapsed Casual time alone never triggers takeover;
- original connected owner must reconnect before browser restore;
- owner explicitly calls `take_control()` to reclaim from MCP;
- no simultaneous owner/temp-bot Controller mutation.

Put takeover transition logic in pure runtime modules (currently `room-control.ts`), not scattered route/UI branches.

## Game projection invariant

- construct public/private projections explicitly;
- Browser Human does not receive exhaustive machine `legalMoves[]`;
- Human owner may still see own hand while delegated, but mutation controls reflect `seat:play`;
- lobby hides dealt hand/landlord before readiness;
- connected/hosted Actors use server-generated move IDs;
- stale/out-of-turn/illegal/non-controller moves are rejected server-side.

## MCP invariant

MCP is gameplay, not lifecycle detection and not the current Room creation control plane.

Model-visible tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Room ID, Actor token, Seat binding, ownership, and Controller authority are transport/runtime context, not model arguments.

`comment` never changes game revision/state/turn. `yield_to_bot`/`take_control` are explicit owner-control transitions, not timeout behavior.

## Client-neutral control plane

Web is not required for operations that do not inherently need Human UI.

```text
POST /api/v1/rooms
Join API
room Human control/fallback API
```

must remain usable independently of browser presentation where authorization permits. `agent-bots` remains fully headless.

Do not add `create_room()` to the room-scoped MCP merely to duplicate HTTP. If a future control MCP is useful, it should wrap/reuse the HTTP control-plane contract.

## Abuse/safety invariant

Public endpoints need server-side protection, not UI-only constraints.

Current baseline includes:

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create Rate Limiting bindings;
- per-Room/per-Actor Join/MCP/comment/control/recovery counters;
- Join/Room expiry;
- capability checks + game revision.

Treat rate limiting as permissive abuse mitigation, not exact accounting. Hosted inference still requires explicit budgets/quotas before broad public exposure.

## Documentation model

`main` contains durable current documentation, not chronology.

Do not leave permanent `*-v2.md`, migration scratchpads, design drafts, or completed phase notes. On merge:

1. extract durable decisions into canonical docs;
2. update `status.md` / `roadmap.md`;
3. delete transitional material.

When code/tests and docs disagree, docs are stale and must be fixed in the same change.

Avoid duplicated machine-authoritative values. Exact CLI version belongs in package JSON + `agent.json`; stable docs use `@waitloop/cli@alpha`.

## Public Agent surface is API

Always inspect/update as relevant:

```text
apps/web/public/agent.md
apps/web/public/agent.json
apps/web/public/llms.txt
apps/web/public/skills/waitloop/SKILL.md
worker/src/room-api.ts
worker/src/mcp.ts
packages/cli
```

Room modes, Join semantics, MCP tools, identity/recovery, capabilities, endpoints, installation, or support status changes require whole-surface consistency.

## Change completeness matrix

| Change | Also inspect/update |
| --- | --- |
| CLI / package / Join cache | CLI package/readme/tests, `docs/cli.md`, manifest, Agent guide/Skill, release docs |
| Room/Join modes/lifetime | Room API + GameRoom tests, architecture/game/protocol/security/status, all Agent surfaces |
| Seat/Actor/capability | pure actor/control tests, GameRoom auth, Human projection, architecture/game/protocol/security/design/status |
| Anonymous identity/recovery | identity parser tests, Room credential tests, security/protocol/architecture/status, browser UX |
| Fallback/reconnect | pure room-control tests, DO auth, Web + MCP tools, game/design/MCP/protocol/security/status/Agent surfaces |
| MCP tool/auth | MCP/DO tests, MCP/protocol/security docs, Agent guide/json/Skill/llms |
| Hosted inference/public cost | hosted tests/docs, security/status/roadmap, rate/budget controls |
| Lifecycle adapter | integration + CLI tests/docs + Agent surfaces |
| Game rule | pure rules tests + `doudizhu-rules.md` |
| Human UI/projection | browser JS, privacy tests, game/design docs |
| Architecture boundary | architecture/status/repository map |

If several rows apply, satisfy all of them.

## Testing contract

- Rules bugs get regression tests.
- Trust/capability/credential boundaries get negative tests.
- Actor ID without credential must never authenticate.
- Hidden-information changes get non-leakage tests.
- Fallback tests prove owner/Seat preservation and cleanup of temporary Actor only.
- Controller changes prove only active Controller can mutate.
- Comments prove no game-revision/state mutation.
- CLI packaging changes run package validation.
- Browser changes pass JS syntax validation.
- Public Agent changes pass `pnpm check:repo-contract`.
- Worker/config changes pass `wrangler deploy --dry-run`.

Do not weaken tests to fit an implementation unless the contract intentionally changed.

## Refactoring cycle

Early correct implementations may be replaced when patch pressure reveals better stable responsibilities.

```text
feature -> feature -> patch pressure
-> lock behavior with tests
-> structural refactor
-> canonical docs/Agent surfaces sync
-> continue
```

Signals include giant mixed-responsibility files, repeated mode branches, duplicated validation, abstractions being bypassed, tests becoming only E2E, docs no longer matching ownership, or new Agents requiring historical context to understand current code.

Prefer local refactors during normal features. Structural refactors require behavior tests first and removal of superseded compatibility/transition paths when safe.

Do not maximize abstraction; optimize for continued change.

## Required checks

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
```

CI also validates browser JS and Wrangler dry-run.

## Preferred implementation order

1. establish durable contract;
2. shared types / pure capability logic;
3. regression + negative tests;
4. runtime/API wiring;
5. UI/platform adapters;
6. public Agent + canonical docs sync;
7. remove transition material;
8. run complete validation.
