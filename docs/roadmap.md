# Roadmap

This document contains only future work that is still relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

The current product priority is **stabilization before feature expansion**. Do not interpret this roadmap as permission to keep adding modes/tools while the existing install -> connect -> play -> recover paths still have avoidable friction.

## 1. Current-flow stabilization

Treat real harness use as product regression testing. Repeatedly validate the existing paths on supported environments rather than adding new product concepts first:

```text
Agent discovery
-> CLI install/update
-> doctor
-> lifecycle adapter install/trust
-> create/join Room
-> establish MCP connection
-> play/advice/control
-> yield/reconnect/take control
-> finish/expire cleanly
```

Near-term work should prioritize:

- verify `agent.md`/`agent.json`/Skill/llms discovery from real Agent browser/search/shell environments and keep usable mirrors/fallbacks;
- make `waitloop doctor` the first-line diagnosis for stale CLI, Codex hook capability, hook installation, server reachability, and pairing state;
- keep CLI help/read-only diagnostics side-effect free;
- make Join-vs-MCP-connected state unambiguous in CLI, docs, Web, and Agent instructions;
- test continuous-play instructions so an Agent does not return immediately after connection when the user asked it to keep playing;
- validate Codex Desktop + Codex CLI lifecycle setup, including the externally owned hook trust step;
- exercise expired Join/Room/reconnect/fallback paths with regression tests;
- keep public Agent surfaces synchronized with every behavior change.

Acceptance: a new user/Agent can follow the current supported path without needing product-author knowledge, and common failures explain the next corrective action instead of requiring manual source inspection.

## 2. Connected Actor runtime efficiency

Only after the current flow is stable, reduce unavoidable transport friction without changing the domain model:

- `wait_for_turn` or equivalent server-side long poll so Agents do not repeatedly poll `get_turn`;
- transport-level disconnect detection and richer presence state, without timer-forced Casual moves;
- stable local MCP bridge / optional automatic harness configuration so `waitloop join` need not require copying temporary MCP JSON;
- cleanup of local temporary MCP configuration after Room end;
- clearer MCP `clientInfo` labeling when the harness exposes it.

Acceptance: an Agent can join once, wait efficiently, disconnect/reconnect, and explicitly recover control with minimal model/tool churn.

A Codex Plugin may be evaluated as a distribution/package improvement after the basic flow is reliable. OpenAI's current plugin model can bundle Skill/MCP/hooks, but plugin-bundled command hooks still use Codex hook review/trust; therefore Plugin work must not be justified as a way to bypass that security step.

## 3. Public hardening

Current room creation, hosted-room creation, Join, MCP, comments, recovery, and control operations have baseline rate/expiry protection. Remaining work before broader public exposure:

- rate limiting for lifecycle ingest and pairing flows;
- hosted inference budgets/quotas and stronger cost accounting;
- explicit finished/expired Room cleanup/retention policy beyond lazy expiry;
- stronger CSP/CORS/security headers and production review;
- private security-reporting path;
- persisted Durable Object migration/recovery tests, including legacy participant -> Actor/Seat normalization;
- observability for rate-limit/recovery/fallback events without logging credentials/private hands.

Acceptance: abusive anonymous traffic cannot create unbounded cost/state and production boundaries match [`security.md`](security.md).

## 4. Dou Dizhu completeness

Only fill rule gaps that materially block the current product experience:

- bidding / rob-landlord;
- landlord resolution from bidding rather than pre-game random assignment;
- bidding score/settlement;
- bomb/rocket multipliers;
- spring / anti-spring;
- regression coverage for the selected rule profile.

Acceptance: rules docs, engine, tests, Human UI, and Agent-visible state agree exactly.

## 5. Multiple connected Actors and richer relationships

Defer until current single-connected-Actor modes are stable. When needed, extend only through the Seat/Actor/Binding/capability model:

- multiple Join capabilities per Room;
- all-ready gating for multiple connected player Seats;
- multiple advisors on one Seat;
- public-only spectator/commentator Actors that cannot see private Seat state;
- per-turn one-shot delegation leases;
- explicit leave/revoke flows for individual Actor credentials.

Do not add these as `participant.kind` special cases.

Acceptance: every connected Actor has independent identity/credential/scope and hidden-information access is explicit.

## 6. Cross-device identity only when needed

Current Human identity is anonymous and browser/device-local. Do not introduce a database/account system solely for one-Room resume.

If product needs become cross-Room/cross-device:

- optional account attachment/claim of anonymous Actor identity;
- device list/revoke/rotation;
- Room/history indexing across Durable Objects;
- explicit profile/nickname/avatar semantics;
- D1/other global index only when cross-Room querying actually requires it.

Accounts must remain optional for core headless/public game rooms unless product requirements change.

## 7. Additional lifecycle adapters

- DSH after its lifecycle contract is well understood;
- other coding agents based on real demand;
- preserve canonical lifecycle semantics and fail-open/privacy behavior.

## 8. Arena / benchmark

Arena remains separate from casual waiting and is intentionally low priority while the core waiting/game loop is being stabilized:

- deterministic Agent-vs-Agent runner;
- reproducible seeds/config;
- public-decision replay;
- win/latency/fallback/tool-error metrics;
- explicit hard turn limits only where benchmark fairness needs them.

Do not import Arena hard timing or engagement behavior into Casual Human/Agent tables.

## Maintenance rule

When an item ships, update canonical docs/status and remove it here. Do not preserve implementation chronology as permanent design files.
