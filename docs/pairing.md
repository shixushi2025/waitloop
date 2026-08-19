# Device pairing and scoped credentials

Waitloop needs a way for local coding-agent adapters to report lifecycle events without copying a Worker-wide secret onto every machine. This document defines the credential model before the public account/login flow exists.

The design separates three concepts that must not be conflated:

- **device ID** — an opaque local identifier used for display/correlation; never authorization
- **pairing/bootstrap authority** — a short-lived or privileged mechanism that is allowed to create a device credential
- **device credential** — a revocable bearer credential scoped to a narrow set of Waitloop APIs

## Security invariants

1. A `deviceId` is not proof of identity and must never authorize a request by itself.
2. Raw device credentials are returned only at issuance and are never stored server-side.
3. The server stores a SHA-256 digest of each device credential.
4. Device credentials never appear in URLs, query strings, browser history, game room URLs, or logs intentionally emitted by Waitloop.
5. Lifecycle credentials are scoped. The first scope is `agent:write`; it does not grant room administration, MCP seat access, or arbitrary private API access.
6. Device issuance rotates the previous credential for the same device ID.
7. A device can revoke its own credential.
8. Lifecycle adapters remain fail-open: an unavailable Waitloop service must not block Claude Code, Cursor, Codex, or another coding agent.
9. The current Worker-wide `WAITLOOP_INGEST_TOKEN` remains only as a migration fallback and should be removed after device pairing is deployed and migrated.
10. The alpha bootstrap mechanism described below is **not** the final public pairing experience.

## Target public flow

The intended user experience is:

```text
$ waitloop pair

pairing request created
code      WL-7K2M
expires   05:00

opening https://waitloop.run/pair/WL-7K2M
                ↓
user signs in / confirms device
                ↓
server marks pairing request approved
                ↓
CLI exchanges the short-lived request secret
                ↓
server returns one device credential
                ↓
~/.waitloop/config.json stores it privately
```

Important properties:

- the browser receives only a public pairing identifier/code, not the eventual bearer credential;
- the CLI keeps a high-entropy pairing verifier locally;
- approval and credential issuance are separate steps;
- pairing requests expire quickly and are one-time-use;
- the issued device credential can later be listed/revoked from the account UI;
- no Worker-wide secret is ever copied to an end-user machine.

This public flow requires a real account/session model and is therefore not implemented merely by inventing an unauthenticated browser approval button.

## Alpha bootstrap flow

Before account auth exists, development needs a migration path away from `WAITLOOP_INGEST_TOKEN`. The temporary alpha flow is:

```text
$ waitloop pair --bootstrap-token <WAITLOOP_ACCESS_TOKEN>
                  ↓
POST /api/v1/devices/bootstrap
Authorization: Bearer <bootstrap token>
                  ↓
DeviceRegistry rotates/creates one device credential
                  ↓
response returns the raw device credential once
                  ↓
CLI stores only the device credential
bootstrap token is not persisted
```

The bootstrap endpoint is protected by the existing private-access authority and is also available on localhost for development. It is intentionally named `bootstrap` so it cannot be mistaken for the final public pairing contract.

The CLI should also accept a bootstrap token via environment variable for automation so it does not need to appear in shell history.

## Device credential format

A credential is an opaque, high-entropy token with a recognizable prefix:

```text
wldev_<random material>
```

The prefix is for secret scanning/supportability only. Authorization relies on entropy and server-side verification, not on the prefix.

The server calculates:

```text
SHA-256(raw credential)
```

and stores only the digest.

## DeviceRegistry Durable Object

The first implementation uses one singleton Durable Object as the authority for device credentials:

```text
DEVICE_AUTH.getByName("registry-v1")
```

This keeps issuance, rotation, validation, and revocation serialized and avoids introducing a database before the product needs accounts.

### Storage model

```ts
interface DeviceRecordV1 {
  version: 1;
  deviceId: string;
  tokenHash: string;
  scopes: DeviceScopeV1[];
  createdAt: number;
}

type DeviceScopeV1 = "agent:write";
```

Storage keys:

```text
device-token:<sha256>  -> DeviceRecordV1
device-id:<deviceId>   -> current token hash
```

Issuing a new credential for a device ID deletes its previous `device-token:*` record before writing the replacement.

