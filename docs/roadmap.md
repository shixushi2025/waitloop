# Roadmap

This document contains only future work that is still relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

The current product priority is **stabilization before feature expansion**. Stable local MCP, `wait_for_turn`, dual-era stdio handling, cancellation, and the first Human-operated MCP App are implemented and published. A real Codex desktop session rendered and operated the App. The alpha.9 source candidate removes periodic Human-vs-bots reads; the next architectural work is semantic Room event sequencing and authorization-safe subscriptions rather than another polling interval adjustment.

## 1. MCP App real-host stabilization

The first App contract now exists:

```text
open_game
-> ui://waitloop/doudizhu/v1
-> Human selects cards / play / pass / hint
-> app-only tools
-> existing Human Room APIs
```

Observed manually in Codex desktop:

- the transcript may show the safe JSON/structured tool result while the linked App renders at the same time;
- inline card rendering and Human actions work after the client reloads the updated MCP configuration;
- visible JSON must not be treated as proof that App rendering failed;
- automatically opening the standalone browser fallback can create an unwanted second game.

The Human-vs-bots request model is now explicit:

```text
open_game result              -> initial state
ui_play_cards / ui_pass       -> authoritative post-Bot state
ui_hint                       -> read-only suggestion
manual/focus/visibility       -> one-shot recovery read
stale/uncertain result        -> one-shot recovery read
idle mounted App              -> zero recurring Worker reads
```

Near-term work:

- turn the Codex desktop observation into a repeatable smoke procedure and record the exact client surface/version tested;
- test inline render, initial result forwarding, result `_meta`, App `tools/call`, resize, host theme, fullscreen, and teardown in each additional supported Host surface;
- record a compatibility matrix for Codex Desktop/CLI, Claude Web/Desktop/Code, ChatGPT/plugin surfaces, Cursor, and other Hosts without assuming equivalent support;
- verify Agents do not invoke browser fallback merely because model-visible structured output is present;
- verify unsupported Hosts present the safe text fallback and do not misleadingly imply the private inline Room can be opened in a standalone browser;
- test `open_game(roomId)` across Host conversation/session restarts while the local bridge and Room remain valid;
- verify Windows/macOS/Linux permissions and path behavior for `~/.waitloop/app-rooms`;
- test expired, deleted, unauthorized, stale-revision, invalid-card, pass-not-legal, and network-interruption behavior;
- ensure private `wlui_`, `wla_`, and `wlview_` values never enter model-visible content, logs, diagnostics, or error text;
- test multiple simultaneously open App views for the same Room and document the intended stale-revision behavior;
- add an automated synthetic Host harness for `ui/initialize -> tool-result -> tools/call -> teardown` beyond the current stdio/resource contract validation.

Acceptance: on each declared compatible Host, a Human can ask “open a game for me,” receive an inline table, play to completion with clicks, reopen the table safely, and receive a precise fallback on an incompatible Host without accidentally creating a second Room or generating idle periodic traffic.

## 2. Room event sequencing and subscriptions

The semantic Room cursor and bounded update wait are now implemented. Preserve the distinction from game revision while building the push transport:

```text
game revision
  -> play/pass concurrency and stale-move rejection

roomSeq / eventSeq
  -> every semantic client-visible Room change
```

`roomSeq` should advance for:

- game state/revision changes;
- comments;
- Controller changes and temporary Bot takeover/restore;
- Room phase changes;
- Join claim and meaningful connection-status transitions;
- semantic presence transitions such as connecting -> connected or connected -> disconnected.

It should **not** advance for heartbeat-only timestamp updates where the visible semantic status is unchanged.

Subscription connections must be keyed by at least:

```text
server origin
+ Room ID
+ authorized principal / credential scope
+ projection type/version
```

Never reuse a private snapshot stream solely by `roomId`.

Implemented foundation:

- persisted/backward-compatible `roomSeq` on GameRoom and all Human/Agent projections;
- centralized semantic commit path for write + sequence increment + conditional broadcast;
- regression tests proving game/comment/Controller/status events advance, heartbeat-only writes do not, and collection order is irrelevant.
- bounded cancellable `wait_for_room_update(afterRoomSeq, timeoutMs?)` for Controllers and Advisors, including ahead-cursor recovery and terminal Room return.

