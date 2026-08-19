# Waitloop CLI

The CLI is the local integration layer between Waitloop and coding agents. It owns local configuration, device pairing, lifecycle hook installation, diagnostics, and opening the current waiting session.

Game rules, room authority, hosted game agents, MCP tools, and remote session state remain server-side.

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
    ├── cursor/
    └── codex/
```

A paired configuration looks like:

```json
{
  "version": 1,
  "url": "https://waitloop.run",
  "deviceId": "device-opaque-uuid",
  "deviceToken": "wldev_..."
}
```

The device ID is metadata only. Authorization comes from the scoped `deviceToken`. Raw device credentials are not stored server-side; the server persists only a SHA-256 digest.

Native agent session identifiers are used only as local correlation inputs and are hashed before they become local temporary filenames. They are not emitted in Waitloop lifecycle events.

## Current alpha install

The CLI package exists in this repository as `@waitloop/cli`, but it is not yet a public npm release.

Current source install:

```bash
git clone https://github.com/shixushi2025/waitloop.git
cd waitloop
pnpm install --frozen-lockfile
pnpm build:cli
npm install -g ./packages/cli
```

Then:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

The canonical external-agent installation guide is also published at:

```text
https://waitloop.run/agent.md
```

## Commands

### Initialize

```bash
waitloop init --url https://waitloop.run
```

Initialization creates or updates local config, preserves the existing device ID, detects installed coding agents, and can install supported lifecycle adapters.

Development/migration options such as `--ingest-token` and `--access-token` remain available but are not part of the normal public setup path.

### Pair a device

Normal public flow:

```bash
waitloop pair
```

The CLI:

1. ensures a local device identity exists;
2. creates a short-lived pairing request;
3. keeps a high-entropy verifier locally;
4. opens or prints the browser approval URL;
5. waits for explicit browser approval;
6. exchanges the verifier for one `agent:write` device credential;
7. stores that credential privately;
8. removes the saved legacy lifecycle ingest token from the normal path.

Use:

```bash
waitloop pair --no-open
```

when the CLI should print the approval URL without opening a browser.

The privileged bootstrap path remains only for development/recovery:

```bash
WAITLOOP_BOOTSTRAP_TOKEN=... waitloop pair
waitloop pair --bootstrap-token TOKEN
```

Do not use the Worker-wide bootstrap/access authority as a normal end-user credential.

### Unpair

```bash
waitloop unpair
```

The CLI first self-revokes the remote device credential and then removes it locally. If Waitloop is unreachable or returns a server error, the local credential is retained so revocation can be retried.

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

Installers merge only Waitloop-owned hook entries and preserve unrelated user hooks. Uninstallers remove only Waitloop-owned handlers.

## Claude Code lifecycle integration

The CLI installer writes Waitloop hooks into the user's Claude configuration and runs:

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

The hook receives Claude hook JSON on stdin but reads only the native session correlation field and hook event name. Prompt text, current directory, transcript path, tool input, and tool output are ignored.

A source-only alpha Claude Code plugin also exists at:

```text
integrations/claude-code/
```

For normal product setup, prefer the CLI installer so lifecycle configuration and pairing stay centralized.

## Cursor lifecycle integration

The Cursor installer writes version-1 Waitloop hooks to the user Cursor hook configuration and installs:

```text
waitloop hook cursor
```

Current mapping:

```text
beforeSubmitPrompt   running
stop/completed       completed
stop/aborted|error   failed
sessionEnd           local cleanup
```

Cursor native conversation/generation identifiers remain local correlation inputs and are not emitted in Waitloop lifecycle network events.

## Codex lifecycle integration

The Codex installer writes user-level Waitloop hooks and installs:

```text
waitloop hook codex
```

Current mapping:

```text
UserPromptSubmit   running
PermissionRequest  waiting
Stop               completed
SessionEnd         local cleanup
```

After installation, the user must review/trust the Waitloop hook in Codex's `/hooks` UI. Waitloop must not bypass that trust step.

Prompt text, working directory, transcript data, tool input, assistant output, native `session_id`, and native `turn_id` are not emitted to Waitloop.

## DSH

DSH detection exists, but the lifecycle adapter is still planned. Do not invent a `waitloop install dsh` command until the implementation/status manifest says it is available.

## Current turn

```bash
waitloop status
waitloop open
waitloop open --print
```

`status` reads only adapter-local latest-state files. `open` prefers a running/waiting turn and includes only the opaque Waitloop session ID in the browser URL.

### Inspect configuration safely

```bash
waitloop config
```

Secret values are redacted.

## Lifecycle credential order

Lifecycle delivery prefers:

```text
1. WAITLOOP_DEVICE_TOKEN
2. config deviceToken
3. WAITLOOP_INGEST_TOKEN       (legacy migration)
4. config ingestToken          (legacy migration)
```

The device credential is scoped to lifecycle ingestion (`agent:write`). It does not grant arbitrary game, browser, admin, or MCP access.

## Hook delivery behavior

Lifecycle delivery is best-effort and fail-open. The default HTTP timeout is short so a Waitloop outage cannot become an agent outage. Development can override the timeout with:

```text
WAITLOOP_HOOK_TIMEOUT_MS
```

The value is bounded.

## Game MCP is separate

Installing lifecycle hooks does not globally install a playable MCP seat.

A connected-agent room creates a separate room/seat capability for:

```text
get_turn()
play_move(expectedRevision, moveId)
```

That seat credential is temporary and must remain separate from the long-lived device lifecycle credential. See [`mcp.md`](mcp.md).
