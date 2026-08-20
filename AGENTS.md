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

Current priority is stabilization of existing create/join/wait/play/recovery flow before feature expansion.

## Architecture invariant

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local config, lifecycle install, active Room, stable stdio MCP
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, remote MCP, hosted inference
apps/web                 Human presentation + public Agent surfaces
```

Web/CLI/local MCP/raw HTTP/remote MCP must converge on the same server runtime rather than duplicate rules or authorization.

## Privacy invariant

Lifecycle reporting must not require prompt/source/repository/cwd/transcript/tool/terminal/assistant/native-session content.

If a feature needs more data, document consent, data flow, and threat model first.

## Game identity invariant

**Seat != Actor != Controller. Identifier != credential.**

```text
Room       one active runtime/game instance
Seat       stable room-scoped position / hand / role / history
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat
Controller Actor currently allowed to mutate Seat
Advisor    bound Actor that may inspect/comment but not play until delegated
```

New Dou Dizhu Rooms use stable `seat-1`, `seat-2`, `seat-3`. Controller changes must never rewrite Seat ID/hand/role/history/owner.

Capabilities:

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

Only active Controller gets `seat:play`; Seat owner keeps `seat:control`; Room owner gets `room:manage`. Advisor private view is limited to its bound Seat.

Game packages see Seat IDs only. Never branch rules on Codex/Claude/MCP/browser/provider concepts.

## Identity / credential invariant

Never use Room ID, Seat ID, Actor ID, or lifecycle session ID as authorization.

```text
wldev_   lifecycle device
wlview_  one Room Human viewer
WL-      one-time Join capability
wlseat_  one Room connected Actor binding
wla_     persistent anonymous browser Actor credential
```

Raw secrets must not be logged, placed in URLs/prompts/source/commits/docs/Skill, or returned to unrelated clients. Server persistence stores digests where applicable.

Anonymous browser identity is browser/device-local. Do not introduce account/database dependency merely to resume one active Room.

## Stable local MCP invariant

The stable Agent-facing MCP command is:

```text
waitloop mcp
```

Model-visible local tools:

```text
create_room()
join_room(code)
get_active_room()
leave_room()
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Responsibilities:

```text
create/join tools -> reuse Room/Join HTTP
other tools       -> proxy remote Room MCP
credentials       -> private local cache only
business rules    -> server only
```

Local tools must never return raw bearer credentials. `active.json` may contain Room-selection context but not another secret copy.

The stable stdio command must remain compatible with supported real harnesses. Current bridge behavior serves MCP 2026-07-28 `server/discover` plus supported legacy `initialize` clients from the same process.

Long-running requests must not serialize the whole stdio input loop. In-flight requests are keyed by JSON-RPC request ID; `notifications/cancelled` aborts only the matching request, propagates cancellation into proxied transport where possible, and must not emit a stale result after cancellation. Closing stdio aborts remaining in-flight requests.

`leave_room` is local selection cleanup, not remote revoke. Any future revoke tool must be explicit and independently authorized.

Stable MCP installers must use the harness's supported CLI/config surface, be idempotent, and not overwrite an existing `waitloop` definition.

Nested help (`waitloop mcp install codex --help`) must be side-effect free.

## Remote MCP invariant

Remote `/mcp` is one already-authorized Room Actor gameplay endpoint, not lifecycle detection and not the Room bootstrap control plane.

Remote tools:

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Room ID, Actor token, Seat binding, ownership, and Controller authority are transport/runtime context, not model arguments.

`comment` never changes game revision/state/turn. `yield_to_bot`/`take_control` are explicit owner-control transitions.

## Wait-for-turn invariant

`wait_for_turn` is an efficiency primitive, not a game clock.

Required behavior:

- bounded input: 1–25 seconds;
- bounded server wait: maximum 25 seconds;
- returns on turn, finished, waiting lobby, paused, Controller change, or timeout;
- timeout never passes, plays, changes Controller, or triggers Bot takeover;
- client cancellation aborts waiting promptly instead of waiting for the transport timeout;
- cancelled local requests do not deliver stale results;
- cancellation never passes, plays, changes Controller, or triggers Bot takeover;
- uses the same authenticated Seat projection as `get_turn`;
- remains subject to per-Actor read/rate limits;
- does not claim it can wake a harness after final Agent response.

Continuous play is an Agent-run loop: keep the current run active through repeated `wait_for_turn -> play_move` until the requested stopping condition.

## Room recovery invariant

Current new-Room lifetime is bounded (~24h); Join is much shorter (~20m, one-time).

If Human `wl_room_...` viewer cookie is missing, recovery may use persistent anonymous Actor ID + credential. **Actor ID alone must fail.**

Connected Actor credential may reconnect during Room lifetime. Reconnect updates presence only and must not silently change `activeControllerActorId`.

Local Join cache must reject expired Room credentials and clear stale active selection.

## Temporary Controller invariant

Explicit temporary Bot takeover preserves original Seat and owner.

```text
before: owner/controller = Actor A
after:  owner = Actor A; controller = temporary Bot
```

