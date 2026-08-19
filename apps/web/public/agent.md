# Waitloop Agent Integration Guide

Canonical URL: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Agent skill: https://waitloop.run/skills/waitloop/SKILL.md
MCP endpoint: https://waitloop.run/mcp
Source: https://github.com/shixushi2025/waitloop

Waitloop is a developer-native waiting layer for coding agents. It reports only minimal lifecycle state, lets a human play a small game while an agent is working, and gives work priority again when the coding agent waits, completes, or fails.

If you are an AI agent reading this file because a user asked you to install or configure Waitloop, follow this document instead of guessing platform-specific paths or inventing unpublished packages.

## Integration layers

Waitloop has four separate integration layers. Do not conflate them.

1. **CLI** — local configuration, pairing, diagnostics, lifecycle adapter installation, and room join-code exchange.
2. **Lifecycle hooks/adapters** — report `running`, `waiting`, `completed`, and `failed` without sending prompt/source/tool payloads.
3. **Skill** — agent-facing instructions for understanding and safely using Waitloop.
4. **Game MCP** — lets one authorized agent control exactly one seat in one game room.

MCP is not lifecycle detection. Hooks report lifecycle state; MCP controls a game seat.

## Current support

| Harness | Lifecycle | Recommended install | Plugin | Skill | Game MCP |
| --- | --- | --- | --- | --- | --- |
| Claude Code | available | `waitloop install claude-code` | source-only alpha plugin | generic Waitloop skill | supported |
| Cursor | available | `waitloop install cursor` | no separate plugin required | generic Waitloop skill where supported | supported by compatible MCP configuration |
| Codex | available | `waitloop install codex` | no separate plugin required | generic Waitloop skill | supported |
| DSH | planned | do not invent an adapter | planned | generic Waitloop skill can be read manually | protocol-compatible once adapter exists |

After installing the Codex lifecycle hook, the user must review/trust the Waitloop hook in Codex's `/hooks` UI.

## Install the CLI

Always read the `cli` object in https://waitloop.run/agent.json first.

If `cli.published` is `true`, prefer the registry install command from the manifest:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
```

If `cli.published` is `false`, do **not** assume the npm package exists. Use the source fallback instead:

```bash
git clone https://github.com/shixushi2025/waitloop.git
cd waitloop
pnpm install --frozen-lockfile
pnpm build:cli
npm install -g ./packages/cli
waitloop --version
```

Then initialize against the public service:

```bash
waitloop init --url https://waitloop.run
```

Pair the device:

```bash
waitloop pair
```

Pairing creates a short-lived request and normally opens a browser approval page. Never copy a Worker-wide secret into a normal end-user installation.

Verify:

```bash
waitloop doctor
waitloop config
```

`waitloop config` redacts secrets.

## Join a connected-agent game room

A room may give the user or agent a temporary code such as:

```text
WL-7K4P9Q2MZX
```

If the installed CLI supports `join`, prefer:

```bash
waitloop join WL-7K4P9Q2MZX
```

For machine-readable output:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

The CLI exchanges the join code for one room-scoped MCP credential and prints the temporary MCP configuration. Configure that MCP server only for the agent occupying this room seat. The game begins when the claimed MCP credential is actually used; merely creating the room does not start a connected-agent game.

Every join code also has a room-specific URL:

```text
https://waitloop.run/join/<join-code>
```

`/join/<code>` is not a replacement for this file. `/agent.md` remains stable universal Waitloop guidance; `/join/<code>` contains instructions for one temporary room.

If the CLI is unavailable, use the raw MCP configuration offered by the room/join page. Do not invent a global seat token or persist a room credential after the room is no longer needed.

## Install lifecycle integration

Prefer the CLI installer. It merges only Waitloop-owned hooks and preserves unrelated user configuration.

Claude Code:

```bash
waitloop install claude-code
```

Cursor:

```bash
waitloop install cursor
```

Codex:

```bash
waitloop install codex
```

All detected/supported integrations:

```bash
waitloop install all
```

Remove only Waitloop-owned hooks with:

```bash
waitloop uninstall claude-code
waitloop uninstall cursor
waitloop uninstall codex
waitloop uninstall all
```

Do not hand-edit global hook files unless the CLI installer cannot be used and the user explicitly wants a manual install.

## Claude Code plugin

A distributable alpha plugin source exists at:

https://github.com/shixushi2025/waitloop/tree/main/integrations/claude-code

For repository/source development it can be loaded with:

```bash
claude --plugin-dir ./integrations/claude-code
```

For normal Waitloop use, prefer the CLI lifecycle installer so pairing/configuration remains centralized.

## Install/read the Waitloop skill

Canonical skill URL:

https://waitloop.run/skills/waitloop/SKILL.md

If the current harness supports agent skills, install that file into the harness's supported user/project skill location. If the harness does not support installable skills, read the file as operating instructions instead. Do not guess an unsupported skill directory.

The skill is intentionally credential-free. Never place device tokens, room seat tokens, prompts, repository contents, or user source code into the skill file.

## Game MCP

Remote endpoint:

```text
https://waitloop.run/mcp
```

The MCP server exposes only:

```text
get_turn()
play_move(expectedRevision, moveId)
```

A game MCP seat is **room-scoped and temporary**. It requires both:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Do not globally configure `/mcp` without a room ID and seat token. Do not persist a room seat token after the room is no longer needed. Do not put seat tokens in URLs, source files, commits, prompts, or skill files.

For connected-agent rooms, the first authenticated MCP request is the seat readiness signal. Casual rooms do not impose a hard agent turn timeout; elapsed time is informational only.

## Lifecycle privacy contract

Waitloop lifecycle events intentionally contain only:

```json
{
  "version": 1,
  "eventId": "opaque uuid",
  "sessionId": "opaque Waitloop turn id",
  "agent": "claude-code|cursor|codex|dsh|unknown",
  "state": "running|waiting|completed|failed",
  "occurredAt": 0
}
```

Do not send prompt text, source code, repository paths, current working directory, transcript paths, tool input, tool output, assistant output, or native agent session/turn identifiers to Waitloop.

## Useful CLI commands

```bash
waitloop status
waitloop open
waitloop open --print
waitloop doctor
waitloop config
waitloop pair
waitloop join WL-XXXXXXXXXX
waitloop unpair
```

`waitloop open` prefers an active running/waiting coding-agent turn.

## For an automated installer agent

Use this order:

1. Read https://waitloop.run/agent.json and this document.
2. Detect the user's actual installed harnesses. Do not install unrelated adapters.
3. Read `cli.published` from the manifest.
4. If published, use `cli.installCommand`; otherwise use the documented source-install fallback.
5. Run `waitloop init --url https://waitloop.run`.
6. Run `waitloop pair` and let the user explicitly approve the browser pairing request.
7. Install only the matching lifecycle adapter(s) with `waitloop install ...`.
8. If useful and supported, install the Waitloop skill from the canonical skill URL.
9. If the user gives you a Waitloop join code or `/join/<code>` URL, follow its room-specific instructions. Prefer `waitloop join <code>` when that command is available; otherwise use the raw room-scoped MCP configuration.
10. Run `waitloop doctor` and report the result to the user.

Never weaken another agent's security settings, disable hook trust prompts, expose credentials, or overwrite unrelated hook/MCP configuration just to make Waitloop work.
