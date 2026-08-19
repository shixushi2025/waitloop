# @waitloop/cli

The Waitloop CLI owns local configuration, scoped device credentials, and thin coding-agent lifecycle adapters. It intentionally does not read source files, prompts, transcripts, repository metadata, or tool payloads.

## Commands

```text
waitloop init
waitloop pair [--bootstrap-token TOKEN]
waitloop unpair
waitloop doctor
waitloop install <claude-code|cursor|codex|all>
waitloop uninstall <claude-code|cursor|codex|all>
waitloop status
waitloop open
waitloop config
waitloop hook <claude-code|cursor|codex>
```

`waitloop init` creates `~/.waitloop/config.json`, generates a stable opaque device ID, detects supported coding agents, and can install all detected lifecycle adapters that are currently implemented.

The device ID is identity metadata only. `waitloop pair` obtains a separate scoped `wldev_...` credential for lifecycle ingestion. In the current alpha, remote issuance uses privileged bootstrap authority; the final browser/account approval flow is still to be built.

## Pairing

Preferred alpha invocation:

```bash
WAITLOOP_BOOTSTRAP_TOKEN=... waitloop pair
```

The raw issued device credential is saved privately and is not printed. The server stores only its SHA-256 digest. Successful pairing removes any saved legacy lifecycle ingest token.

```bash
waitloop unpair
```

self-revokes the credential before removing it locally. Network/server failures keep the local credential so revocation can be retried.

## Claude Code

The installer merges Waitloop handlers into `~/.claude/settings.json` and never replaces unrelated hooks. The installed command is:

```text
waitloop hook claude-code
```

Mapping:

```text
UserPromptSubmit  -> running
PermissionRequest -> waiting
Notification      -> waiting
Stop              -> completed
StopFailure       -> failed
SessionEnd        -> local cleanup
```

Claude hook input is consumed only for native session correlation and event type. Prompt text and other payload fields are ignored.

## Cursor

The installer merges Waitloop handlers into `~/.cursor/hooks.json`. The installed command is:

```text
waitloop hook cursor
```

Mapping:

```text
beforeSubmitPrompt -> running
stop/completed     -> completed
stop/error         -> failed
stop/aborted       -> failed
sessionEnd         -> local cleanup
```

Cursor's native conversation/generation ID is used only as a local correlation key and is hashed for the temporary local filename. It is never included in the canonical Waitloop event.

## Codex

The installer merges user-level hooks into `~/.codex/hooks.json` using:

```text
waitloop hook codex
```

Mapping:

```text
UserPromptSubmit  -> running
PermissionRequest -> waiting
Stop              -> completed
SessionEnd        -> local cleanup
```

The adapter ignores prompt text, turn IDs, cwd, transcript paths, tool payloads, and assistant output. Codex requires non-managed command hooks to be reviewed/trusted in `/hooks` after installation.

## Local state

Turn state lives under:

```text
~/.waitloop/state/claude-code/
~/.waitloop/state/cursor/
~/.waitloop/state/codex/
```

State files contain only the adapter ID, an opaque Waitloop session ID, state, and timestamps. Native agent session IDs are used only as local correlation keys and are hashed for filenames.

Lifecycle delivery is best-effort and fail-open with a short timeout. Credential priority is device credential first, legacy ingest token second.
