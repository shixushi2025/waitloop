# Waitloop CLI

The CLI is the local integration layer between Waitloop and coding agents. It owns local configuration, device credentials, agent detection, lifecycle hook installation, diagnostics, and opening the current waiting session.

It is deliberately thin. Game rules, room authority, MCP tools, and remote session state remain server-side.

## Goals

- one predictable local entry point: `waitloop`
- no prompt, source, transcript, repository, or tool-payload collection
- idempotent installs and safe uninstalls
- platform adapters stay thin and map into the canonical Waitloop lifecycle protocol
- local state is inspectable and removable
- scoped device credentials replace Worker-wide lifecycle secrets

## Local files

```text
~/.waitloop/
├── config.json
└── state/
    ├── claude-code/
    │   ├── <hashed-native-session>.json
    │   └── latest.json
    ├── cursor/
    │   ├── <hashed-native-session>.json
    │   └── latest.json
    └── codex/
        ├── <hashed-native-session>.json
        └── latest.json
```

`config.json` is written with private-file permissions where the OS supports them. A paired alpha configuration looks like:

```json
{
  "version": 1,
  "url": "https://waitloop.run",
  "deviceId": "device-opaque-uuid",
  "deviceToken": "wldev_..."
}
```

The device ID is only local/display identity. Authorization comes from the scoped `deviceToken`.

Legacy `ingestToken` and alpha `accessToken` fields remain readable for migration/development. A successful device pairing removes the saved legacy lifecycle ingest token from the normal path.

Local turn state contains only:

- adapter ID (`claude-code`, `cursor`, or `codex`)
- opaque Waitloop turn ID
- lifecycle state
- start/update timestamps

Native agent session identifiers are hashed only for temporary local filenames and are never sent to Waitloop.

## Commands

### Initialize

```bash
waitloop init
```

Options:

```text
--url URL
--ingest-token TOKEN       # legacy migration only
--access-token TOKEN       # alpha/private bootstrap only
--yes
```

Initialization creates or updates local config, preserves the existing device ID, detects installed coding agents, and can install all detected lifecycle adapters that Waitloop currently supports.

### Pair a device

The credential substrate is implemented now. Until the public browser/account approval flow exists, remote alpha environments use privileged bootstrap authority:

```bash
WAITLOOP_BOOTSTRAP_TOKEN=... waitloop pair
```

or, for development only:

```bash
waitloop pair --bootstrap-token TOKEN
```

Prefer the environment variable because command-line arguments can be retained by shell history/process inspection.

`waitloop pair`:

1. creates local config/device identity if necessary;
2. calls `POST /api/v1/devices/bootstrap`;
3. receives one `agent:write` device credential;
4. stores the credential privately;
5. never prints the raw credential;
6. removes the saved legacy lifecycle ingest token after successful migration.

The server persists only the SHA-256 digest of the raw device credential. See [`pairing.md`](pairing.md) for the authorization model and the planned short-lived browser approval flow.

### Unpair

```bash
waitloop unpair
```

The CLI first self-revokes the remote device credential, then removes it locally. If Waitloop is unreachable or returns a server error, the local credential is retained so revocation can be retried instead of silently abandoning a still-valid remote credential. A `401` means it is already invalid remotely and is safe to remove locally.

### Diagnostics

```bash
waitloop doctor
```

Checks local configuration, the Waitloop health endpoint, pairing state, and best-effort agent detection.

### Install and uninstall adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
waitloop install all

waitloop uninstall claude-code
waitloop uninstall cursor
waitloop uninstall codex
waitloop uninstall all
```

Installers merge only Waitloop-owned hook entries and preserve unrelated user hooks. Uninstallers remove only handlers whose command exactly matches the Waitloop command for that adapter.

## Claude Code lifecycle integration

The Claude installer writes to `~/.claude/settings.json` and installs:

```text
waitloop hook claude-code
```

Lifecycle mapping:

```text
UserPromptSubmit                    running
PermissionRequest                   waiting
Notification(permission/idle/etc.) waiting
Stop                                completed
StopFailure                         failed
SessionEnd                          local cleanup
```

The hook receives Claude's hook JSON on stdin but reads only `session_id` and `hook_event_name`. Prompt text, current directory, transcript path, tool input, and tool output are ignored.

## Cursor lifecycle integration

The Cursor installer writes version-1 hooks to `~/.cursor/hooks.json` and installs:

```text
waitloop hook cursor
```

for these events:

```text
beforeSubmitPrompt   running
stop/completed       completed
stop/aborted|error   failed
sessionEnd           local cleanup
```

The adapter uses `conversation_id` (or `generation_id` as a fallback) only as a local correlation key. That native ID is hashed before it is used in a local filename and is not included in the Waitloop network event. Prompt text, repository paths, output text, and any other Cursor hook fields are ignored.

The hook returns an empty JSON object so Waitloop does not attempt to steer or block Cursor's agent loop.

## Codex lifecycle integration

The Codex installer writes user-level hooks to `~/.codex/hooks.json` and installs:

```text
waitloop hook codex
```

for these events:

```text
UserPromptSubmit   running
PermissionRequest  waiting
Stop               completed
SessionEnd         local cleanup
```

Waitloop uses only Codex's `session_id` and `hook_event_name` for local correlation. It does not read or emit prompt text, `turn_id`, working directory, transcript path, tool input, or the last assistant message.

`UserPromptSubmit`, `PermissionRequest`, and `Stop` are installed as background hooks so lifecycle reporting cannot control or delay the agent loop. `SessionEnd` remains synchronous because Codex treats that event synchronously.

Codex requires non-managed command hooks to be reviewed and trusted. After installing the adapter, use Codex's `/hooks` UI to review the exact Waitloop hook definition before expecting lifecycle events.

## Current turn

```bash
waitloop status
waitloop open
waitloop open --print
```

`status` reads only adapter-local `latest.json` files. If multiple adapters have recent turns, all are shown newest first. `open` prefers a running/waiting turn and adds only its opaque Waitloop session ID as the `session` query parameter.

### Inspect configuration safely

```bash
waitloop config
```

Secret values are redacted; output shows only whether device, legacy ingest, and alpha access credentials are configured.

## Lifecycle credential order

Lifecycle delivery chooses credentials in this order:

```text
1. WAITLOOP_DEVICE_TOKEN
2. config deviceToken
3. WAITLOOP_INGEST_TOKEN       (legacy)
4. config ingestToken          (legacy)
```

The device credential is scoped to lifecycle ingestion (`agent:write`). It does not grant room administration, browser private API access, or arbitrary MCP seat access.

## Hook delivery behavior

Lifecycle delivery is best-effort and fail-open. The default HTTP timeout is one second so a Waitloop outage does not become an agent outage. Development can override this with:

```text
WAITLOOP_HOOK_TIMEOUT_MS
```

The value is capped at ten seconds.

## Public pairing still to build

The server/CLI device credential model is implemented, but the current remote issuance path is deliberately an **alpha bootstrap**, not the final user-facing pairing flow.

The next public flow will use:

1. short-lived pairing request from the CLI;
2. explicit browser/account approval;
3. a local high-entropy verifier kept out of the browser URL;
4. one-time exchange for the same scoped/revocable device credential model;
5. account device listing/revocation.

That work can be added without changing the agent lifecycle event protocol or the installed Claude/Cursor/Codex adapters.
