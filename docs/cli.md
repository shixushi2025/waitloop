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
    └── claude-code/
        ├── <hashed-claude-session>.json
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

The Claude state files contain only:

- opaque Waitloop turn ID
- lifecycle state
- start/update timestamps

The Claude session ID is hashed for the temporary filename and is never sent to Waitloop.

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

Initialization creates or updates local config, preserves the existing device ID, detects installed coding agents, and can install the Claude Code integration.

### Diagnostics

```bash
waitloop doctor
```

Checks local configuration, the Waitloop health endpoint, and best-effort agent detection.

### Claude Code lifecycle integration

```bash
waitloop install claude-code
waitloop uninstall claude-code
```

The installer merges Waitloop handlers into `~/.claude/settings.json`; it does not replace existing handlers. Uninstall removes only handlers whose command is exactly:

```text
waitloop hook claude-code
```

Installed lifecycle mapping:

```text
UserPromptSubmit                    running
PermissionRequest                   waiting
Notification(permission/idle/etc.) waiting
Stop                                completed
StopFailure                         failed
SessionEnd                          local cleanup
```

The command hook receives Claude's complete hook JSON on stdin but reads only `session_id` and `hook_event_name`. Prompt text, current directory, transcript path, tool input, and tool output are ignored.

### Current turn

```bash
waitloop status
waitloop open
waitloop open --print
```

`status` reads only the local `latest.json`. `open` opens the configured Waitloop URL and, when available, adds the opaque current Waitloop session ID as the `session` query parameter.

### Inspect configuration safely

```bash
waitloop config
```

Token values are redacted; only whether each token is configured is shown.

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
