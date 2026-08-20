# Security and privacy

Waitloop runs beside tools that can access source code, terminals, credentials, and model context. Default policy is data minimization plus narrowly scoped capabilities.

## Lifecycle privacy

Lifecycle reporting does not require prompts, source, repository path, cwd, transcript, tool input/output, assistant output, reasoning, or native Agent session IDs.

Lifecycle credentials are separate from game credentials.

## Identifier is not credential

These grant no authority by themselves:

```text
Room ID
Seat ID
Actor ID
Waitloop lifecycle session ID
```

That includes concrete current Seat identifiers such as `seat-1`, `seat-2`, and `seat-3`: knowing one never proves ownership or grants private-view/play rights.

Current credential/capability classes:

- `wldev_...` — lifecycle device credential;
- `wlview_...` — one Room Human viewer credential;
- `WL-...` — short-lived one-time Join capability;
- `wlseat_...` — room-scoped connected Actor credential (historical prefix);
- `wla_...` — persistent anonymous browser Actor credential.

Raw credentials are never stored as Room authorization state; digests are stored.

## Anonymous browser Actor identity

A Human browser may receive:

```text
actor_<opaque ID>
wla_<secret credential>
```

combined inside an HttpOnly `SameSite=Lax` cookie. The secret is not placed in URLs. A Room stores only its digest for that Actor.

If `wl_room_...` is missing, the browser can recover a fresh room viewer credential only when both Actor ID and secret validate against that Room.

The Actor ID alone is intentionally useless for takeover. This is browser/device-local anonymous identity, not a cross-device account.

## Seat / Actor authorization

Relevant capabilities:

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
- Advisor private-view grant applies only to the Seat explicitly named by its binding.
- temporary Bot takeover changes Controller, not ownership.

## Temporary Bot takeover / recovery

Eligible Seat owners or Room owner may explicitly replace an eligible Seat Controller with a deterministic temporary Bot.

Security invariants:

- native Bot Seat cannot be re-replaced through this mechanism;
- temporary Bot gets no `seat:control` ownership power;
- original owner stays unchanged;
- connected owner must reconnect before browser-side restore;
- reconnect itself never steals Controller authority;
- connected Seat owner explicitly uses `take_control()`;
- stale move revision checks remain active throughout.

This prevents simultaneous Human/Agent/Bot controller races.

## Hidden information

- construct projections from allowed fields; never serialize internal state then redact;
- unrelated Seat hands never leave server;
- lobby hides dealt cards/landlord before connected readiness;
- Human browser projection omits exhaustive `legalMoves[]`;
- connected Actor gets only bound Seat private view;
- temporary Bot is server-internal and receives authoritative Seat legal moves only.

## Join / Room lifetime

Current new-Room baseline:

```text
Join code      ~20 minutes, one-time claim
Room           ~24 hours
room Actor credential reconnectable only while Room is active
```

Expiry is a security boundary, not merely UI metadata. Expired Room state is lazily removed on access.

## Rate limiting / request bounds

Current safeguards:

- JSON bodies capped at 16 KiB;
- Cloudflare native room creation limit: 30/min per remembered Actor, falling back to connection IP for anonymous/headless callers;
- hosted-agent room create: tighter 5/min limit;
- per-GameRoom Join claim attempts;
- per-Actor MCP connect/read/move/comment/control limits;
- per-Actor Human viewer mutation/control/recovery limits.

The Cloudflare Rate Limiting binding is deliberately treated as permissive abuse protection, not accurate quota/accounting. Hosted inference still needs explicit cost budgets before broad public exposure.

## MCP boundary

Transport:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Room/Seat/Actor substitution is not model-visible input. All tool handlers re-resolve the authenticated Actor and check capabilities.

`yield_to_bot` and `take_control` are explicit owner actions; Casual elapsed time does not authorize them automatically.

## HTTP control plane

Because Web is optional, security must be server-side for:

```text
POST /api/v1/rooms
Join claim
/control
/fallback
Human play/pass/hint
```

Browser button visibility is never authorization.

## Remaining hardening

Still future work:

- lifecycle/pairing-specific rate limits;
- hosted inference budgets/quotas and accounting;
- stronger CSP/CORS/security headers review;
- private vulnerability reporting path;
- explicit retention/cleanup observability;
- more persisted-schema migration/recovery tests;
- account/cross-device identity only if product needs it.

CI continues to validate strict typing/tests, repository contract, browser JS, CLI package, and Worker dry-run.
