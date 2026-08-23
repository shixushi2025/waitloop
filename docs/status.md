# Current implementation status

This is the compact handoff snapshot of current durable truth.

## Deployment and validation

- Production: `https://waitloop.run`.
- Cloudflare Worker + Static Assets + Durable Objects.
- Cloudflare retains the native Git integration and production credentials.
- CI runs on `main`, pull requests, and `fix/**` branches.
- CI validates TypeScript, Vitest, repository/onboarding contracts, CLI package behavior, packaged MCP stdio/MCP Apps wire behavior, embedded App JavaScript, browser JS, Agent discovery, Wrangler dry-run, and the Cloudflare deployment gate.
- The final GitHub Actions job is named `ready-to-deploy` and succeeds only after the full `check` job plus a real Checks API gate verification succeed.
- Cloudflare production builds wait for `ready-to-deploy=success` for the exact `WORKERS_CI_COMMIT_SHA`; failed, cancelled, or timed-out GitHub CI blocks deployment.
- Ordinary local install/development and non-production Cloudflare branches skip the production wait.
- Explicit `pnpm deploy` is allowed only from a clean local `main`; it rejects staged, modified, untracked, detached-HEAD, and feature-branch states, checks `origin/main` when available, and requires that exact `HEAD` commit's `ready-to-deploy` check before `wrangler deploy`.
- The anonymous Cloudflare production path polls GitHub at most once per minute and fails closed after 15 minutes; `WAITLOOP_GITHUB_TOKEN` is an optional higher-rate override.

## Coding-agent lifecycle

```text
idle | running | waiting | completed | failed
```

Claude Code, Cursor, and Codex lifecycle adapters are available; DSH remains planned. Reporting is fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

Stop, failure, and session-end hooks finalize the latest state as `completed` or `failed` before native-session cleanup. This prevents `waitloop status`, `waitloop open`, and remote AgentSession state from remaining stale `running`/`waiting` after a harness closes.

Codex owns lifecycle command-hook review/trust. `waitloop doctor` checks local/published Waitloop CLI, Codex version/hooks capability, installed Waitloop events, and stable local MCP registration. A Plugin is not required and cannot bypass lifecycle hook trust.

## Public Agent surfaces

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/api/v1/rooms
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

`agent.json` declares GitHub mirrors of `agent.md` so discovery does not depend on one browser navigation path.

Published CLI alpha:

```text
0.1.0-alpha.8
```

Current source/build candidate:

```text
0.1.0-alpha.9
candidatePublished: false
```

Alpha.8 remains the npm `alpha` release and was verified through trusted publishing, exact Registry lookup, dist-tag verification, clean installation, and packaged MCP stdio/MCP Apps validation. Alpha.9 is source-only until the same release checks and a real Codex Desktop smoke test complete; it must not be described as installable yet.

Install/update remains:

```bash
npm install -g @waitloop/cli@alpha
waitloop doctor
```

## Stable local MCP bridge

Available stdio command:

```text
waitloop mcp
```

One-time installers:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

The ordinary lifecycle installers for Codex/Claude Code also install this stable MCP entry.

The local bridge uses the official MCP v2 stdio server entry, serving legacy 2025-era clients and 2026-07-28 clients from the same command.

### Model-visible tools

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

### MCP App-only tools

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

The bridge:

- calls existing Room/Join HTTP for Agent control operations;
- proxies existing remote Room MCP for Agent gameplay;
- calls existing Human Room HTTP APIs for MCP App state/play/pass/hint;
- keeps Agent credentials and Human cookies in separate private local caches;
- never returns raw credentials through model-visible content and redacts credential-shaped errors;
- stores one active Agent Room pointer that survives bridge restart until Room expiry;
- stores Human MCP App Room sessions under `~/.waitloop/app-rooms` and reopens them explicitly through `open_game(roomId)`;
- supports Codex/Claude Code configuration through their CLI MCP surfaces;
- propagates cancellation through safe read/wait calls without abandoning mutation-capable calls mid-flight.

