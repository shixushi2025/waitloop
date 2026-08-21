# Security and privacy

Waitloop runs beside tools that can access source, terminals, credentials, model context, and now embedded interactive UI. Default policy is data minimization plus narrowly scoped, independently verified capabilities.

## Lifecycle privacy

Lifecycle reporting does not require prompts, source, repository path, cwd, transcript, tool input/output, assistant output, reasoning, or native Agent session IDs.

Lifecycle credentials are separate from Agent Room, Human Room, and MCP App credentials.

## Identifier is not credential

These grant no authority by themselves:

```text
Room ID
Seat ID (`seat-1`, `seat-2`, `seat-3`)
Actor ID
lifecycle session ID
MCP App resource URI
```

Credential/capability classes:

```text
wldev_  lifecycle device credential
wlview_ one Room Human viewer credential
WL-     short-lived one-time Agent Join capability
wlseat_ one Room connected Agent Actor binding
wla_    persistent anonymous Human Actor credential
wlui_   one local interactive Human Room App capability
```

Server authorization state stores digests, not raw server credentials. The `wlui_` capability is local-bridge state and is not sent to GameRoom.

## Local Agent MCP credential custody

The stable local bridge runs as:

```text
waitloop mcp
```

Agent Room files:

```text
~/.waitloop/joins/WL-....json
~/.waitloop/joins/active.json
```

Security properties:

- Join credential file uses private mode where supported;
- active pointer contains code/server context, not another bearer token;
- default `waitloop join` and `--json` output omit raw MCP headers;
- raw configuration requires explicit `--raw-mcp`;
- local `create_room`, `join_room`, and Agent gameplay results never include the bearer token;
- expired Agent credential/cache entries are ignored/removed before reuse;
- credential-shaped local errors are redacted;
- local bridge does not transmit unrelated local data.

The bridge is a credential broker, not an authorization authority. Server capability/revision checks remain mandatory.

## Human MCP App threat model

`open_game()` allows a Human to operate a game inside an MCP Apps-capable Host. This introduces three trust boundaries:

```text
model
Host + sandboxed App
local MCP bridge
```

The model may receive safe Human game state so it can describe/comment, but must not automatically receive Human mutation authority.

### Human Room cookie custody

`open_game()` calls the existing Human `bots` Room endpoint. The Worker returns:

```text
wl_actor
wl_room_<room>
```

The local bridge captures only these expected cookies from `Set-Cookie`, validates names/value bounds, and stores them under:

```text
~/.waitloop/app-rooms/<sha256(room-id)>.json
```

Properties:

- directory and files use private modes where supported;
- file name does not reveal the raw Room ID;
- model-visible tool content never contains either cookie;
- the `ui://` resource contains neither cookie;
- the App performs no direct credentialed HTTP request;
- all Human requests flow through the bridge to existing Room APIs;
- 401/403/404/410 invalidates stale local App session state.

### Private App capability

Each Human App Room receives a random:

```text
wlui_<64 hex characters>
```

The capability is:

- generated locally with high entropy;
- stored beside the private Human cookies;
- delivered to the embedded App only in `tool result _meta["waitloop/uiToken"]`;
- absent from `content[].text` and `structuredContent`;
- absent from tool/resource source and public docs as a concrete value;
- required by `ui_get_game`, `ui_play_cards`, `ui_pass`, and `ui_hint`;
- compared with constant-time equality before Human Room credentials are used;
- redacted from errors.

The app-only visibility metadata:

```json
{
  "ui": {
    "resourceUri": "ui://waitloop/doudizhu/v1",
    "visibility": ["app"]
  }
}
```

is defense in depth. A Host bug that exposes app-only tool definitions to the model does not itself provide the `wlui_` capability.

### Safe tool result

`open_game` returns safe content containing:

```text
Room ID
Human snapshot
mode/game/UI version
fallback description
```

It does not return:

```text
Human cookies
wlui_ capability
local file path
Set-Cookie headers
```

The same safe payload is duplicated in text and `structuredContent` for Host compatibility. Only result `_meta` contains App-private information.

### MCP App resource safety

The resource is:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

Security properties:

- self-contained HTML/CSS/JavaScript;
- no external `<script src>` or stylesheet;
- no concrete credential embedded;
- no direct fetch/XHR/WebSocket path;
- uses only Host postMessage MCP Apps protocol;
- validates incoming message shape and tool payload type;
- card/action controls remain disabled without Host server-tool support and a valid private App capability;
- unsupported Host shows explicit fallback rather than pretending an action succeeded;
- teardown stops polling.

The Host remains responsible for sandboxing according to MCP Apps rules. Waitloop does not request unnecessary network/resource permissions.

### Host metadata confidentiality assumption

The security design relies on the MCP Apps contract that result `_meta` is delivered to the App but not incorporated into model-visible content. Waitloop still avoids treating Host-side visibility as the only control by requiring the capability on every Human app-only request.

A Host that deliberately discloses all tool-result `_meta` to the model violates this boundary and can expose App-local capabilities. Such a Host should not be used for sensitive MCP Apps.