Remaining implementation order:

1. define a Human snapshot subscription endpoint—the current browser viewer WebSocket remains intentionally disabled because it exposes a different projection protocol;
2. let the local bridge reuse one remote connection for multiple waiters sharing the same authorization/projection key;
3. add waiter leases, single waiter per App, 30–60 second last-waiter grace, maximum idle TTL, reconnect jitter, and final cleanup on Room finish;
4. use the implemented bounded wait only as the stoppable fallback when push is unavailable.

Acceptance: comments, game moves, Controller transitions, Join/connection state, and Room phase changes reach each authorized projection promptly without permanent polling, cursor gaps, or private-state cross-talk.

## 3. Existing Agent flow stabilization

Treat the existing Agent-controlled path as product regression testing:

```text
Agent discovery
-> CLI install/update
-> doctor
-> lifecycle adapter install/trust (optional)
-> stable MCP install
-> create_room / join_room
-> wait_for_turn / play / advice
-> yield / bridge restart / reconnect / take_control
-> finish / leave / expire cleanly
```

Near-term work:

- run this path repeatedly in real Codex Desktop/CLI and Claude Code environments;
- verify stdio MCP configuration survives harness restarts and existing definitions are never overwritten;
- verify legacy 2025-era and 2026-07-28 MCP clients against `waitloop mcp` in real harnesses;
- test Join/raw fallback against expired, already-claimed, and missing cache scenarios;
- test continuous Agent play over slow Human turns, repeated 25-second waits, and user/tool-call cancellation;
- make every common failure return the next corrective action;
- keep discovery mirrors, `doctor`, Skill, llms, package docs, and machine manifest synchronized;
- add deployed-test-Worker smoke tests without exposing credentials.

Acceptance: a new Agent can install once, create/join, remain active through the requested Agent game loop, cancel a read/wait safely, restart/reconnect, and recover control without manual HTTP, credential-file parsing, or remote MCP JSON-RPC construction.

## 4. Interactive Human Room lifecycle

Current Human MCP App sessions are private local files with lazy expiry validation. Remaining:

- `list/open/close` semantics for local interactive Rooms without exposing cookies or `wlui_` values;
- proactive removal of expired/finished local sessions;
- explicit revoke/close server semantics if a Human wants to destroy recovery capability;
- safe rotation of a local App capability without recreating the Room;
- observability for create/open/refresh/play/pass/hint/expiry without logging hand contents or credentials;
- decide whether a short-lived, one-time browser transfer capability is worth implementing;
- never put long-lived Human cookies or `wlui_` in a URL;
- decide whether opening the same Room in multiple Apps is supported, rejected, or subscription-coordinated.

Acceptance: Human App session lifetime is explicit, recoverable, auditable, and clean without weakening credential boundaries.

## 5. Presence, Agent cleanup, and revocation

Stable bridge/waiting/cancellation are implemented. Remaining Agent runtime work:

- transport-level disconnect detection and richer presence state without timer-forced Casual moves;
- explicit connected Actor leave/revoke endpoint distinct from local-only `leave_room`;
- proactive cleanup/retention for expired Agent Join cache and finished/expired Room state;
- safe rotation/revocation of one Room Actor credential;
- clearer MCP `clientInfo` labeling when the harness exposes it;
- observability for connect/wait/timeout/cancel/yield/reconnect/take-control without logging credentials/private hands.

Acceptance: presence and cleanup are explicit, recoverable, and auditable without hidden game mutations.

A Codex Plugin may still be evaluated as packaging/distribution improvement after the current CLI/MCP/App path is reliable. It must not be justified as a way to bypass Codex hook trust.

## 6. Richer Human/Agent App relationships

The real companion trial confirmed that the data model works but the product flow is fragmented:

```text
standalone Web creates companion-agent Room
-> Human copies Join code
-> Agent calls join_room
-> Agent becomes Advisor of the Human Seat
```

It also confirmed that `wait_for_turn()` is Controller/turn-oriented: while the Human remains Controller, the Advisor can receive `controller_changed` immediately rather than waiting for the next Human move. Binding and connection therefore do not equal continuous listening, and an ended Agent response cannot provide background advice.

