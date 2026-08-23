# Roadmap

This document contains only future work that remains relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

The current priority is **stabilization and behavior-preserving refactoring before feature expansion**. The stable local MCP bridge, Human-operated MCP App, `wait_for_turn`, `wait_for_room_update`, `revision`, and `roomSeq` foundations are published. New game modes and broad product expansion remain paused.

## 1. Behavior-preserving structural refactoring

Refactor in small, independently validated stages. Do not combine file extraction with protocol, stored-schema, or product-behavior changes.

Recommended order:

```text
remote MCP wait orchestration
-> GameRoom responsibilities
-> Room HTTP API responsibilities
-> standalone Web modules
-> CLI command dispatch
-> MCP App source assembly
-> duplicated public/documentation facts
```

Required invariants:

- keep Durable Object RPC method names stable;
- keep persisted Room data backward compatible;
- keep public HTTP, local MCP, remote MCP, and MCP App schemas stable;
- preserve `Seat / Actor / Controller / Advisor` semantics;
- preserve the separation between game `revision` and semantic `roomSeq`;
- preserve private projection and credential boundaries;
- run the full regression, package, wire, browser, documentation, asset, and Worker validation after every stage.

Acceptance: large modules become easier to reason about without changing externally observable behavior or stored Room compatibility.

## 2. MCP App real-host stabilization

The Human-vs-bots App is response-driven:

```text
open_game result              initial authoritative snapshot
ui_play_cards / ui_pass       authoritative post-Bot snapshot
ui_hint                       read-only suggestion
manual/focus/visibility       one-shot recovery read
stale/uncertain result        one-shot recovery read
idle mounted App              zero recurring Worker reads
```

Remaining work:

- turn the successful Codex Desktop observation into a repeatable smoke procedure;
- record exact Host surfaces and versions rather than generalizing across a product family;
- verify initial result forwarding, result `_meta`, App `tools/call`, resize, theme, fullscreen, and teardown;
- verify visible structured output never triggers an unnecessary standalone-browser fallback;
- test reopen, expiry, unauthorized access, stale revision, invalid move, pass legality, and uncertain network results;
- verify Windows, macOS, and Linux private local-session paths and permissions;
- test multiple local App views and document their stale-view recovery behavior;
- add a synthetic Host harness for the MCP Apps lifecycle.

Acceptance: every declared-compatible Host supports a complete Human game or returns precise fallback guidance without creating a second Room or idle request stream.

## 3. Authorized Room subscriptions

The semantic event cursor is already implemented:

```text
revision
  game mutation concurrency

roomSeq
  client-visible semantic Room changes
```

A future push transport must preserve private projection identity. Connection reuse requires at least:

```text
server origin
+ Room ID
+ authorized principal or credential scope
+ projection type and version
```

Never reuse a private stream by Room ID alone.

Implementation order:

1. define explicit Human viewer authentication and Human snapshot subscription projection;
2. reconnect with a full snapshot and continue from `roomSeq`;
3. let the local bridge reuse one remote connection for waiters with the same authorization/projection key;
4. add one in-flight waiter per App, waiter leases, last-waiter grace, maximum idle TTL, reconnect backoff with jitter, and Room-finished cleanup;
5. retain bounded polling only as a stoppable compatibility fallback.

The current browser viewer WebSocket remains intentionally disabled until the Human projection protocol exists. Existing actor-specific Agent WebSocket output must not be exposed as though it were a Human snapshot stream.

Acceptance: moves, comments, Controller transitions, Room phase, and meaningful connection events reach each authorized projection promptly without permanent polling, cursor gaps, or private-state cross-talk.

## 4. Existing Agent and companion flow stabilization

Treat the current flow as a product regression path:

```text
install/update
-> doctor
-> stable MCP install
-> create_room or join_room
-> get_turn / wait_for_turn / wait_for_room_update
-> play or advise
-> yield / restart / reconnect / take_control
-> finish / leave / expire cleanly
```

Remaining work:

- repeat the flow in real Codex Desktop/CLI and Claude Code environments;
- verify MCP configuration survives harness restarts and existing definitions are not overwritten;
- exercise legacy and current MCP protocol clients against the same bridge;
- test expired, already-claimed, missing-cache, stale-state, timeout, and cancellation recovery;
- ensure common failures include the next corrective action;
- add deployed-test-Worker smoke coverage without exposing credentials;
- distinguish bound, authenticated/connected, currently listening, and ended Agent-run states in companion UI;
- eventually provide a one-step companion entry without browser automation or manual Join-code relay.

`wait_for_turn` remains Controller/actionable-turn oriented. Advisors use `wait_for_room_update(afterRoomSeq)` during the same active Agent run. Neither tool implies background listening after final response.

Acceptance: a new Agent can install once, connect, play or advise through the requested stopping condition, cancel safely, restart, reconnect, and recover control without manual HTTP or credential-file parsing.

## 5. Session lifecycle, cleanup, and revocation

Human MCP App sessions and Agent Join cache are currently private local files with lazy validation.

Remaining work:

- list/open/close semantics for local Human sessions without exposing cookies or `wlui_` values;
- proactive removal of expired or finished local sessions;
- explicit server revoke/close semantics distinct from local-only cleanup;
- safe capability and Actor-credential rotation;
- explicit connected Actor leave/revoke semantics;
- transport-level disconnect detection and clearer presence state;
- observability for create, connect, wait, timeout, cancel, play, comment, yield, reconnect, restore, and expiry without logging credentials or private hands.

Acceptance: session and credential lifetimes are explicit, recoverable, auditable, and independently revocable.

## 6. Public contract and security hardening

Continue reducing duplicated facts across:

```text
agent.json
agent.md
SKILL.md
llms.txt
README files
canonical docs
```

Prefer one typed or machine-readable source for tool lists, release state, install commands, MCP App resource metadata, and protocol version. Generate or validate repeated tables rather than manually maintaining divergent copies.

Remaining hardening:

- lifecycle ingest and pairing limits;
- hosted inference budgets and accounting;
- stronger CSP, CORS, and security-header review;
- private vulnerability reporting path;
- persisted Durable Object migration/recovery tests;
- latency and abuse metrics for waits, cancellation, subscriptions, reconnects, and bridge failures;
- concurrency review for many long waits or subscribers on one Room;
- an explicit retirement plan for legacy `participants[]` and `seatStates[]` projections before stable release.

Acceptance: public documentation and machine surfaces agree with implementation, anonymous traffic cannot create unbounded cost/state, and compatibility layers have explicit ownership and exit criteria.

## Deferred product expansion

Defer these until the stabilization and refactoring work above is complete:

- Human connected-agent and companion controls inside the MCP App;
- structured move suggestions and UI highlighting;
- multiple connected Actors, multiple Advisors, public spectators, and per-turn delegation leases;
- full Dou Dizhu bidding, rob-landlord, settlement, multipliers, spring, and anti-spring;
- additional harness adapters such as DSH;
- cross-device accounts and global Room history;
- Arena and benchmark mode.

Do not introduce accounts, a database, or another front-end framework solely to perform the current maintenance work.

## Maintenance rule

When an item ships, move lasting behavior into the appropriate canonical document, update [`status.md`](status.md), and remove the completed roadmap item. Do not preserve implementation chronology as permanent documentation.