Required:

- stable Seat ID/hand/role/history;
- temporary Bot Actor/binding removable;
- native Bot Seats cannot be wrapped by fallback;
- elapsed Casual time alone never triggers takeover;
- original connected owner reconnects before restore;
- owner explicitly calls `take_control()`;
- no simultaneous owner/temp-Bot mutation.

Keep transition logic in pure runtime modules such as `room-control.ts`, not scattered routes/UI branches.

## Game projection invariant

- construct public/private projections explicitly;
- Human browser does not receive exhaustive machine `legalMoves[]`;
- Human owner may see own hand while delegated, but controls reflect `seat:play`;
- lobby hides dealt hand/landlord before readiness;
- connected/hosted Actors use server-generated move IDs;
- local bridge forwards server projection without widening it;
- stale/out-of-turn/illegal/non-controller moves are rejected server-side.

## Client-neutral control plane

Web is not required for operations without inherent Human UI.

```text
POST /api/v1/rooms
Join API
Room Human control/fallback API
```

remain stable server protocols. Local MCP and CLI should wrap/reuse them for normal Agent operation. Raw HTTP remains advanced fallback.

Do not add `create_room` to remote room-scoped MCP. It belongs to local bridge because remote MCP requires a Room credential before connection.

## Abuse/safety invariant

Public endpoints need server-side protection, not UI constraints.

Current baseline:

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join/MCP/comment/control/recovery counters;
- Join/Room expiry;
- capability checks + game revision;
- bounded and cancellable `wait_for_turn` transport loop.

Rate limiting is abuse mitigation, not accounting or game timing. Hosted inference still needs explicit budgets before broad exposure.

## Documentation model

`main` contains durable current documentation, not chronology.

Do not leave permanent `*-v2.md`, migration scratchpads, drafts, or completed phase notes. On merge:

1. extract durable decisions into canonical docs;
2. update `status.md` / `roadmap.md`;
3. delete transition material.

When code/tests and docs disagree, docs are stale and must be fixed in the same change.

Exact CLI version belongs in package JSON + `agent.json`; stable docs use `@waitloop/cli@alpha`.

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

Room modes, Join semantics, local/remote MCP tools, identity/recovery, capabilities, endpoints, installation, waiting/cancellation behavior, or support status changes require whole-surface consistency.

## Change completeness matrix

| Change | Also inspect/update |
| --- | --- |
| CLI / package / Join cache | CLI readme/tests, `docs/cli.md`, manifest, Agent guide/Skill/llms, release docs |
| Local MCP bridge/install | bridge/client/install tests, CLI help/doctor/package validation, architecture/MCP/protocol/security/status, Agent surfaces |
| Room/Join modes/lifetime | Room API + GameRoom tests, architecture/game/protocol/security/status, all Agent surfaces |
| Seat/Actor/capability | pure actor/control tests, GameRoom auth, Human projection, architecture/game/protocol/security/design/status |
| Anonymous identity/recovery | identity parser tests, Room credential tests, security/protocol/architecture/status, browser UX |
| Fallback/reconnect | pure room-control tests, DO auth, Web + MCP, game/design/MCP/protocol/security/status/Agent surfaces |
| MCP tool/auth/wait/cancel | remote/local tests, MCP/protocol/security docs, Agent guide/json/Skill/llms |
| Hosted inference/public cost | hosted tests/docs, security/status/roadmap, rate/budget controls |
| Lifecycle adapter | integration + CLI tests/docs + Agent surfaces |
| Game rule | pure rules tests + `doudizhu-rules.md` |
| Human UI/projection | browser JS, privacy tests, game/design docs |
| Architecture boundary | architecture/status/repository map |

If several rows apply, satisfy all.

## Testing contract

- rules bugs get regression tests;
- trust/capability/credential boundaries get negative tests;
- Actor ID without credential never authenticates;
- hidden-information changes get non-leakage tests;
- fallback proves owner/Seat preservation and temporary Actor cleanup;
- Controller tests prove only active Controller mutates;
- comments prove no game-revision/state mutation;
- wait tests prove reasons/bounds/no implicit mutation contract;
- cancellation tests prove matching-request abort, proxied transport abort, and stale-result suppression;
- local bridge tests prove tool list/instructions/protocol compatibility/credential non-disclosure;
- Room bridge tests prove create -> Join -> authenticated connect;
- installer tests prove exact/idempotent harness commands;
- CLI packaging changes run package validation;
- browser changes pass JS syntax validation;
- public Agent changes pass `pnpm check:repo-contract`;
- Worker/config changes pass Wrangler dry-run.

Do not weaken tests to fit implementation unless contract intentionally changed.

## Refactoring cycle

```text
feature -> feature -> patch pressure
-> lock behavior with tests
-> structural refactor
-> canonical docs/Agent surfaces sync
-> continue
```

Signals: mixed-responsibility giant files, repeated mode branches, duplicated validation, bypassed abstractions, E2E-only tests, docs mismatching ownership, or new Agents needing history to understand current code.

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
