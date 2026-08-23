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

Current priority is stabilization of existing Human MCP App and Agent create/join/wait/play/recovery flows before feature expansion.

## Architecture invariant

```text
packages/protocol       lifecycle contracts
packages/game-core      pure game-agnostic contracts
packages/doudizhu       pure Dou Dizhu rules
packages/cli            local config, lifecycle install, Agent Room cache,
                        Human App Room cache, stable stdio MCP + MCP App resource
integrations/*          vendor lifecycle adapters
worker/*                HTTP control plane, DO runtime, remote Agent MCP, hosted inference
apps/web                 standalone Human presentation + public Agent surfaces
```

Web, MCP App, CLI, local MCP, raw HTTP, and remote MCP must converge on the same server runtime rather than duplicate rules or authorization.

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

Game packages see Seat IDs only. Never branch rules on Codex/Claude/MCP/MCP-Apps/browser/provider concepts.

## Identity / credential invariant

Never use Room ID, Seat ID, Actor ID, lifecycle session ID, or UI resource URI as authorization.

```text
wldev_   lifecycle device
wlview_  one Room Human viewer
WL-      one-time Agent Join capability
wlseat_  one Room connected Agent binding
wla_     persistent anonymous Human Actor credential
wlui_    one local interactive Human Room App capability
```

Raw secrets must not be logged, placed in URLs/prompts/source/commits/public docs/Skill, or returned to unrelated clients. Server persistence stores digests where applicable. `wlui_` is local bridge state and is never sent to GameRoom.

Anonymous Human identity is browser/device/local-bridge scoped. Do not introduce account/database dependency merely to resume one active Room.

## Stable local MCP invariant

Stable Agent-facing command:

```text
waitloop mcp
```

Model-visible local tools:

```text
open_game()
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
open_game/UI tools -> reuse existing Human Room HTTP
create/join tools  -> reuse Room/Join HTTP
Agent tools        -> proxy remote Room MCP
credentials        -> private local cache only
business rules     -> server only
```

`open_game` and `create_room` must not be conflated:

```text
open_game   Human owns seat-1 and clicks an MCP App
create_room Agent owns seat-1 and plays autonomously
```

Model-visible tools must never return raw Agent credentials, Human cookies, or `wlui_` capability values. `active.json` may contain Agent Room-selection context but not another secret copy.

`leave_room` is Agent local-selection cleanup, not remote revoke and not Human App cleanup. Future revoke/close tools must be explicit and independently authorized.

Stable MCP installers must use the harness's supported CLI/config surface, be idempotent, and not overwrite an existing `waitloop` definition.

Nested help (`waitloop mcp install codex --help`) must be side-effect free.

## Human MCP App invariant

Trigger/resource:

```text
open_game({gameId:"doudizhu", mode:"human-bots"})
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
protocol 2026-01-26
```

App-only tools:

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

Required design:

- app-only tools declare `_meta.ui.visibility: ["app"]`;
- `open_game` declares modern and compatibility resource URI metadata;
- the App resource is self-contained HTML/CSS/JS;
- the App makes no direct credentialed network request;
- all Human actions flow App -> Host `tools/call` -> local bridge -> existing Human Room HTTP;
- Human Room `wl_actor`/`wl_room_*` cookies stay under private `~/.waitloop/app-rooms` state;
- local file name must not expose raw Room ID;
- a random `wlui_` capability is delivered only in tool-result `_meta` to the App;
- the capability is absent from text/structuredContent and required by every app-only tool;
- capability comparison is constant-time;
- app-only visibility is defense in depth, not authorization;
- unsupported Hosts get an honest fallback, not fake inline success;
- standalone Web fallback starts a separate game unless a future explicit transfer protocol exists;
- `open_game(roomId)` may reopen only a still-valid local interactive Room;
- Human-vs-bots App state is response-driven: mutation responses are authoritative, so normal Human actions update immediately without waiting for polling;
- a Human-vs-bots App must not run a periodic state-refresh timer; an idle mounted App generates zero recurring Worker/DO reads;
- explicit/focus/visibility/error-recovery refresh is one-shot, single-flight, and must never turn into a retry loop;
- multi-view and multi-Actor coherence belongs to an explicit Room event subscription rather than permanent polling;
- any temporary Web polling required for connected Actors must stop while hidden and use bounded backoff when visible state is unchanged;
- failed WebSocket reconnects must use bounded backoff and page-lifecycle cleanup.

