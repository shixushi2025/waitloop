# Security and privacy

Waitloop runs beside tools that can access source, terminals, credentials, and model context. Default policy is data minimization plus narrowly scoped capabilities.

## Lifecycle privacy

Lifecycle reporting does not require prompts, source, repository path, cwd, transcript, tool input/output, assistant output, reasoning, or native Agent session IDs.

Lifecycle credentials are separate from all game credentials.

## Identifier is not credential

These grant no authority by themselves:

```text
Room ID
Seat ID (`seat-1`, `seat-2`, `seat-3`)
Actor ID
lifecycle session ID
```

Credential classes:

```text
wldev_  lifecycle device
wlview_ one Room Human viewer
WL-     short-lived one-time Join capability
wlseat_ one Room connected Actor binding
wla_    persistent anonymous browser Actor
```

Server authorization state stores digests, not raw secrets.

## Local MCP credential custody

The stable local bridge runs as:

```text
waitloop mcp
```

It reads Room credentials only from private local Join cache and returns safe metadata/snapshots through model-visible tools.

Local files:

```text
~/.waitloop/joins/WL-....json
~/.waitloop/joins/active.json
```

Security properties:

- Join credential file uses private file mode where supported;
- active pointer contains code/server context, not another bearer token;
- default `waitloop join` and `--json` output omit raw MCP headers;
- raw configuration requires explicit `--raw-mcp`;
- local MCP `create_room`, `join_room`, and gameplay results never include the bearer token;
- expired credential/cache entries are ignored/removed before reuse;
- local bridge does not transmit unrelated local data.

The bridge is a credential broker, not an authorization authority. Server capability/revision checks remain mandatory.

## Anonymous browser Actor identity

A Human browser may receive `actor_...` plus `wla_...` in an HttpOnly `SameSite=Lax` cookie. The secret is not placed in URLs; each Room stores only its digest.

If the Room viewer cookie is missing, both Actor ID and secret must validate before issuing a fresh viewer credential. Actor ID alone is intentionally useless for takeover.

## Seat / Actor authorization

```text
room:view-public
room:manage
seat:view-private
seat:inspect-legal
seat:play
seat:control
room:comment
```

- Room owner gets `room:manage`.
- Seat owner gets `seat:control`.
- only active Controller gets `seat:play`.
- Advisor private view applies only to its explicit Seat binding.
- temporary Bot takeover changes Controller, not ownership.

## Temporary Bot takeover / recovery

Security invariants:

- native Bot Seats cannot be re-wrapped through fallback;
- temporary Bot gets no owner/`seat:control` authority;
- original owner remains unchanged;
- connected owner must reconnect before restore;
- reconnect never steals Controller authority;
- Seat owner explicitly uses `take_control()`;
- stale revision checks stay active.

## Hidden information

- build projections from allowed fields rather than serialize-then-redact;
- unrelated Seat hands never leave server;
- lobby hides cards/landlord before readiness;
- Human projection omits exhaustive machine legal moves;
- connected Actor receives only its bound Seat private view;
- local MCP proxies the same server projection and does not widen it.

## Join / Room lifetime

```text
Join capability ~20 minutes, one-time
Room            ~24 hours
Room credential reconnectable only while Room is active
```

Expiry is an authorization boundary. GameRoom lazily deletes expired state; CLI lazily invalidates expired local cache/active selection.

## Remote MCP boundary

Transport:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Remote tools:

```text
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Room/Seat/Actor substitution is not model-supplied gameplay input. Every handler authenticates the Actor and checks server capabilities.

### Wait security

`wait_for_turn` has bounded input and execution:

```text
minimum 1 s
maximum 25 s
poll about 750 ms
```

It uses authenticated reads under the existing per-Actor MCP-read budget. Timeout is transport-only and cannot:

```text
auto-pass
play a move
change Controller
trigger Bot fallback
create a competitive clock
```

This prevents a waiting optimization from becoming hidden game authority.

## Local control tools

Local `create_room` and `join_room` call the same public server endpoints as raw clients. They do not create an alternate privileged channel.

`leave_room` is deliberately local-only and reports that the credential was not revoked. Future revoke/leave semantics must be explicit rather than silently destroying recovery capability.

## Rate limiting / request bounds

Current safeguards:

- JSON body cap 16 KiB;
- Cloudflare Room create 30/min per remembered Actor, IP fallback;
- Hosted Room create 5/min;
- per-Room Join claim attempts;
- per-Actor MCP connect/read/move/comment/control;
- per-Actor Human mutation/control/recovery.

Rate limiting is abuse mitigation, not quota/accounting. Hosted inference still needs explicit budgets before broad exposure.

## Harness configuration safety

Stable MCP installation uses the harness's own CLI configuration interface. It checks for an existing `waitloop` MCP definition and does not overwrite it automatically.

Lifecycle hook trust remains owned by the harness. Installing stable MCP does not imply trusting lifecycle hooks, and Plugin packaging does not bypass command-hook review.

CLI nested help is side-effect free and cannot install hooks/MCP.

## Remaining hardening

- lifecycle/pairing-specific rate limits;
- hosted inference budgets/quotas/accounting;
- stronger CSP/CORS/security-header review;
- private vulnerability reporting path;
- explicit expired cache/Room cleanup observability;
- persisted-schema migration/recovery tests;
- revocation semantics for individual Room Actor credentials;
- account/cross-device identity only when product requirements justify it.

CI validates strict typing/tests, repository/onboarding contracts, CLI package behavior, browser JavaScript, Agent discovery, and Worker dry-run.
