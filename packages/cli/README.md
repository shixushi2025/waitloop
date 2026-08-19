# @waitloop/cli

The Waitloop CLI owns local configuration and thin coding-agent lifecycle adapters. It intentionally does not read source files, prompts, transcripts, repository metadata, or tool payloads.

## Commands

```text
waitloop init
waitloop doctor
waitloop install claude-code
waitloop uninstall claude-code
waitloop status
waitloop open
waitloop config
```

`waitloop init` creates `~/.waitloop/config.json`, generates a stable opaque device ID, detects supported coding agents, and can install the Claude Code lifecycle hooks.

The current device ID is local identity only. Remote account/device approval is a later pairing layer; it must not be confused with authentication.

## Claude Code

The installer merges Waitloop handlers into `~/.claude/settings.json` and never replaces unrelated hooks. The installed command is:

```text
waitloop hook claude-code
```

Claude sends lifecycle JSON to the command on stdin. Waitloop consumes only `session_id` and `hook_event_name`; other fields are ignored.

Mapping:

```text
UserPromptSubmit  -> running
PermissionRequest -> waiting
Notification      -> waiting
Stop              -> completed
StopFailure       -> failed
SessionEnd        -> local cleanup
```

Local turn state is stored under `~/.waitloop/state/claude-code/`. The files contain only an opaque Waitloop session ID, state, and timestamps.
