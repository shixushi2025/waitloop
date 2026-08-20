# Roadmap

This document contains only future work that is still relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

## 1. Connected Actor runtime efficiency

The Seat/Actor identity, anonymous browser recovery, explicit temporary Bot takeover, and reconnectable room credentials are implemented. Next improve Agent waiting/transport ergonomics:

- `wait_for_turn` or equivalent server-side long poll so Agents do not repeatedly poll `get_turn`;
- transport-level disconnect detection and richer presence state, without timer-forced Casual moves;
- stable local MCP bridge / optional automatic harness configuration so `waitloop join` need not require copying temporary MCP JSON;
- cleanup of local temporary MCP configuration after Room end;
- clearer MCP `clientInfo` labeling when the harness exposes it.

Acceptance: an Agent can join once, wait efficiently, disconnect/reconnect, and explicitly recover control with minimal model/tool churn.

## 2. Multiple connected Actors and richer relationships

Current Room modes intentionally have one joined connected Actor. Extend only through the Seat/Actor/Binding/capability model:

- multiple Join capabilities per Room;
- all-ready gating for multiple connected player Seats;
- multiple advisors on one Seat;
- public-only spectator/commentator Actors that cannot see private Seat state;
- per-turn one-shot delegation leases;
- explicit leave/revoke flows for individual Actor credentials.

Do not add these as `participant.kind` special cases.

Acceptance: every connected Actor has independent identity/credential/scope and hidden-information access is explicit.

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

## 4. Cross-device identity only when needed

Current Human identity is anonymous and browser/device-local. Do not introduce a database/account system solely for one-Room resume.

If product needs become cross-Room/cross-device:

- optional account attachment/claim of anonymous Actor identity;
- device list/revoke/rotation;
- Room/history indexing across Durable Objects;
- explicit profile/nickname/avatar semantics;
- D1/other global index only when cross-Room querying actually requires it.

Accounts must remain optional for core headless/public game rooms unless product requirements change.

## 5. Dou Dizhu completeness

- bidding / rob-landlord;
- landlord resolution from bidding rather than pre-game random assignment;
- bidding score/settlement;
- bomb/rocket multipliers;
- spring / anti-spring;
- regression coverage for the selected rule profile.

Acceptance: rules docs, engine, tests, Human UI, and Agent-visible state agree exactly.

## 6. Additional lifecycle adapters

- DSH after its lifecycle contract is well understood;
- other coding agents based on real demand;
- preserve canonical lifecycle semantics and fail-open/privacy behavior.

## 7. Arena / benchmark

Arena remains separate from casual waiting:

- deterministic Agent-vs-Agent runner;
- reproducible seeds/config;
- public-decision replay;
- win/latency/fallback/tool-error metrics;
- explicit hard turn limits only where benchmark fairness needs them.

Do not import Arena hard timing or engagement behavior into Casual Human/Agent tables.

## Maintenance rule

When an item ships, update canonical docs/status and remove it here. Do not preserve implementation chronology as permanent design files.