Cursor lifecycle integration remains available, while stable stdio MCP setup is currently manual where supported.

## Agent-native interactive Human table

The published alpha.8 provides:

```text
open_game({gameId:"doudizhu", mode:"human-bots"})
```

This creates an ordinary Human `bots` Room:

```text
seat-1 Human
seat-2 deterministic Bot
seat-3 deterministic Bot
```

The tool result links to:

```text
URI       ui://waitloop/doudizhu/v1
MIME      text/html;profile=mcp-app
protocol  2026-01-26
```

The self-contained App supports:

```text
select cards
play
pass
hint
clear
refresh
inline/fullscreen where the Host permits it
```

Alpha.8 capped `recent activity` at the latest four chronological single-line rows, kept `current trick` separate, and mitigated the original 1.2-second incident loop with bounded 5–30 second visible-document polling.

The alpha.9 source candidate keeps the compact history but removes periodic Human-vs-bots refresh entirely. Human play/pass responses already include the authoritative state after synchronous Bot automation and render immediately; hint is read-only. `ui_get_game` is used only for explicit refresh, reopen, stale or uncertain-result recovery, and one-shot focus/visibility recovery. These reads are single-flight, so an idle mounted App produces zero recurring Worker and Durable Object reads.

This candidate does not pretend to solve multi-Actor synchronization. Future connected/companion freshness requires a Room event subscription with a semantic event cursor and authorization-specific projection reuse, not permanent polling.

The App uses MCP Apps postMessage initialization/tool-result/host-context/size/display-mode/teardown messages and calls the four app-only tools through the Host's `tools/call` proxy.

This is intentionally different from:

```text
create_room()
```

which remains Agent-owned `agent-bots` play. When the user wants clickable Human operation, the Agent should call `open_game`; when the Agent should play autonomously, it should call `create_room`.

### Host support boundary

Inline operation requires an MCP Apps-capable Host that:

- preserves tool UI metadata;
- reads `ui://` resources;
- renders the MCP App MIME type;
- forwards the initial tool result including result `_meta`;
- proxies App server-tool calls.

A real Codex desktop client session first manually rendered and operated the App on alpha.7; alpha.8 preserves that path. In that session the transcript showed the safe JSON/structured tool result while the Human-facing App rendered simultaneously. Agents must not treat visible JSON as proof of render failure or automatically create a separate browser game.

This observation is manual and surface-specific. Waitloop still does not claim every Codex/Claude/Cursor/terminal/desktop surface implements all required behaviors. Unsupported Hosts receive safe text/structured results and fallback guidance.

The fallback web URL starts a separate browser-controlled game. It does not resume the private inline Room.

### Human UI credential boundary

The local bridge captures the Human `wl_actor` and `wl_room_*` cookies and stores them privately under a hashed local file name in `~/.waitloop/app-rooms`.

Each interactive Room also receives a high-entropy:

```text
wlui_<64 hex>
```

capability. It is:

- stored only in private local state;
- delivered to the embedded App only through `tool result _meta["waitloop/uiToken"]`;
- absent from model-visible text and `structuredContent`;
- required by all app-only tools;
- checked with a constant-time comparison;
- redacted from local error text.

The App contains no concrete credential and makes no direct credentialed network request. Host visibility and the private capability are independent defenses.

## CLI Agent Room flow

