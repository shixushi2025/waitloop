# Claude Code integration

This directory contains the first Waitloop lifecycle adapter as a distributable Claude Code plugin.

The adapter uses async command hooks so reporting never blocks Claude Code's primary work. It intentionally ignores prompt text, current working directory, tool input, tool output, and repository data even though Claude hook input can contain some of those fields.

## Event mapping

| Claude Code hook | Waitloop state |
| --- | --- |
| `UserPromptSubmit` | `running` |
| `PermissionRequest` | `waiting` |
| `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`) | `waiting` |
| `Stop` | `completed` |
| `StopFailure` | `failed` |
| `SessionEnd` | local cleanup only |

A Waitloop session represents one Claude Code **turn**, not an entire Claude Code conversation. `UserPromptSubmit` therefore creates a new opaque Waitloop session ID and terminal hooks close that turn. This matches the Waitloop protocol rule that terminal sessions do not restart.

## Local development

Start Waitloop first:

```bash
pnpm dev
```

Then load this plugin directly:

```bash
claude --plugin-dir ./integrations/claude-code
```

The adapter defaults to:

```text
http://127.0.0.1:8787
```

Override the endpoint with:

```bash
WAITLOOP_URL=https://waitloop.run claude --plugin-dir ./integrations/claude-code
```

For non-local event ingestion, configure the Worker secret and pass the same token to the adapter:

```text
WAITLOOP_INGEST_TOKEN
```

Do not commit the token.

## Inspecting the alpha session ID

Until the pairing/install UX is implemented, the adapter stores only its generated Waitloop turn ID in a temporary state directory. To make this predictable during development, set:

```bash
export WAITLOOP_STATE_DIR="$HOME/.waitloop/claude-code"
```

The most recent turn is then available at:

```text
~/.waitloop/claude-code/latest.json
```

Given the `waitloopSessionId`, open:

```text
http://127.0.0.1:8787/?session=<waitloopSessionId>
```

The temporary per-Claude-session file is removed when the turn ends. `latest.json` remains only as an alpha convenience and contains no Claude session ID, prompt, path, or source content.

## Data sent

The network body contains exactly the canonical v1 fields:

```json
{
  "version": 1,
  "eventId": "opaque uuid",
  "sessionId": "opaque waitloop turn id",
  "agent": "claude-code",
  "state": "running",
  "occurredAt": 0
}
```

The Worker rejects unknown event fields, which provides a second guard against accidentally adding prompt/source data in an adapter.

## Next work

- replace the `latest.json` development bridge with device pairing
- package through a Waitloop/Claude plugin marketplace flow
- add diagnostics for delivery without surfacing hook noise to Claude
- add the Waitloop game skill when MCP game participation is implemented
