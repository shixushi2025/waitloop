# Roadmap

This document contains only future work that is still relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

The current product priority is **stabilization before feature expansion**. Stable local MCP, cancellable `wait_for_turn`, and recoverable local transport errors are now part of the existing path; the next work is proving that path repeatedly in real harnesses rather than adding more modes/tools.

## 1. Current-flow stabilization

Treat real harness use as product regression testing:

```text
Agent discovery
-> CLI install/update
-> doctor
-> lifecycle adapter install/trust (optional)
-> stable MCP install
-> create_room / join_room
-> wait_for_turn / play / advice
-> cancel/interruption when requested
-> yield / bridge restart / reconnect / take_control
-> finish / leave / expire cleanly
```

Near-term work:

- run this entire path repeatedly in real Codex Desktop/CLI and Claude Code environments;
- verify stdio MCP configuration survives harness restarts and existing definitions are never overwritten;
- verify MCP 2026-07-28 discovery, legacy initialize, and cancellation behavior against actual harness clients rather than only protocol regressions;
- test `waitloop join`, local `join_room`, and raw fallback against expired/already-claimed/missing cache scenarios;
- test continuous-play instructions over slow Human turns, repeated 25-second transport timeouts, user cancellation, and Agent interruption;
- continue making uncommon failures return a safe next corrective action when one is knowable;
- keep discovery mirrors, `doctor`, Skill, llms, package docs, and machine manifest synchronized;
- verify Windows/macOS/Linux local file permissions/path/CLI subprocess behavior;
- add integration/smoke tests against a deployed test Worker without exposing credentials;
- evaluate replacing the small local protocol shim with the official MCP `serveStdio()` entry when the CLI dependency/lockfile change can be regenerated and validated through the full package pipeline.

Acceptance: a new Agent can install once, create/join, remain active through the requested game loop, cancel a wait cleanly, restart/reconnect, and recover control without manual HTTP, credential-file parsing, or remote MCP JSON-RPC construction.

## 2. Presence, cleanup, and revocation

Stable bridge/waiting/cancellation are implemented. Remaining runtime lifecycle work:

- transport-level disconnect detection and richer presence state without timer-forced Casual moves;
- explicit connected Actor leave/revoke endpoint and local tool semantics distinct from local-only `leave_room`;
- proactive cleanup/retention for expired local Join cache and finished/expired Room state beyond lazy access;
- safe rotation/revocation of one Room Actor credential;
- clearer MCP `clientInfo` labeling when the harness exposes it;
- observability for connect/wait/timeout/cancel/yield/reconnect/take-control without logging credentials/private hands.

Acceptance: presence and cleanup are explicit, recoverable, and auditable without hidden game mutations.

A Codex Plugin may still be evaluated as packaging/distribution improvement after the current CLI/MCP path is reliable. It must not be justified as a way to bypass Codex hook trust.

## 3. Additional harness support

- stable MCP installer/doctor support for Cursor when its supported stdio configuration contract is clear;
- DSH lifecycle and MCP adapter after its contract is understood;
- other coding agents based on real demand;
- preserve canonical lifecycle privacy and local credential custody.

Acceptance: each harness uses its supported configuration surface and does not require users to edit hidden files manually.

## 4. Public hardening

Current Room creation, Hosted Room creation, Join, MCP, comments, recovery, wait, cancellation, and control operations have baseline rate/expiry protection. Remaining:

- lifecycle ingest and pairing rate limits;
- hosted inference budgets/quotas/accounting;
- stronger CSP/CORS/security-header review;
- private vulnerability reporting path;
- persisted Durable Object migration/recovery tests, including legacy participant -> Actor/Seat normalization;
- abuse/latency/cancellation metrics for `wait_for_turn` and local bridge failures;
- concurrency review if many long waits target the same Room.

Acceptance: anonymous traffic cannot create unbounded cost/state and production boundaries match [`security.md`](security.md).

## 5. Dou Dizhu completeness

Only fill rule gaps that materially improve the current product experience:

- bidding / rob-landlord;
- landlord resolution from bidding rather than random pre-game assignment;
- settlement and multipliers;
- spring / anti-spring;
- regression coverage for the selected rule profile.

Acceptance: rules docs, engine, tests, Human UI, and Agent-visible state agree exactly.

## 6. Multiple connected Actors and richer relationships

Defer until the single-connected-Actor create/join/wait/recovery path is stable:

- multiple Join capabilities per Room;
- all-ready gating for multiple connected player Seats;
- multiple Advisors on one Seat;
- public-only spectator/commentator Actors;
- per-turn one-shot delegation leases;
- independent leave/revoke per Actor.

Do not add these as `participant.kind` special cases.

Acceptance: each Actor has independent identity/credential/scope and hidden-information access is explicit.

## 7. Cross-device identity only when needed

Do not introduce accounts/database solely for one-Room resume.

If cross-Room/cross-device product needs arrive:

- optional attachment/claim of anonymous Actor identity;
- device list/revoke/rotation;
- Room/history index across Durable Objects;
- profile/nickname/avatar semantics;
- D1/global index only when actual cross-Room queries require it.

## 8. Arena / benchmark

Arena remains separate from Casual waiting and low priority:

- deterministic Agent-vs-Agent runner;
- reproducible seeds/config;
- public-decision replay;
- win/latency/fallback/tool-error metrics;
- hard turn limits only for benchmark fairness.

Never import Arena timing/engagement behavior into Casual Human/Agent tables.

## Maintenance rule

When an item ships, update canonical docs/status and remove it here. Do not preserve implementation chronology as permanent design files.
