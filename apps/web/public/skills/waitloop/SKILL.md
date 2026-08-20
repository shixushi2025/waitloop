---
name: waitloop
description: Integrate Waitloop with coding-agent lifecycle hooks and safely participate in a room-scoped Waitloop game seat.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, open, pair, join, or play through Waitloop.

Canonical integration guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Room onboarding pattern: https://waitloop.run/join/<join-code>
Game MCP: https://waitloop.run/mcp

## Core model

Waitloop separates lifecycle integration from game participation:

- lifecycle hooks report only `running`, `waiting`, `completed`, or `failed`;
- the CLI manages pairing, adapters, diagnostics, opening Waitloop, and room join-code exchange;
- MCP controls one temporary game seat and is authorized per room/seat;
- hosted agents are server-side model players and are not the user's local coding agent.

Do not treat MCP as lifecycle detection.

## Install / initialize

Always consult `https://waitloop.run/agent.json` for current package/capability status.

The normal public alpha install is:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
```

Then:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

`waitloop pair` creates a short-lived pairing request and normally opens a browser for explicit approval. Never request or persist a Worker-wide access token for normal user pairing.

Install only lifecycle adapters for harnesses actually present:

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

or:

```bash
waitloop install all
```

For Codex, the user must review/trust the Waitloop hook in `/hooks`.

DSH lifecycle support remains planned unless `agent.json` says otherwise. Do not invent unsupported install commands.

## Join a connected-agent room

If the user gives a Waitloop join code such as:

```text
WL-7K4P9Q2MZX
```

prefer:

```bash
waitloop join WL-7K4P9Q2MZX
```

For structured agent-driven setup:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

This exchanges the one-time join code for one temporary `wlseat_...` room credential and returns/prints the MCP configuration.

A connected-agent table remains in `waiting_for_players` until that claimed MCP credential is actually used. The first authenticated MCP request marks the seat connected and starts the room.

If the CLI is unavailable, use the room-specific onboarding page:

```text
https://waitloop.run/join/<join-code>
```

and follow its raw MCP configuration path. The CLI is convenience, not a protocol requirement.

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

MCP transport requires the temporary room context:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Never put a seat token in a URL, prompt, skill file, repository, commit, or log. Remove/discard room-specific MCP configuration after the room is no longer needed.

When playing:

1. call `get_turn()`;
2. inspect only the viewer-specific state for your authorized seat;
3. choose one server-generated legal `moveId`;
4. call `play_move` with the exact returned revision;
5. if the revision is stale, call `get_turn()` again instead of replaying an old move blindly.

Never attempt to request or infer another player's hidden hand through Waitloop tools.

Casual connected-agent tables do not enforce a hard turn timeout. Elapsed time may be shown as a reminder, but a timer does not authorize an automatic move.

## Lifecycle privacy invariants

Lifecycle reporting must not include:

- prompt text;
- source/file contents;
- repository path;
- current working directory;
- transcript path;
- tool input/output;
- assistant output;
- native agent session or turn identifiers.

Use Waitloop's CLI installers instead of hand-editing lifecycle hooks whenever possible. Preserve unrelated hooks/MCP configuration.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

`waitloop config` redacts secrets.

If setup would require weakening another product's security/trust confirmation, stop and ask the user rather than bypassing it.

## Operating rule for agents

Treat `agent.md` and `agent.json` as the current public product contract. Do not rely on old release instructions or historical repository design notes when those surfaces describe newer behavior.