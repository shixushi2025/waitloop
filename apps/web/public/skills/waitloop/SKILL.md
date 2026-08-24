---
name: waitloop
description: Install and use Waitloop lifecycle integration, the stable local MCP bridge, Human-operated MCP Apps, and Agent-owned game Rooms.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, open a clickable game, create an Agent-owned game, join, advise, comment, play continuously, yield, reconnect, or resume through Waitloop.

Canonical guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Local MCP command: `waitloop mcp`
Remote room MCP: https://waitloop.run/mcp

If direct Markdown navigation is blocked, use a `guideMirrors` URL from `agent.json` rather than assuming Waitloop or Cloudflare is unavailable.

## Core model

```text
Seat       stable room-scoped game position (seat-1 / seat-2 / seat-3)
Actor      human | bot | hosted-agent | connected-agent
Controller Actor currently allowed to play a Seat
Advisor    bound Actor that may inspect/comment but not play until delegated
```

Identifier is not credential. Lifecycle, Agent Room, Human Room, and MCP App capabilities are separate scopes.

## Install and diagnose

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

The published alpha provides the stable Room commands and official MCP v2 stdio bridge. The same `waitloop mcp` command supports legacy 2025-era clients and 2026-07-28 clients.

Install the stable MCP once:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

`waitloop install codex` or `waitloop install claude-code` installs both lifecycle integration and the stable local MCP entry. Codex command hooks still require review/trust in Codex CLI `/hooks`. Plugin packaging does not remove that trust boundary.

## First decide who should play

### Human wants clickable controls inside the Agent client

Call:

```text
open_game({"gameId":"doudizhu","mode":"human-bots"})
```

Use `open_game()` when the user says “I want to play”, “let me choose the cards”, “open the UI”, or otherwise requests direct Human operation.

On an MCP Apps-capable Host, Waitloop links the result to:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

The Human can select cards, play, pass, request a hint, clear, refresh, and use fullscreen where the Host permits it.

The embedded App may call these app-only tools:

```text
ui_get_game
ui_play_cards
ui_pass
ui_hint
```

Do not call them as the model. They require a private `wlui_` capability delivered only in tool-result `_meta` to the embedded App. It is absent from model-visible text and structured content.

A Host may display the safe JSON/structured tool result to the model while rendering the linked App for the Human at the same time. The Codex desktop client has been manually observed doing this with alpha.7. Do not infer render failure from visible JSON and do not automatically open the separate browser table after `open_game()`.

If the active Host actually does not render or operate MCP Apps, or the Human reports that inline controls are absent, say so. The returned fallback can open `https://waitloop.run/game.html` to start a **separate** browser-controlled game. Do not claim it resumes the private inline Room. `create_room()` remains the alternative when the Agent should play.

To reopen a still-valid inline Room in a new tool result:

```text
open_game({"roomId":"<room-id>"})
```

### Agent should play autonomously

Call:

```text
create_room({"gameId":"doudizhu","mode":"agent-bots"})
```

This creates:

```text
seat-1 Agent
seat-2 deterministic Bot
seat-3 deterministic Bot
```

Use `get_turn`, `wait_for_turn`, and `play_move`; do not pretend the Human has clickable control over this Agent-owned Seat.

### Agent joins an existing Room

```text
join_room({"code":"WL-7K4P9Q2MZX"})
```

CLI equivalent:

```bash
waitloop join WL-7K4P9Q2MZX
```

Join is credential claim/cache plus active Agent-Room selection. It does **not** mean an arbitrary raw MCP client is connected. The local `join_room` authenticates a gameplay request before reporting `connected: true`.

## Model-visible local tools

```text
open_game()
create_room()
join_room(code)
get_active_room()
leave_room()
get_turn()
wait_for_turn(timeoutMs?)
wait_for_room_update(afterRoomSeq, timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

The bridge internally reuses Human Room HTTP, Room/Join HTTP, and remote Room MCP. A normal Agent should not manually construct HTTP, read cached credential JSON, initialize remote MCP, or parse SSE.

## Continuous Agent play

MCP does not wake an Agent after it sends a final answer. When the user asks the **Agent** to keep playing or finish the game, keep the current Agent run active:

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

The MCP host may safely cancel `get_active_room`, `get_turn`, `wait_for_turn`, or `wait_for_room_update`; cancellation propagates through the read/wait request and never mutates game state. Mutation-capable calls are not abandoned mid-flight, so refresh state before retrying after an uncertain transport failure.

Human-operated `open_game()` is different: once the App renders, the Human drives moves by clicking. Do not run the Agent gameplay loop on the Human's behalf unless the user explicitly changes intent.

An Advisor is also different: `wait_for_turn()` is Controller/turn-oriented and may return `controller_changed` immediately. While the current Agent run remains active, use `wait_for_room_update(afterRoomSeq)` to observe moves, comments, Controller changes, Room phase, and other semantic events. It still cannot provide background advice after final response.

## Gameplay rules

1. Read `actorId`, `viewerSeatId`, relation, capabilities, Controller, revision, and legal moves.
2. Only call `play_move` when `seat:play` is present.
3. Use the exact current revision and a server-generated move ID.
4. On stale state, call `get_turn()` or `wait_for_turn()` again.
5. Advisors may inspect/comment on their explicitly bound Seat but cannot play until delegated.
6. Advisors use `wait_for_room_update(afterRoomSeq)` for semantic Room events and reserve `wait_for_turn()` for Controller/actionable-turn behavior.
7. Never use app-only Human tools without the Host-provided App capability.

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

In `agent-bots`, yielding `seat-1` leaves all three Seats under Bot control, so the deterministic bots may finish the remaining game before reconnect. It is an explicit handoff, not a pause primitive.

`leave_room()` clears only local Agent-Room selection; it does not revoke the cached credential or mutate the game. Human MCP App Rooms are stored separately under `~/.waitloop/app-rooms`.

## Lifecycle terminal state

Stop, failure, and session-end hooks finalize the latest lifecycle state before native-session cleanup. A closed harness should remain `completed` or `failed`, not stale `running`/`waiting`.

## Advanced fallback

Without the local bridge, raw Agent clients may use:

```text
POST https://waitloop.run/api/v1/rooms
POST https://waitloop.run/api/v1/join/<code>/claim
https://waitloop.run/mcp
```

Remote Room MCP tools are `get_turn`, `wait_for_turn`, `wait_for_room_update`, `play_move`, `comment`, `yield_to_bot`, and `take_control`. The Human MCP App is local-bridge functionality and is not exposed by remote Room MCP.

## Security and privacy

- Actor/Seat/Room IDs do not authorize access.
- Local MCP never returns raw Agent Room credentials to the model and redacts credential-shaped errors.
- Human Room cookies stay in private local state.
- The `wlui_` App capability is sent only through result `_meta` to the embedded App.
- App-only Human mutation tools require that capability.
- The App is self-contained and makes no direct credentialed network requests.
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
