# Current implementation status

This is the compact handoff snapshot of current durable truth.

## Deployment and validation

- Production: `https://waitloop.run`.
- Cloudflare Worker + Static Assets + Durable Objects.
- GitHub `main` auto-deploys through Cloudflare.
- CI validates TypeScript, Vitest, repository/onboarding contracts, CLI package behavior, browser JS, Agent discovery, and Wrangler dry-run.

## Coding-agent lifecycle

```text
idle | running | waiting | completed | failed
```

Claude Code, Cursor, and Codex lifecycle adapters are available; DSH remains planned. Reporting is fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

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

`agent.json` declares GitHub mirrors of `agent.md` so Agent discovery does not depend on one browser navigation path.

CLI alpha:

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

Local tools:

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

The bridge:

- calls existing Room/Join HTTP for control operations;
- proxies existing remote Room MCP for gameplay;
- keeps Room Actor credentials in private local cache;
- never returns raw credentials through model-visible tools;
- stores one active Room pointer that survives bridge restart until Room expiry;
- supports Codex/Claude Code configuration through their CLI MCP surfaces;
- serves modern MCP 2026-07-28 discovery and supported legacy initialize clients from the same stdio command;
- processes in-flight requests independently so a long `wait_for_turn` does not block cancellation handling;
- maps `notifications/cancelled` to an `AbortSignal`, aborts the proxied remote request, and suppresses stale cancelled results;
- returns structured recoverable errors with `nextAction` and conservative `retrySafe` metadata when known.

Cursor lifecycle integration remains available, while stable stdio MCP setup is currently manual where supported.

## CLI Room flow

```bash
waitloop room create
waitloop join WL-XXXXXXXXXX
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

- `room create` creates/connects the existing `agent-bots` mode.
- `join` claims/cache/selects active Room.
- default and `--json` Join output omit bearer credentials.
- `--raw-mcp` is the explicit advanced remote configuration fallback.
- `room leave` clears active selection but does not revoke cached credential or mutate the Room.
- expired Room cache clears stale active selection.

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

Human Web identity remains anonymous and browser/device-local (`actor_...` + separate HttpOnly `wla_...` credential). No database/D1 is required for one-Room recovery.

## Current Dou Dizhu modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

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

Connected start:

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

Current modes still gate one joined connected Actor. Generalized multiple connected Actors remain unshipped.

## Remote MCP gameplay

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

`wait_for_turn` uses authenticated snapshot reads, about 750 ms polling, and a maximum 25-second transport wait. It returns on turn, finish, lobby, pause, Controller change, or timeout.

The remote wait loop observes the MCP HTTP request `AbortSignal`; client cancellation interrupts snapshot polling/delay promptly rather than waiting for the transport timeout.

Transport timeout or cancellation never auto-passes, auto-plays, changes Controller, or triggers Casual fallback.

`yield_to_bot` and `take_control` preserve Seat ID, owner, hand, role, and history. Reconnect updates presence only and never silently reclaims Controller.

MCP is request/response participation. It cannot wake an Agent after final response. Continuous-play intent must keep the current Agent run active through `wait_for_turn -> play_move` until the requested stopping condition.

## Human Web recovery / takeover

Web can:

- delegate Human Seat to a connected companion and take it back;
- let a temporary Bot control an eligible Seat;
- as Room owner, replace another eligible controller with Bot;
- restore original owner when available;
- recover Room viewer access from anonymous Actor credential;
- preserve Seat/hand/role/history through takeover.

## Security currently implemented

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join, MCP read/move/comment/control/recovery limits;
- one-time Join and bounded Room expiry;
- hashed server credential storage;
- server capability/revision checks;
- hidden-information projection tests;
- local MCP credential custody and credential-safe default output;
- local MCP cancellation does not return stale results and does not mutate game state;
- idempotent MCP installer that does not overwrite an existing `waitloop` definition;
- side-effect-free nested CLI help.

Rate limiting remains abuse protection, not accounting.

## Tests currently covering this flow

- 80+ unit/regression tests across rules, identity, controller fallback, CLI, and MCP;
- local bridge tool/instruction and modern/legacy negotiation contract;
- in-flight local MCP cancellation with stale-result suppression;
- remote Room fetch abort propagation and retry-safety classification;
- headless create -> Join claim -> authenticated MCP connect;
- active Room pointer and expired cache handling;
- Codex/Claude MCP installer command/idempotency;
- wait-for-turn reason/timeout classification and abort-aware poll delay;
- package/onboarding/public-surface consistency.

## Known gaps

- full Dou Dizhu bidding / rob-landlord / scoring;
- transport-level disconnect detection richer than explicit yield/reconnect;
- generalized multiple connected Actors / multiple Join capabilities;
- multiple advisors, public spectators, and commentators;
- per-turn one-shot delegation;
- automatic MCP setup for Cursor/DSH;
- explicit remote Room Actor revoke/leave semantics;
- proactive rather than lazy expired local/Room cleanup;
- cross-device accounts/global history/index;
- hosted inference budget/accounting;
- broader lifecycle/pairing rate limits and CSP/CORS hardening;
- DSH lifecycle adapter;
- Arena/benchmark mode.

Forward priorities live in [`roadmap.md`](roadmap.md).