Future Room event subscriptions must not use game revision as the only cursor. Add a separate semantic `roomSeq`/event sequence for client-visible changes such as comments, Controller transitions, Room phase, Join/connection transitions, and semantic presence changes. Heartbeat-only timestamp refreshes must not advance that cursor.

Subscription reuse must be scoped by origin + Room + authorized principal/credential scope + projection type/version. Never share one private snapshot stream solely by Room ID.

Do not claim Codex/Claude/Cursor/other Host UI support without testing the exact active product surface. Tool availability does not prove App render/action support.

## Remote MCP invariant

Remote `/mcp` is one already-authorized Agent Room Actor gameplay endpoint, not lifecycle detection, Human MCP App hosting, or Room bootstrap control plane.

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

Do not add `open_game` or `ui_*` to remote MCP; local cookie/App capability custody is required.

## Wait-for-turn invariant

`wait_for_turn` is an efficiency primitive, not a game clock.

Required behavior:

- bounded input: 1–25 seconds;
- bounded server wait: maximum 25 seconds;
- returns on turn, finished, waiting lobby, paused, Controller change, or timeout;
- timeout never passes, plays, changes Controller, or triggers Bot takeover;
- uses the same authenticated Seat projection as `get_turn`;
- remains subject to per-Actor read/rate limits;
- does not claim it can wake a harness after final Agent response.

Continuous Agent play keeps the current run active through repeated `wait_for_turn -> play_move` until the requested condition. Human `open_game` play is driven by App clicks instead.

## Cancellation invariant

Propagate cancellation only for safe read/wait operations:

```text
get_active_room
get_turn
wait_for_turn
ui_get_game
ui_hint
```

Do not network-abort mutation-capable calls under an implied non-execution guarantee:

```text
open_game create
create_room
join_room
leave_room
play_move
comment
yield_to_bot
take_control
ui_play_cards
ui_pass
```

After uncertain mutation transport failure, refresh authoritative state before retrying.

## Room recovery invariant

Current Room lifetime is bounded (~24h); Agent Join is much shorter (~20m, one-time).

If Human `wl_room_...` viewer credential is missing, recovery may use persistent anonymous Actor ID + credential. **Actor ID alone must fail.**

Connected Agent credential may reconnect during Room lifetime. Reconnect updates presence only and must not silently change `activeControllerActorId`.

Agent Join cache must reject expired credentials and clear stale active selection. Human App cache must reject expired/missing/unauthorized local sessions and never expose cookies/capability while doing so.

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
- standalone Human browser and Human MCP App do not receive exhaustive machine `legalMoves[]`;
- Human owner may see own hand while delegated, but controls reflect `seat:play`;
- lobby hides dealt hand/landlord before readiness;
- connected/hosted Agents use server-generated move IDs;
- local bridge forwards server projection without widening it;
- stale/out-of-turn/illegal/non-controller moves are rejected server-side;
- Human App capability controls transport access, not projection breadth.

## Client-neutral control plane

```text
POST /api/v1/rooms
Join API
Room Human play/pass/hint/control/fallback API
```

remain stable server protocols. Local MCP, MCP App, CLI, and Web wrap/reuse them rather than creating alternative authority.

`create_room` belongs to local bridge because remote MCP needs a Room credential before connection. `open_game` also belongs locally because the bridge owns Human cookie/App capability custody.

## Abuse/safety invariant

Public endpoints need server-side protection, not UI constraints.

Current baseline:

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join/MCP/comment/control/recovery/Human mutation counters;
- Join/Room expiry;
- capability checks + game revision;
- bounded `wait_for_turn` transport loop;
- no periodic Human-vs-bots MCP App read loop;
- App refresh reuses existing authenticated Human reads only for explicit/lifecycle/error recovery.

Rate limiting is abuse mitigation, not accounting or game timing. Hosted inference still needs explicit budgets before broad exposure.

## CLI release-state invariant

CLI source state and npm availability are deliberately different concepts. Read [`docs/cli-release.md`](docs/cli-release.md) before changing versions, release metadata, or making installability claims.

```text
packages/cli/package.json
  = source/build version
  = may be an unpublished candidate

apps/web/public/agent.json -> cli.version
  = declared published version

npm Registry dist-tag
  = external authority for what @waitloop/cli@alpha actually installs
```

