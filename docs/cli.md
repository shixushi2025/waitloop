# Waitloop CLI

The CLI is the local integration layer between Waitloop and coding agents. It owns local configuration, agent detection, lifecycle hook installation, diagnostics, and opening the current waiting session.

It is deliberately thin. Game rules, room authority, MCP tools, and remote session state remain server-side.

## Goals

- one predictable local entry point: `waitloop`
- no prompt, source, transcript, repository, or tool-payload collection
- idempotent installs and safe uninstalls
- platform adapters stay thin and map into the canonical Waitloop lifecycle protocol
- local state is inspectable and removable
- remote pairing/authentication can be added without changing the lifecycle event shape

## Local files

```text
~/.waitloop/
├── config.json
└── state/
    ├── claude-code/
    │   ├── <hashed-native-session>.json
    │   └── latest.json
    └── cursor/
        ├── <hashed-native-session>.json
        └── latest.json
```

`config.json` is written with private-file permissions where the OS supports them. It currently contains:

```json
{
  "version": 1,
  "url": "https://waitloop.run",
  "deviceId": "device-opaque-uuid",
  "ingestToken": "optional-alpha-secret",
  "accessToken": "optional-alpha-secret"
}
```

The device ID is an opaque **local identity**, not proof of authentication. A real account/device approval flow is still required before public beta.

Local turn state contains only:

- adapter ID (`claude-code` or `cursor`)
- opaque Waitloop turn ID
- lifecycle state
- start/update timestamps

Native Claude/Cursor session identifiers are hashed only for temporary local filenames and are never sent to Waitloop.

## Commands

### Initialize

```bash
waitloop init
```

Options:

```text
--url URL
--ingest-token TOKEN
--access-token TOKEN
--yes
```

Initialization creates or updates local config, preserves the existing device ID, detects installed coding agents, and can install all detected lifecycle adapters that Waitloop currently supports.

### Diagnostics

```bash
waitloop doctor
```

Checks local configuration, the Waitloop health endpoint, and best-effort agent detection.

### Install and uninstall adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install all

waitloop uninstall claude-code
waitloop uninstall cursor
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

Token values are redacted; only whether each token is configured is shown.

## Hook delivery behavior

Lifecycle delivery is best-effort and fail-open. The default HTTP timeout is one second so a Waitloop outage does not become an agent outage. Development can override this with:

```text
WAITLOOP_HOOK_TIMEOUT_MS
```

The value is capped at ten seconds.

## Authentication roadmap

The alpha still supports manually configured ingest/access tokens. That is intentionally not presented as finished pairing.

The next pairing layer should:

1. create a short-lived pairing request from the CLI;
2. require explicit browser/account approval;
3. issue a revocable device credential scoped to lifecycle ingestion and the user's own sessions;
4. store only a hashed/derived verifier server-side when possible;
5. support listing and revoking devices;
6. remove the need to copy long-lived Worker-wide secrets into local config.

Until that exists, `deviceId` is metadata only and must never be trusted as authorization.