Revocation deletes both the token record and the device ID pointer when they still refer to one another.

## Authorization rules

### Lifecycle ingestion

`POST /api/v1/agent-events` accepts, in order:

1. localhost development bypass;
2. a valid device credential containing `agent:write`;
3. the legacy `WAITLOOP_INGEST_TOKEN` migration fallback.

A valid device token is sufficient only for lifecycle ingestion in this phase.

### Private browser/game APIs

The current `WAITLOOP_ACCESS_TOKEN` boundary remains in place for private browser/game APIs during this phase. A device lifecycle credential must **not** silently inherit those permissions.

A later browser-auth layer should exchange an account/device approval for an HttpOnly browser session or short-lived browser ticket. Long-lived device bearer tokens must not be placed into browser URLs.

### MCP game seats

MCP seat credentials remain separate and room/seat-scoped. Pairing a coding agent device must not give it access to every game seat.

## CLI configuration

After alpha bootstrap, local config may contain:

```json
{
  "version": 1,
  "url": "https://waitloop.run",
  "deviceId": "device-opaque-uuid",
  "deviceToken": "wldev_..."
}
```

Legacy `ingestToken`/`accessToken` fields remain temporarily readable for migration but should not be required by the normal install path.

`waitloop config` must redact all secrets.

Lifecycle delivery chooses credentials in this order:

1. `WAITLOOP_DEVICE_TOKEN`
2. config `deviceToken`
3. legacy `WAITLOOP_INGEST_TOKEN`
4. legacy config `ingestToken`

## CLI commands

Alpha commands:

```text
waitloop pair --bootstrap-token TOKEN
waitloop pair                         # uses WAITLOOP_BOOTSTRAP_TOKEN when present
waitloop unpair
```

`pair`:

- requires existing local config/device ID (or initializes it first);
- sends the bootstrap token only in the HTTP Authorization header;
- stores the newly issued device credential;
- removes any saved legacy ingest token from the normal lifecycle path when migration is complete;
- never prints the raw credential unless an explicit development-only diagnostic is added later.

`unpair`:

- calls the device self-revoke endpoint with the device credential;
- removes the local device credential even when the remote credential is already gone;
- leaves the opaque device ID so re-pairing can rotate/reuse the same local device identity.

## HTTP alpha contract

### Bootstrap

```http
POST /api/v1/devices/bootstrap
Authorization: Bearer <WAITLOOP_ACCESS_TOKEN>
Content-Type: application/json

{
  "version": 1,
  "deviceId": "device-..."
}
```

Response:

```json
{
  "version": 1,
  "deviceId": "device-...",
  "deviceToken": "wldev_...",
  "scopes": ["agent:write"]
}
```

The raw `deviceToken` is not retrievable again.

### Self revoke

```http
DELETE /api/v1/devices/current
Authorization: Bearer <device token>
```

Response:

```json
{
  "version": 1,
  "revoked": true
}
```

## Threat model notes

### Token theft

A device token is a bearer credential. Theft grants its scopes until revocation. Mitigations:

- narrow scope;
- private local file permissions;
- never include it in URLs;
- never persist raw server-side;
- explicit revoke/rotation;
- later use OS credential storage where practical.

### Fake device IDs

An attacker can invent any device ID. This is harmless because the ID has no authorization value; only an authorized issuance path can bind a credential to it.

### Replay

Lifecycle requests are bearer-authenticated and events already have `eventId`/session reduction rules. Credential replay itself is possible until revocation, as with any bearer token. Future account-backed credentials can add expiry/rotation without changing the event protocol.

### Bootstrap token exposure

The alpha bootstrap token is intentionally temporary. It should preferably be supplied through `WAITLOOP_BOOTSTRAP_TOKEN` rather than a command-line argument and must never be written to config.

## Migration to the final account flow

The DeviceRegistry credential schema is designed to survive the account phase. The later pairing service needs to change only **who is authorized to call issue**, not how local lifecycle adapters authenticate afterward.

Future additions can include:

- `accountId` on device records;
- display name/platform/last-used metadata;
- credential expiry/rotation;
- account UI device list and revoke;
- short-lived browser pairing requests;
- signed/opaque browser sessions for private session/game APIs.

The lifecycle event protocol and coding-agent adapters should not need to change when these are added.
