# Security and privacy

Waitloop runs beside tools that can access source code, terminals, repositories, credentials, and model context. The safest default is to avoid collecting that data and keep every credential/capability narrowly scoped.

## Lifecycle data minimization

Lifecycle reporting needs only agent kind, opaque Waitloop session ID, lifecycle state, event ID, timestamp, and optional source ordering.

It does not require prompts, source code, filenames, repository URLs, cwd, commands/output, transcripts, tool payloads, assistant output, reasoning, or native agent session/turn IDs.

Game participation is a separate authorization domain.

## Identifier vs credential

Routing/context identifiers are not authorization secrets:

- room ID routes to a `GameRoom` but grants no room capability;
- Waitloop session ID identifies lifecycle state but grants no account authority;
- Join code is one-time capability material, not ongoing MCP authorization;
- Seat ID identifies a game position but grants no permission to inspect/control it.

## Credential classes

### Lifecycle device credential — `wldev_...`

Scoped to lifecycle reporting (`agent:write`). It never authorizes game/MCP/browser/admin actions.

### Browser room viewer credential — `wlview_...`

Stored as a room-scoped HttpOnly cookie. It authenticates the Human Actor/viewer for that room. Room ID alone is insufficient.

### Join code — `WL-...`

Short-lived capability that may issue one connected **Actor** credential. The Join response identifies the Actor's bound Seat and relation (`controller` or `advisor`).

### Game Actor credential — historical prefix `wlseat_...`

The prefix remains for compatibility, but the durable meaning is now one room-scoped Actor binding, not necessarily an independently owned player Seat.

- server stores only a digest;
- supplied in MCP `Authorization` header;
- may represent a controller or advisor;
- never reusable as lifecycle/account/device authority;
- discard after the room.

## Seat/Actor capability model

Game authorization is based on Actor binding/capabilities rather than client type.

Relevant capabilities:

```text
room:view-public
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

Security consequences:

- only the active Controller receives `seat:play`;
- only the Seat owner receives `seat:control`;
- an advisor may receive `seat:view-private` and `seat:inspect-legal` for the **single Seat it was explicitly bound to**;
- an advisor must not gain another unrelated Seat's private view;
- switching Controller changes authorization only; it does not transfer ownership or alter game state;
- browser button state is never treated as authorization.

## Advisor private-view consent

`companion-agent` explicitly creates an advisor binding to the Human Seat. That binding is the user's authorization for the Agent to see that Seat's hand/legal options.

The runtime must not generalize this permission into spectator-wide hidden information. Tests should cover that advisors cannot select another Seat/private projection.

## Human control delegation

When the Human owner delegates control:

- Human keeps its own private Seat view;
- Human play/pass/hint endpoints reject mutation because `seat:play` is absent;
- connected Agent `play_move` becomes authorized only after it is active Controller;
- Human can take control back through owner-authorized control-plane mutation;
- concurrent/stale actions remain protected by room revision.

This prevents Human and Agent from racing the same Seat as simultaneous controllers.

## Hidden-information projection

Mandatory invariants:

- internal state is never serialized then redacted as a privacy mechanism;
- unrelated Seats' private hands are never returned;
- lobby Human projection hides dealt cards/landlord before connected readiness;
- browser Human projection omits exhaustive machine legal moves;
- machine Actor projection is derived from its bound Seat only;
- production logs should not contain private hands by default.

## MCP boundary

MCP identity is transport-bound:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Model-visible tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

Do not expose room/Actor/Seat substitution or raw credentials as normal tool arguments.

`play_move` re-checks active Controller capability and room revision. `comment` is bounded and writes only a side channel; it must not change game revision/turn/legality.

## Client-neutral Room API

Web is not a required trust boundary for Agent use. Headless Agents may call `POST /api/v1/rooms`, claim a Join capability, and use MCP directly.

Therefore security/rate limits must live at HTTP/DO boundaries, not only in Web UI affordances.

Public room creation and Join claim are current alpha surfaces; rate limiting/abuse controls remain required before broad public exposure.

## Event replay and staleness

Reject/ignore as appropriate:

- duplicate lifecycle mutation IDs;
- stale source sequences;
- stale game revisions;
- moves from non-active Controllers;
- out-of-turn/illegal moves;
- control delegation by non-owners;
- delegation to an Actor not bound to the same Seat;
- delegation to a disconnected connected Agent;
- invalid/expired/already-claimed Join codes;
- invalid viewer/Actor credentials;
- invalid/oversized comments.

## Adapter behavior

Lifecycle hooks/adapters must use bounded timeouts, fail open with respect to coding work, preserve unrelated configuration, and never weaken host-agent trust/security settings.

## Web/API security baseline

Production controls should include HTTPS, restrictive CORS/origin behavior, CSRF protections for cookie mutations, CSP/security headers, bounded bodies, stable errors, and rate limits for pairing, room create, Join claim, MCP, lifecycle ingest, control delegation, comments, and hosted inference.

Model-backed seats additionally need cost/usage budgets.

## Supply chain and CI

CI validates frozen installs, strict TypeScript/tests, repository-contract synchronization, CLI package contents, browser JavaScript, and Worker dry-run bundling. Security-sensitive Actor/Seat changes require capability and hidden-information regression tests.

Secret/advisory scanning should expand as the public surface grows.

## Security reporting

A dedicated private security reporting path remains part of production hardening; public issues should not become the place for exploit details once that path exists.