```bash
waitloop room create
waitloop join WL-XXXXXXXXXX
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

- `room create` creates/connects the existing Agent-owned `agent-bots` mode.
- `join` claims/cache/selects an active Agent Room.
- default and `--json` Join output omit bearer credentials.
- `--raw-mcp` is the explicit advanced remote configuration fallback.
- `room leave` clears Agent active selection but does not revoke cached credential or mutate the Room.
- expired Agent Room cache clears stale active selection.

Human MCP App Rooms are not CLI active Agent Rooms; they use `open_game` and separate private state.

## Identity and game model

```text
Room       one runtime/game instance
Seat       stable room-scoped game position (seat-1/seat-2/seat-3)
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to mutate the Seat
Advisor    bound Actor that may inspect/comment but cannot play until delegated
```

Actor/Seat/Room IDs are identifiers, not credentials.

Human Web identity remains anonymous and browser/device-local (`actor_...` + separate HttpOnly `wla_...` credential). The local MCP App reuses the same server-side Human identity/authorization model while retaining the cookies in local bridge custody.

## Current Dou Dizhu modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

- `bots`: Human + two deterministic bots; used by standalone Web and `open_game`.
- `connected-agent`: Human and Agent occupy separate Seats.
- `companion-agent`: Agent is Advisor of Human Seat until explicit delegation.
- `agent-bots`: connected Agent owns `seat-1` against two deterministic bots; fully headless.

Landlord is still selected randomly before play. Full bidding/scoring is not implemented.

## Room / Join lifecycle

```text
Room lifetime       about 24 hours
Join lifetime       about 20 minutes
Join claim          one-time
Room Actor token    reconnectable while Room active
```

Connected Agent start:

```text
Room created
-> waiting_for_players
-> Join claimed
-> Actor connecting
-> first authenticated remote MCP request
-> Actor connected
-> playing
```

Join success is not raw MCP connection. Local `join_room` and `create_room` perform the authenticated request before reporting connected.

Human MCP App start has no Join phase:

```text
open_game
-> create Human bots Room
-> capture private Human cookies locally
-> emit safe snapshot + private App metadata
-> Host renders App
-> App calls Human APIs through local bridge
```

Current modes still gate one joined connected Agent Actor. Generalized multiple connected Actors remain unshipped.

## Remote MCP Agent gameplay

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

`wait_for_turn` uses authenticated snapshot reads, about 750 ms polling, and a maximum 25-second transport wait. It returns on turn, finish, lobby, pause, Controller change, or timeout.

Transport timeout never auto-passes, auto-plays, changes Controller, or triggers Casual fallback. MCP client cancellation stops the in-flight wait promptly without a game mutation.

For Advisors, `wait_for_turn` is not a general Room-revision subscription. In the manually tested `companion-agent` flow, an Advisor bound to a Human-controlled Seat received `controller_changed` immediately rather than waiting for the next Human move. Binding/connected state therefore does not mean the Agent is continuously listening.

`yield_to_bot` and `take_control` preserve Seat ID, owner, hand, role, and history. Reconnect updates presence only and never silently reclaims Controller.

In fully headless `agent-bots`, yielding `seat-1` leaves all three Seats under Bot control. The automated players may finish the game before the owner reconnects; yield is an explicit handoff rather than a pause primitive.

MCP is request/response participation. It cannot wake an Agent after final response. Agent-controlled continuous play must keep the current Agent run active through `wait_for_turn -> play_move`. Human `open_game` play is driven by App clicks instead.

## Human Web recovery / takeover

Standalone Web can:

- delegate Human Seat to a connected companion and take it back;
- let a temporary Bot control an eligible Seat;
- as Room owner, replace another eligible controller with Bot;
- restore original owner when available;
- recover Room viewer access from anonymous Actor credential;
- preserve Seat/hand/role/history through takeover.

The first MCP App release intentionally exposes only Human-vs-bots play/pass/hint. Companion/connected-agent control UI remains in the standalone Web surface until an explicit MCP App design is added.

The currently tested companion flow is fragmented: the Human creates `companion-agent` in standalone Web, relays a one-time Join code, and the Agent calls `join_room`. There is no one-step local `open_companion_game` entry and no companion-specific Room-update wait primitive yet.

## Security currently implemented

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join, MCP read/move/comment/control/recovery limits;
- one-time Join and bounded Room expiry;
- hashed server credential storage;
- server capability/revision checks;
- hidden-information projection tests;
- local Agent credential custody, credential-safe output, and error redaction;
- private local Human cookie custody for MCP Apps;
- UI-only capability in result `_meta`, absent from model-visible content;
- app-only Human tools requiring the capability;
- self-contained App resource with no direct credentialed network traffic;
- cancellation propagation only for read/wait operations;
- idempotent MCP installer that does not overwrite an existing `waitloop` definition;
- side-effect-free nested CLI help;
- fail-closed automatic and explicit production deployment when final GitHub CI is not successful;
- clean-main invariant preventing manual deployment of uncommitted or feature-branch content;
- browser request budgets that prohibit unbounded idle Worker polling, stop hidden-view refresh, and bound failed socket retries.

Rate limiting remains abuse protection, not accounting.

## Tests currently covering this flow

- 98 unit/regression tests across rules, identity, controller fallback, lifecycle, CLI, MCP, Human MCP App custody/presentation, and browser request budgets;
- lifecycle terminal cleanup and duplicate Stop/SessionEnd finalization;
- Human Room creation through existing HTTP and private Set-Cookie capture;
- hashed local Human session file name and private credential storage;
- `wlui_` capability absence from safe payload and rejection of invalid capability;
- Human play/pass/hint proxying through private cookies;
- local bridge tool/instruction/resource metadata and error redaction;
- embedded MCP App JavaScript syntax;
- fixed four-row, non-scrolling recent activity contract;
- executable embedded-App runtime tests proving 24-hour idle produces zero reads, repeated focus/visibility events remain single-flight, and hidden/busy/torn-down states do not refresh;
- source-contract checks prohibiting a periodic Human MCP App refresh timer;
- standalone connected/companion Room refresh stops while hidden and backs unchanged visible state off from 1 to 10 seconds;
- lifecycle WebSocket failures reconnect with bounded backoff and respect page lifecycle;
- read-only AbortSignal propagation and cancellable `wait_for_turn` polling;
- packaged CLI MCP stdio `initialize -> tools/list -> resources/list/read -> tools/call` validation;
- 15 tools with correct model/app visibility and one MCP App resource;
- headless Agent create -> Join claim -> authenticated MCP connect;
- active Agent Room pointer and expired cache handling;
- Codex/Claude MCP installer command/idempotency;
- wait-for-turn reason/timeout classification;
- package/onboarding/public-surface consistency;
- clean npm installation verification during trusted publication;
- Cloudflare gate selector self-test plus a real post-`check` GitHub Checks API verification job.

## Known gaps

- Room event sequencing separate from game revision; comments, Controller changes, and semantic presence changes need a subscription cursor such as `roomSeq`;
- subscription reuse must be keyed by Room plus authorized principal/projection, not Room ID alone;
- a Human snapshot subscription protocol is not implemented; the current browser viewer WebSocket route remains intentionally disabled;
- automated real-host smoke coverage for Codex desktop and manual verification of additional Codex/Claude/other Host surfaces;
- same-Room transfer from local MCP App to standalone browser without exposing long-lived credentials;
- Human connected-agent/companion controls inside the MCP App;
- one-step companion creation/binding from the local MCP surface;
- Advisor Room-update waiting distinct from Controller-oriented `wait_for_turn`;
- truthful separation of bound, authenticated/connected, actively listening, and ended Agent-run state;
- proactive cleanup/list/revoke commands for local interactive Human Rooms;
- full Dou Dizhu bidding / rob-landlord / scoring;
- transport-level disconnect detection richer than explicit yield/reconnect;
- generalized multiple connected Actors / multiple Join capabilities;
- multiple advisors, public spectators, and commentators;
- per-turn one-shot delegation;
- automatic MCP setup for Cursor/DSH;
- explicit remote Room Actor revoke/leave semantics;
- proactive rather than lazy expired Agent cache/Room cleanup;
- cross-device accounts/global history/index;
- hosted inference budget/accounting;
- broader lifecycle/pairing rate limits and CSP/CORS hardening;
- DSH lifecycle adapter;
- Arena/benchmark mode.

Forward priorities live in [`roadmap.md`](roadmap.md).