When source is ahead of npm:

- keep `agent.json.cli.version` on the currently published version;
- set `candidateVersion` to `package.json.version`;
- set `candidatePublished:false`;
- keep `distTag` and `installCommand` aligned with the published version/channel;
- do not describe candidate-only CLI behavior as already installable through `@alpha`.

After Registry publication is verified, promote `agent.json.cli.version` and remove candidate fields.

**Never answer “users can install version X / feature Y now” from `main`, package.json, Cloudflare deployment, or passing CI alone.** If the claim is about current npm installability, verify the Registry/dist-tag. If Registry evidence is unavailable, distinguish source version from declared published version rather than guessing.

Normal repository CI validates this state machine deterministically; it should not depend on live npm. Trusted publishing/release verification owns the external Registry check.

## Documentation model

`main` contains durable current documentation, not chronology.

Do not leave permanent `*-v2.md`, migration scratchpads, drafts, or completed phase notes. On merge:

1. extract durable decisions into canonical docs;
2. update `status.md` / `roadmap.md`;
3. delete transition material.

When code/tests and docs disagree, docs are stale and must be fixed in the same change.

Stable user-facing CLI docs use `@waitloop/cli@alpha`. Source/build version belongs in `packages/cli/package.json`; declared published version belongs in `agent.json`; actual installability is verified against npm Registry/dist-tags.

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

Room modes, Join semantics, local/remote MCP tools, MCP App resources/tools, identity/recovery, capabilities, endpoints, installation, release status, or support status changes require whole-surface consistency.

## Change completeness matrix

| Change | Also inspect/update |
| --- | --- |
| CLI / package / Join/App cache | CLI readme/tests, `docs/cli.md`, manifest, Agent guide/Skill/llms, `docs/cli-release.md` |
| CLI version / release channel | package metadata, `agent.json` published/candidate state, `docs/cli-release.md`, package/repository validators, Registry verification workflow |
| Local MCP bridge/install | bridge/client/install tests, CLI help/doctor/package validation, architecture/MCP/protocol/security/status, Agent surfaces |
| MCP App tool/resource/UI | Human client tests, embedded JS syntax, stdio resource wire test, architecture/MCP/security/status/roadmap, all public Agent surfaces |
| Room/Join modes/lifetime | Room API + GameRoom tests, architecture/game/protocol/security/status, all Agent surfaces |
| Seat/Actor/capability | pure actor/control tests, GameRoom auth, Human projection, architecture/game/protocol/security/design/status |
| Anonymous identity/recovery | identity parser tests, Room credential tests, security/protocol/architecture/status, browser/App UX |
| Fallback/reconnect | pure room-control tests, DO auth, Web + MCP + App, game/design/MCP/protocol/security/status/Agent surfaces |
| MCP tool/auth/wait | remote/local tests, MCP/protocol/security docs, Agent guide/json/Skill/llms |
| Hosted inference/public cost | hosted tests/docs, security/status/roadmap, rate/budget controls |
| Lifecycle adapter | integration + CLI tests/docs + Agent surfaces |
| Game rule | pure rules tests + `doudizhu-rules.md` + Web/App presentation |
| Human UI/projection | browser/App JS, privacy tests, game/design/security docs |
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
- local bridge tests prove tool list/instructions/credential non-disclosure;
- Human App tests prove cookie custody, hashed file naming, UI capability separation, invalid-capability rejection, and Human action proxying;
- Human App request-budget tests execute the embedded refresh functions with fake timers and prove idle 24-hour zero reads, single-flight lifecycle recovery, and no hidden/busy/torn-down reads;
- embedded App JavaScript must pass syntax validation;
- packaged MCP wire tests prove tools/list, resources/list/read, metadata, visibility, capability schema, and safe errors;
- Room bridge tests prove create -> Join -> authenticated connect;
- installer tests prove exact/idempotent harness commands;
- CLI package/release changes prove source-candidate versus published state and derive public channel metadata from the published version;
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
pnpm check:mcp-stdio
```

CI also validates embedded App JS, browser JS, Agent discovery, Cloudflare gate behavior, and Wrangler dry-run.

## Preferred implementation order

1. establish durable contract;
2. shared types / pure capability logic;
3. regression + negative tests;
4. runtime/API wiring;
5. UI/platform adapters;
6. public Agent + canonical docs sync;
7. remove transition material;
8. run complete validation.
