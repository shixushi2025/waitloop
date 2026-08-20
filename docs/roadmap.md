# Roadmap

This document contains only **future work that is still relevant**. Completed implementation phases are removed; durable behavior belongs in the canonical subsystem docs instead.

Current implemented state is tracked in [`status.md`](status.md).

## 1. Public hardening

Before broader public exposure:

- rate limiting for room creation, pairing, lifecycle ingest, MCP mutation, and hosted inference;
- room/join/temporary credential cleanup and expiry policy;
- hosted-agent usage budgets and quotas;
- stronger CSP/CORS/security headers and production review;
- clearer private security-reporting path;
- migration/recovery tests for persisted Durable Object state.

Acceptance:

- abusive anonymous traffic cannot create unbounded inference/state cost;
- expired rooms/credentials do not remain indefinitely useful;
- production headers/auth boundaries match [`security.md`](security.md).

## 2. Connected-agent resilience

Improve long-running connected-agent tables without adding a hard casual turn clock:

- reconnect/disconnect state;
- soft elapsed warnings;
- explicit user-controlled `replace with bot` takeover;
- temporary MCP configuration cleanup after the room ends;
- better client identity/labeling when MCP client metadata is available;
- clearer recovery when a join code is claimed but the MCP client never connects.

Acceptance:

- a disconnected/stalled connected agent never forces the user to abandon the table;
- takeover is explicit, not triggered by an arbitrary casual-game timer;
- seat credentials remain scoped to one room.

## 3. Dou Dizhu completeness

Add the missing rules layer after the current play loop is stable:

- bidding / rob-landlord phase;
- landlord resolution from bidding rather than pre-game random assignment;
- bidding score and settlement model;
- bomb/rocket multipliers;
- spring / anti-spring rules;
- regression coverage for the selected rule profile.

Acceptance:

- [`doudizhu-rules.md`](doudizhu-rules.md), engine behavior, tests, human UI, and agent-visible state agree exactly.

## 4. Lifecycle/browser account model

The current public game-room credential model is independent of coding-agent lifecycle-session access. If account-backed lifecycle UI/device management is introduced:

- browser session/ticket flow for lifecycle sessions;
- device list/revoke/rotation UX;
- explicit account/device ownership boundaries;
- no regression to Worker-wide browser secrets.

Do not make accounts a prerequisite for the core game-room flow unless the product requirement changes.

## 5. Additional lifecycle adapters

- implement DSH only after its lifecycle integration contract is well understood;
- add other coding agents based on real demand;
- preserve the canonical Waitloop lifecycle protocol instead of adding vendor semantics to core packages.

Each adapter must preserve fail-open delivery and the lifecycle privacy contract.

## 6. Arena / benchmark mode

Arena is a separate experiment/evaluation policy, not the default waiting experience.

Potential capabilities:

- deterministic agent-vs-agent match runner;
- reproducible seeds/configurations;
- public-decision replay logs;
- win rate, latency, fallback, and tool-call error metrics;
- explicit hard turn limits where benchmark fairness requires them.

Do not import Arena timeout/engagement behavior into casual human waiting tables.

## Roadmap maintenance rule

When one of these items ships:

1. update the relevant canonical docs;
2. update [`status.md`](status.md);
3. remove the completed item from this roadmap;
4. do not create a permanent `feature-v2.md` to preserve the implementation history.