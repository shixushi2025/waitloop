---
name: waitloop
description: Integrate Waitloop with coding-agent lifecycle hooks and safely participate in a room-scoped Waitloop game seat.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, open, pair, or play through Waitloop.

Canonical integration guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json

## Core model

Waitloop separates lifecycle integration from game participation:

- lifecycle hooks report only `running`, `waiting`, `completed`, or `failed`;
- the CLI manages pairing, adapters, diagnostics, and opening Waitloop;
- MCP controls one game seat and is authorized per room/seat;
- hosted agents are server-side model players and are not the user's local coding agent.

Do not treat MCP as lifecycle detection.

## Preferred setup

If the Waitloop CLI is already installed:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Install only adapters for harnesses actually present on the machine:

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

Or:

```bash
waitloop install all
```

For Codex, tell the user to review/trust the installed Waitloop hook in `/hooks`.

If the CLI is not installed, read https://waitloop.run/agent.md and follow the current alpha source-install instructions. Do not invent a public npm release while `agent.json` reports `cli.published: false`.

## Pairing

`waitloop pair` creates a short-lived pairing request and normally opens the user's browser for explicit approval.

Never request or persist a Worker-wide access token for normal end-user pairing. Never print or expose a raw device credential.

## MCP game seat

Endpoint:

```text
https://waitloop.run/mcp
```

Tools:

```text
get_turn()
play_move(expectedRevision, moveId)
```

A connected-agent room provides a one-time seat credential and room ID. Configure those only for that room:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Never put a seat token in a URL, prompt, skill file, repository, commit, or log. Remove/discard room-specific MCP configuration when it is no longer needed.

When playing:

1. call `get_turn()`;
2. inspect only the viewer-specific state returned for your authorized seat;
3. choose one server-generated legal `moveId`;
4. call `play_move` with the exact returned revision;
5. on a stale revision, call `get_turn()` again instead of retrying an old move blindly.

Never attempt to infer or request another player's hidden hand.

## Privacy invariants

Lifecycle reporting must not include:

- prompt text;
- source/file contents;
- repository path;
- current working directory;
- transcript path;
- tool input/output;
- assistant output;
- native agent session or turn identifiers.

Use Waitloop's CLI installers instead of hand-editing hook files whenever possible. Preserve unrelated hooks and MCP configuration.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

`waitloop config` is safe for normal inspection because secrets are redacted.

If an installation step would require disabling another product's security/trust confirmation, stop and ask the user rather than bypassing it.
