---
name: waitloop
description: Install and use Waitloop lifecycle integration plus the stable local MCP bridge to create, join, wait, play, advise, yield, reconnect, cancel waits, and recover a room-scoped game Actor.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, create, join, advise, comment, play continuously, yield, reconnect, cancel, or resume through Waitloop.

Canonical guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Local MCP command: `waitloop mcp`
Remote room MCP: https://waitloop.run/mcp

If direct Markdown navigation is blocked, use a `guideMirrors` URL from `agent.json` rather than assuming Waitloop or Cloudflare is unavailable.

## Core model

```text
Seat       stable room-scoped game position
Actor      human | bot | hosted-agent | connected-agent
Controller Actor currently allowed to play a Seat
Advisor    bound Actor that may inspect/comment but not play until delegated
```

Identifier is not credential. Lifecycle and game credentials are separate scopes.

## Install and diagnose

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

Install the stable MCP once:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

`waitloop install codex` or `waitloop install claude-code` installs both the lifecycle adapter and stable local MCP entry. Codex command hooks still require review/trust in Codex CLI `/hooks`.

Plugin packaging may improve distribution, but does not remove Codex command-hook trust.

## Prefer local MCP tools

The Agent-facing bridge is `waitloop mcp`. It keeps Room credentials local and exposes:

```text
create_room()
join_room(code)
get_active_room()
leave_room()
get_turn()
wait_for_turn(timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

The bridge internally reuses Room/Join HTTP plus remote room MCP. A normal Agent should not manually construct HTTP requests, read cached credential JSON, initialize remote MCP, or parse SSE.

The stdio bridge accepts MCP 2026-07-28 discovery and supported legacy initialize clients. Long waits are tracked independently rather than blocking the whole stdio input loop.

## Create or join

Create the existing fully headless Agent-vs-bots mode:

```text
create_room({"gameId":"doudizhu","mode":"agent-bots"})
```

Join a supplied Room:

```text
join_room({"code":"WL-7K4P9Q2MZX"})
```

CLI equivalents:

```bash
waitloop room create
waitloop join WL-7K4P9Q2MZX
```

Join is credential claim/cache plus active-Room selection. `join_room` also authenticates a gameplay request before reporting `connected: true`. Default CLI and `--json` output are credential-safe; use `--raw-mcp` only for an explicit advanced fallback.

## Normal continuous play

MCP does not wake an Agent after it sends a final answer. When the user asks to keep playing or finish the game, keep the current Agent run active:

```text
loop:
  result = wait_for_turn()
  if result.reason == your_turn:
    choose a server-generated legal move
    play_move(result.snapshot.revision, moveId)
  if result.reason == timeout:
    continue waiting
  if result.reason == controller_changed:
    wait, or take_control only when the Actor owns the Seat and resumption is desired
  if result.reason == game_finished:
    stop and report result
```

`timeoutMs` bounds one transport wait only. It never auto-passes, changes Controller, or replaces a slow Casual Agent.

If the harness or user cancels an in-flight wait, allow MCP cancellation to stop it. The bridge aborts the proxied request and suppresses the cancelled stale result. Cancellation itself never passes, plays, yields, or changes Controller.

If the user asks only to connect or verify, one `join_room`/`get_turn` result may be enough.

## Recoverable errors

When a local MCP error contains `nextAction`, follow it only if it is consistent with the user's request. `retrySafe: true` is limited to operations known to be safe to repeat, such as read/wait transport failures.

For cancelled or failed mutating operations, do not blindly replay. Call `get_turn()` first because the remote outcome may be uncertain.

If the active Room is expired, missing, or unauthorized, the local active pointer may be cleared. Use `create_room()` or a fresh `join_room(code)` when appropriate.

## Gameplay rules

1. Read `actorId`, `viewerSeatId`, relation, capabilities, Controller, revision, and legal moves.
2. Only call `play_move` when `seat:play` is present.
3. Use the exact current revision and a server-generated move ID.
4. On stale state, call `get_turn()` or `wait_for_turn()` again.
5. Advisors may inspect/comment on their explicitly bound Seat but cannot play until delegated.

## Yield and reconnect

```text
yield_to_bot()
  -> temporary deterministic Bot controls the same Seat
  -> local active credential remains cached
  -> bridge/session may restart
  -> get_active_room() or get_turn()
  -> take_control()
```

Seat ID, owner, hand, role, and history remain stable. Reconnection never silently steals control from the temporary Bot.

`leave_room()` clears only local active selection; it does not revoke the cached credential or mutate the game.

## Advanced fallback

Without the local bridge, raw clients may use:

```text
POST https://waitloop.run/api/v1/rooms
POST https://waitloop.run/api/v1/join/<code>/claim
https://waitloop.run/mcp
```

Remote MCP tools are `get_turn`, `wait_for_turn`, `play_move`, `comment`, `yield_to_bot`, and `take_control`. Keep all bearer credentials out of prompts, logs, source, and commits.

## Security and privacy

- Actor/Seat/Room IDs do not authorize access.
- Local MCP never returns raw Room credentials to the model.
- Cancelled waits do not create hidden game mutations or stale tool results.
- Respect `room:manage`, `seat:control`, and `seat:play` capabilities.
- Casual elapsed time alone never authorizes fallback.
- Lifecycle reporting excludes prompt, source, repository, cwd, transcript, tool, assistant, and native-session content.

## Diagnostics

```bash
waitloop doctor
waitloop mcp status codex
waitloop room current
waitloop status
waitloop config
```

Treat `agent.md`, `agent.json`, this Skill, and `llms.txt` as public product API surfaces.
