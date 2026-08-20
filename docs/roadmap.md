# Roadmap

This document contains only future work that is still relevant. Completed implementation belongs in canonical subsystem docs and [`status.md`](status.md).

## 1. Public hardening

Before broader public exposure:

- rate limiting for room creation, Join claim, pairing, lifecycle ingest, MCP mutation/comments, and hosted inference;
- room/temporary Actor credential cleanup and expiry policy;
- hosted-agent budgets/quotas;
- stronger CSP/CORS/security headers and production review;
- private security-reporting path;
- migration/recovery tests for persisted Durable Object state, including legacy participant -> Actor/Seat normalization.

Acceptance: anonymous traffic cannot create unbounded cost/state; expired capabilities are unusable; production boundaries match [`security.md`](security.md).

## 2. Connected Actor runtime efficiency/resilience

The current Actor/Seat/control model is in place. Improve the runtime without adding a hard casual clock:

- `wait_for_turn` or equivalent server-side long poll so Agents do not repeatedly poll `get_turn`;
- reconnect/disconnect state and clearer MCP client identity where available;
- explicit owner-controlled replace-with-bot takeover for stalled/disconnected controllers;
- stable local MCP bridge / optional automatic harness configuration so `waitloop join` does not require copying temporary MCP JSON;
- cleanup of temporary MCP configuration after room end;
- clearer recovery when a Join code is claimed but the Actor never connects.

Acceptance: normal Agent gameplay can wait efficiently; disconnects do not force room abandonment; takeover remains explicit rather than timer-triggered.

## 3. Expand Actor relationships only when demanded

The current durable relations are `controller` and `advisor`, with one connected Actor Join per current mode. Future extensions may include:

- multiple advisors on one Seat;
- public-only spectator/commentator Actors that cannot see private Seat state;
- multiple connected player Seats with all-ready gating;
- per-turn one-shot delegation rather than persistent control;
- richer comment/event policies.

Do not add these as `participant.kind` special cases. Extend the Actor/Seat/Binding/capability model.

Acceptance: new relations preserve explicit private-view consent and server-side capability authorization.

## 4. Dou Dizhu completeness

- bidding / rob-landlord;
- landlord resolution from bidding rather than pre-game random assignment;
- bidding score/settlement;
- bomb/rocket multipliers;
- spring / anti-spring;
- regression coverage for the selected rule profile.

Acceptance: rules docs, engine, tests, Human UI, and Agent-visible state agree exactly.

## 5. Lifecycle/browser account model

If account-backed lifecycle/device management is introduced:

- browser session/ticket flow for lifecycle sessions;
- device list/revoke/rotation UX;
- explicit account/device ownership;
- no regression to Worker-wide browser secrets.

Accounts are not currently required for headless/public game rooms.

## 6. Additional lifecycle adapters

- DSH after its lifecycle contract is well understood;
- other coding agents based on real demand;
- preserve canonical lifecycle semantics and fail-open/privacy behavior.

## 7. Arena / benchmark

Arena remains a separate policy from casual waiting:

- deterministic agent-vs-agent runner;
- reproducible seeds/config;
- public-decision replay;
- win/latency/fallback/tool-error metrics;
- explicit hard turn limits only where benchmark fairness needs them.

Do not import Arena hard timing or engagement behavior into casual Human/Agent tables.

## Maintenance rule

When an item ships:

1. update its canonical docs;
2. update [`status.md`](status.md);
3. remove it here;
4. delete transitional design notes after extracting durable decisions.