### Browser fallback

The fallback URL starts a separate standalone game. Waitloop does not append Human cookies or the `wlui_` capability to the URL. Same-Room transfer is intentionally unsupported until a short-lived, explicit transfer capability is designed.

## Anonymous Human Actor identity

A Human browser may receive `actor_...` plus `wla_...` in an HttpOnly `SameSite=Lax` cookie. The secret is not placed in URLs; each Room stores only its digest.

If the Room viewer cookie is missing, both Actor ID and secret must validate before issuing a fresh viewer credential. Actor ID alone is useless for takeover.

The local MCP App uses the same server-side identity model but retains the cookies in the local bridge rather than an iframe/browser cookie jar.

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
- Human MCP App actions still pass through the ordinary Human Room credential/capability/revision checks.

## Human/Agent ownership separation

```text
open_game
  Human owns/controllers seat-1
  Human cookie authorization

create_room
  Agent owns/controllers seat-1
  wlseat_ authorization
```

The embedded Human UI must not use `wlseat_` or invoke Agent `play_move` to mutate the Human Seat. Likewise the model must not use Human `ui_*` tools without the App capability.

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
- standalone Human projection omits exhaustive machine legal moves;
- connected Agent receives only its bound Seat private view;
- local Agent MCP proxies the same server projection and does not widen it;
- local Human MCP App receives only the ordinary Human projection for its authenticated Seat;
- App capability controls transport access, not a broader projection.

## Join / Room lifetime

```text
Join capability ~20 minutes, one-time
Room            ~24 hours
Room credential reconnectable only while Room is active
```

Expiry is an authorization boundary. GameRoom lazily deletes expired state; CLI lazily invalidates expired Agent Join cache and Human App session state.

## Remote Agent MCP boundary

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

Remote Room MCP does not expose `open_game` or Human `ui_*` tools because it cannot safely own local Human cookies/App capability.

### Wait security

`wait_for_turn` has bounded input and execution:

```text
minimum 1 s
maximum 25 s
poll about 750 ms
```

It uses authenticated reads under the existing per-Actor MCP-read budget. Timeout cannot auto-pass, play, change Controller, trigger Bot fallback, or create a competitive clock.

## Mutation cancellation boundary

Cancellation is propagated only through safe read/wait operations:

```text
get_active_room
get_turn
wait_for_turn
ui_get_game
ui_hint
```

Mutation-capable operations are not abandoned mid-flight under an implied “not executed” guarantee:

```text
open_game create
create_room
join_room
leave_room
play_move
comment
yield_to_bot
take_control
ui_play_cards
ui_pass
```

After an uncertain mutation transport failure, clients refresh authoritative state before retrying.

## Local control tools

Local `open_game`, `create_room`, and `join_room` call existing public server endpoints. They do not create an alternate privileged server channel.

`leave_room` is deliberately local Agent-state cleanup and reports that the credential was not revoked. Future revoke/leave semantics must be explicit rather than silently destroying recovery capability.

## Rate limiting / request bounds

Current safeguards:

- JSON body cap 16 KiB;
- Cloudflare Room create 30/min per remembered Actor, IP fallback;
- Hosted Room create 5/min;
- per-Room Join claim attempts;
- per-Actor remote MCP connect/read/move/comment/control;
- per-Actor Human mutation/control/recovery;
- Human MCP App reuses existing Human Room limits and exact revision checks.

Rate limiting is abuse mitigation, not quota/accounting. Hosted inference still needs explicit budgets before broad exposure.

## Harness configuration safety

Stable MCP installation uses the harness's own CLI configuration interface. It checks for an existing `waitloop` MCP definition and does not overwrite it automatically.

Lifecycle hook trust remains owned by the harness. Installing stable MCP or rendering an MCP App does not imply trusting lifecycle hooks, and Plugin packaging does not bypass command-hook review.

CLI nested help is side-effect free and cannot install hooks/MCP.

## Deployment trust

- `fix/**` branches run full CI before direct fast-forward to `main`.
- packaged MCP stdio validation reads the UI resource and checks tool visibility/capability schemas.
- unit tests syntax-check embedded App JavaScript.
- Cloudflare production waits for exact-commit `ready-to-deploy`.
- manual deployment requires clean local `main` matching `origin/main` when available.

## Remaining hardening

- real-host MCP App compatibility matrix and smoke testing;
- App-session list/revoke/proactive expiry cleanup;
- explicit same-Room transfer capability to standalone browser, if justified;
- Human connected-agent/companion MCP App controls;
- lifecycle/pairing-specific rate limits;
- hosted inference budgets/quotas/accounting;
- stronger CSP/CORS/security-header review;
- private vulnerability reporting path;
- persisted-schema migration/recovery tests;
- revocation semantics for individual Room Actor credentials;
- account/cross-device identity only when product requirements justify it.

CI validates strict typing, 88 tests, repository/onboarding contracts, CLI package behavior, MCP/MCP Apps wire behavior, embedded/browser JavaScript, Agent discovery, and Worker dry-run.