Do not immediately copy the whole standalone Web UI into the App. Add only after the Human-vs-bots App and Room subscription foundation are stable:

- one-step local `open_companion_game()` or equivalent flow that creates the Human Room and binds the current Agent as Advisor without browser automation or manual Join-code relay;
- integrate the existing bounded `wait_for_room_update(afterRoomSeq, timeoutMs)` into the one-step companion flow and future push subscription without implying play authority;
- explicit UI distinctions among bound, authenticated/connected, current Agent run listening, and ended/offline;
- Human + connected Agent + Bot inline table;
- companion/advisor comments in the App;
- optional structured move suggestion/highlight that never plays until the Human confirms;
- explicit Human `me / agent` Controller delegation;
- temporary Bot fallback/restore controls;
- connected Agent presence/elapsed-turn display;
- linked coding-session attention pause/resume inside the App;
- clear model-versus-App responsibility when Agent gives advice but Human clicks.

Acceptance: a Human can start companion play in one supported flow, the Advisor can efficiently observe semantic Room events during the same active Agent run, UI never claims background listening after the run ends, and every App action maps to an existing server capability without letting UI metadata substitute for Room authorization.

## 7. Additional harness support

- stable MCP installer/doctor support for Cursor when its stdio configuration contract is clear;
- DSH lifecycle/MCP adapter after its contract is understood;
- other coding agents based on real demand;
- preserve lifecycle privacy, local credential custody, and accurate MCP Apps support claims.

Acceptance: each harness uses its supported configuration surface and does not require users to edit hidden files manually.

## 8. Public hardening

Current Room creation, Hosted Room creation, Join, MCP, comments, recovery, wait, control, and Human App operations have baseline rate/expiry protection. Remaining:

- lifecycle ingest and pairing rate limits;
- hosted inference budgets/quotas/accounting;
- stronger CSP/CORS/security-header review for standalone Web and MCP App resource metadata;
- private vulnerability reporting path;
- persisted Durable Object migration/recovery tests, including legacy participant -> Actor/Seat normalization;
- abuse/latency metrics for waits, cancellation, subscriptions, reconnects, and local bridge failures;
- concurrency review if many long waits/subscribers target one Room.

Acceptance: anonymous traffic cannot create unbounded cost/state and production boundaries match [`security.md`](security.md).

## 9. Dou Dizhu completeness

Only fill rule gaps that materially improve the current product experience:

- bidding / rob-landlord;
- landlord resolution from bidding rather than random pre-game assignment;
- settlement and multipliers;
- spring / anti-spring;
- regression coverage for the selected rule profile;
- update standalone Web, MCP App, Agent-visible state, and docs together.

Acceptance: rules docs, engine, tests, Web UI, MCP App UI, and Agent-visible state agree exactly.

## 10. Multiple connected Actors and richer relationships

Defer until single-Agent and Human App flows are stable:

- multiple Join capabilities per Room;
- all-ready gating for multiple connected player Seats;
- multiple Advisors on one Seat;
- public-only spectator/commentator Actors;
- per-turn one-shot delegation leases;
- independent leave/revoke per Actor.

Do not add these as `participant.kind` special cases.

Acceptance: each Actor has independent identity/credential/scope and hidden-information access is explicit.

## 11. Cross-device identity only when needed

Do not introduce accounts/database solely for one-Room resume or local MCP App reopen.

If cross-Room/cross-device requirements arrive:

- optional attachment/claim of anonymous Actor identity;
- device list/revoke/rotation;
- Room/history index across Durable Objects;
- profile/nickname/avatar semantics;
- D1/global index only when actual cross-Room queries require it.

## 12. Arena / benchmark

Arena remains separate from Casual waiting and low priority:

- deterministic Agent-vs-Agent runner;
- reproducible seeds/config;
- public-decision replay;
- win/latency/fallback/tool-error metrics;
- hard turn limits only for benchmark fairness.

Never import Arena timing/engagement behavior into Casual Human/Agent tables or Human MCP Apps.

## Maintenance rule

When an item ships, update canonical docs/status and remove it here. Do not preserve implementation chronology as permanent design files.
