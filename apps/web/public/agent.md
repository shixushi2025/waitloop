# Waitloop Agent Integration Guide

Canonical URL: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Agent skill: https://waitloop.run/skills/waitloop/SKILL.md
Local MCP command: `waitloop mcp`
Remote room MCP: https://waitloop.run/mcp
Source: https://github.com/shixushi2025/waitloop

Waitloop is a developer-native waiting layer for coding agents. Work has priority over games. Lifecycle integration, Human-operated MCP Apps, and Agent game participation are deliberately separate.

## Discovery fallback

Some Agent/browser sandboxes may block direct navigation to a Markdown URL even when ordinary HTTP clients can fetch it. Do not infer a Waitloop or Cloudflare outage from a browser-only block.

If the canonical guide cannot be read directly, use the `guideMirrors` array in https://waitloop.run/agent.json:

```text
https://raw.githubusercontent.com/shixushi2025/waitloop/main/apps/web/public/agent.md
https://github.com/shixushi2025/waitloop/blob/main/apps/web/public/agent.md
```

## Core identity model

```text
Room       one game/runtime instance
Seat       stable room-scoped player position, such as seat-1
Actor      human, bot, hosted agent, or connected agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to play the Seat
Advisor    bound Actor that may inspect/comment but cannot play until delegated
```

**Actor ID is not a credential.** Changing Controller does not change Seat ID, hand, role, ownership, or game history.

## Choose the correct entry point

The primary Agent interface is the stable local stdio MCP server:

```text
waitloop mcp
```

The bridge uses the official MCP v2 stdio server entry and supports legacy 2025-era clients and 2026-07-28 clients through the same command.

There are now two deliberately different ways to start a game:

```text
open_game()
  Human owns the Seat
  Human clicks cards and buttons in an MCP App

create_room()
  Agent owns seat-1
  Agent plays autonomously through get_turn / wait_for_turn / play_move
```

Do not use `create_room()` when the user says “I want to play”, “let me click the cards”, or otherwise asks for direct Human control inside the Agent client. Use `open_game()`.

### Model-visible local tools

The published npm alpha exposes:

```text
open_game(gameId?, mode?, roomId?)
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

### MCP App-only tools

The embedded UI may call these tools; the model should not:

```text
ui_get_game(roomId, uiToken)
ui_play_cards(roomId, uiToken, expectedRevision, cardIds)
ui_pass(roomId, uiToken, expectedRevision)
ui_hint(roomId, uiToken, expectedRevision, cursor?)
```

The `uiToken` is a private capability delivered through tool-result metadata to the embedded App. It is absent from model-visible text and structured content.

The underlying boundaries remain:

```text
Room/Join HTTP API  server control protocol
remote /mcp         one authorized Room Actor gameplay protocol
local waitloop mcp  stable Agent-facing bridge over HTTP + remote MCP + MCP Apps
CLI                 human/script convenience over the same clients
Web                 standalone Human UI
```

HTTP is an advanced fallback and implementation boundary; a normal Agent should not hand-build HTTP requests or JSON-RPC/SSE parsing.

## Human play inside an Agent client

When the user wants to operate the game personally, call:

```text
open_game({"gameId":"doudizhu","mode":"human-bots"})
```

On an MCP Apps-capable Host, the tool result links to:

```text
ui://waitloop/doudizhu/v1
```

with MIME type:

```text
text/html;profile=mcp-app
```

The inline table supports:

```text
select cards
play selected
pass
hint
clear selection
refresh state
inline/fullscreen display where the Host allows it
```

The Human is the real owner/controller of `seat-1`. Waitloop creates an ordinary Human `bots` Room and reuses the existing Human play/pass/hint APIs. The App does not impersonate an Agent Actor.

The local bridge stores the Human Room cookies privately under:

```text
~/.waitloop/app-rooms
```

It also creates a high-entropy `wlui_...` App capability. The cookies and capability are never returned in model-visible content. The self-contained App performs no credentialed network requests directly; all actions go through the local MCP bridge.

To reopen a still-valid inline Room in a new message/tool result:

```text
open_game({"roomId":"<room-id>"})
```

### Host support and fallback

Inline operation requires a Host that:

1. recognizes MCP Apps tool metadata;
2. reads the linked `ui://` resource;
3. renders `text/html;profile=mcp-app` in a sandbox;
4. forwards the initial tool result, including result `_meta`, to the App;
5. proxies App `tools/call` requests back to the MCP server.

Do not assume every Codex, Claude, Cursor, terminal, or desktop surface currently supports all five capabilities. Detect behavior from the active Host. The Codex desktop client has been manually observed rendering and operating the Waitloop alpha.7 MCP App, but that evidence does not automatically apply to every Codex surface or version.

A Host may show the safe model-visible JSON/structured snapshot in the transcript **and** render the linked MCP App simultaneously. Seeing the snapshot is therefore not a failure signal. Do not automatically launch the browser fallback merely because `open_game()` returned visible JSON. Use fallback only after the active Host actually fails to render or operate the App, reports an App error, or the Human says inline controls are absent.

If the Host does not render or cannot operate the App, the safe result explains two fallbacks:

```text
open https://waitloop.run/game.html
  -> starts a separate browser-controlled game

create_room()
  -> starts an Agent-owned headless game
```

The browser fallback is deliberately described as a **separate game**. Waitloop does not expose private Human Room cookies in a URL merely to make the same inline Room transferable.

## Install and update

During alpha, use the explicit dist-tag:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

`waitloop doctor` compares the installed CLI with the published version and inspects supported local integrations.

Install the stable MCP once:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

The lifecycle installer also installs the stable MCP for Codex/Claude Code:

```bash
waitloop install codex
waitloop install claude-code
```

Cursor lifecycle integration remains available, but stable MCP configuration is currently manual where that harness supports stdio MCP.

### Lifecycle integration is optional and separate

Only initialize/pair when the user wants Waitloop to observe coding-work lifecycle:

```bash
waitloop init --url https://waitloop.run
waitloop pair
```

Lifecycle hooks never carry game credentials and game credentials never authorize lifecycle ingestion. Stop/failure/session-end hooks finalize `completed` or `failed` before native-session cleanup, so `waitloop status` does not retain a stale `running` or `waiting` state after the harness closes.

### Codex hook trust

`waitloop install codex` writes the lifecycle hook definition and installs the stable MCP entry. Codex itself still owns command-hook review/trust. Use Codex CLI `/hooks` to review the exact lifecycle command definition.

Plugin packaging may improve distribution, but plugin-bundled command hooks use the same trust-review boundary. A Plugin is not required for the current stable MCP path.

## Agent-owned headless Room

Use this only when the Agent should play:

```text
create_room({"gameId":"doudizhu","mode":"agent-bots"})
```

Equivalent CLI:

```bash
waitloop room create
```

The bridge creates an `agent-bots` Room, claims its Join capability, caches the Room Actor credential, selects it as active, and authenticates the first gameplay request. A browser is never required.

Advanced raw fallback:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

## Join an existing Agent Room

Preferred local MCP call:

```text
join_room({"code":"WL-7K4P9Q2MZX"})
```

Equivalent CLI:

```bash
waitloop join WL-7K4P9Q2MZX
```

`waitloop join` claims/caches the credential and selects that Room as the local bridge's active Agent Room. Default and `--json` output are credential-safe. Use `--raw-mcp` only for an advanced client that cannot use the stable local bridge.

A Join code is one-time and currently expires after about 20 minutes. The claimed Actor credential remains reconnectable while the Room remains active, currently about 24 hours.

Join is credential claim/cache. It does **not** mean the currently running Agent has connected unless either the local bridge authenticates a gameplay request or an advanced client connects directly to remote `/mcp`. `join_room` and `waitloop room create` perform that connection check before reporting `connected: true`.

## Active Agent Room context

The bridge keeps one active Agent Room selection in private local state. It survives bridge restarts while the cached Room credential remains valid.

```text
get_active_room()
```

returns safe metadata plus the current snapshot. To clear only the local selection:

```text
leave_room()
```

This does not revoke the remote credential or mutate the game. It preserves explicit reconnect until Room expiry.

Interactive Human Rooms are stored separately under `~/.waitloop/app-rooms` and reopened explicitly with `open_game(roomId)`; they do not replace the active Agent Room pointer.

## Efficient Agent turn waiting

Use:

```text
wait_for_turn({"timeoutMs":25000})
```

It returns when one of these occurs:

```text
your_turn
game_finished
room_paused
waiting_for_players
controller_changed
timeout
```

A `timeout` only bounds one transport/tool call. It never auto-passes, changes Controller, replaces an Agent, or applies a Casual game timeout. Call it again when continued waiting is still desired.

The MCP host may safely cancel `get_active_room`, `get_turn`, `wait_for_turn`, or `wait_for_room_update`. Cancellation propagates through the read/wait request, stops remote polling, and never mutates the game. Mutation-capable calls are not abandoned mid-flight; after an uncertain mutation transport failure, refresh state before retrying.

`get_turn()` remains available for an immediate snapshot. Do not tightly poll it when `wait_for_turn()` is available.

## Semantic Room-update waiting

Remote Room MCP and the published local bridge expose:

```text
wait_for_room_update({"afterRoomSeq":12,"timeoutMs":25000})
```

Use the last snapshot `roomSeq`, not game `revision`. It returns `room_updated` when a move, comment, Controller transition, Room phase, Join, or semantic presence event advances the cursor; it returns `game_finished` for a terminal Room and `timeout` when one bounded call expires. A cursor ahead of the authoritative Room fails with `room_seq_ahead`; recover with `get_turn()`. The tool is read-only, cancellable, and Advisor-safe, but it cannot wake an Agent run after the Agent has sent a final reply.

## Agent gameplay tools

### `get_turn()`

Returns the private projection of the explicitly bound Seat, public Room state, current Controller, capabilities, and server-generated legal move IDs. It never exposes an unrelated Seat's hidden hand.

### `play_move(expectedRevision, moveId)`

Only the active Controller can play. Use the exact revision and a server-generated move ID from `get_turn()` or `wait_for_turn()`.

### `comment(text)`

Writes a bounded side-channel comment. It does not change game state, revision, turn order, or legality.

### `yield_to_bot()`

A connected Actor that owns and controls its Seat may explicitly hand control to a deterministic temporary Bot. Seat ID, owner, cards, role, and history remain unchanged. This is never triggered solely by elapsed Casual time.

In fully headless `agent-bots` mode, yielding `seat-1` leaves all three Seats under Bot control. The deterministic bots may finish the rest of the game before the Agent reconnects. Treat it as an explicit handoff, not a pause command.

### `take_control()`

After reconnecting with the same cached Room credential, the Seat owner explicitly reclaims control from the temporary Bot. Reconnection itself never silently steals control. If the bots already finished a headless game, `take_control()` cannot reopen it.

## Continuous Agent play

MCP is request/response participation; it cannot wake an Agent after that Agent has already returned a final reply.

If the user asks only to **connect or verify**, `join_room`/`get_turn` may be enough. If the user asks the **Agent** to take over, continue playing, or finish the game, keep the current Agent run active:

```text
wait_for_turn()
  -> if your_turn: reason and play_move()
  -> if timeout: wait_for_turn() again while the request remains active
  -> if controller_changed: wait or take_control only when authorized/requested
  -> if game_finished: return the final result
```

Do not reply “connected” and terminate when the requested stopping condition is game completion.

Human-operated `open_game()` is different: after rendering the App, the Human drives moves by clicking. The model should not repeatedly call Agent gameplay tools on the Human's behalf.

## Advisor behavior

An Advisor may see the private state and legal options of the one Seat it is explicitly bound to and may call `comment(text)`. It cannot call `play_move` until the Seat owner explicitly delegates Controller authority.

`wait_for_turn()` remains Controller/turn-oriented and may return `controller_changed` immediately for a Human-controlled companion Seat. During the same active Agent run, an Advisor should instead repeat `wait_for_room_update(afterRoomSeq)` and may post `comment(text)` after relevant semantic events. Binding or connection still does not mean an ended Agent run is listening, so never promise background advice after final response.

## Remote MCP fallback

The remote endpoint remains available for clients that cannot run the local bridge:

```text
https://waitloop.run/mcp
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

Remote tools are:

```text
get_turn()
wait_for_turn(timeoutMs?)
wait_for_room_update(afterRoomSeq, timeoutMs?)
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Raw Join/remote MCP configuration must never be printed into prompts, logs, source, or commits. Remote Room MCP does not host the Human MCP App; that UI belongs to the local bridge because it owns the private local Human session.

## Current Room modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

- `bots`: Human + two deterministic bots; used by Web and the `open_game()` facade.
- `connected-agent`: Human and Agent occupy separate Seats.
- `companion-agent`: Agent is Advisor of the Human Seat until explicitly delegated.
- `agent-bots`: connected Agent owns `seat-1` against two deterministic bots; fully headless.

New Dou Dizhu Rooms use stable `seat-1`, `seat-2`, and `seat-3` identifiers. IDs never authorize access.

## Security baseline

Current safeguards include:

- 16 KiB JSON request-body cap;
- Cloudflare Room-create and tighter hosted-room rate limiting;
- per-Room/per-Actor Join, MCP, mutation, comment, control, and recovery limits;
- one-time short Join capabilities;
- bounded Room lifetime;
- server-side capability/revision checks;
- separate identifiers and credentials;
- local Agent credential custody and credential-shaped error redaction;
- private Human cookies stored only in the local bridge;
- private `wlui_` capability delivered only through result `_meta` to the App;
- app-only Human mutation tools that require that capability;
- self-contained App HTML with no credentialed direct network calls;
- cancellation only for read/wait operations.

Rate limits are abuse protection, not accounting.

## Agent operating order

1. Read `agent.json` and this guide; use a declared mirror if direct Markdown fetch is blocked.
2. Install/update the CLI and run `waitloop doctor`.
3. Configure the stable MCP once with `waitloop mcp install <agent>` or the lifecycle installer.
4. If the Human wants clickable play, call `open_game()` and let the MCP App drive Human actions.
5. Do not treat a visible JSON snapshot as evidence that the App failed; some Hosts render both the transcript result and inline App.
6. If the Agent should play autonomously, call `create_room()` or `join_room(code)`.
7. For Agent-owned play, call `wait_for_turn()` rather than polling and use current revision/legal move IDs.
8. Keep the current Agent run active when the user requested Agent-controlled continued play or completion.
9. Use `yield_to_bot()` only as an explicit owner action; in `agent-bots`, expect the bots may finish the game.
10. Reconnect through cached active Agent Room context and call `take_control()` explicitly when ready.
11. Advisors may inspect/comment but need explicit delegation to play; use `wait_for_room_update(afterRoomSeq)` rather than `wait_for_turn()` to observe semantic companion events during the current Agent run.
12. Never claim inline UI support when the active Host did not render or operate the MCP App, and never invoke the separate browser fallback without an actual Host/UI failure.
13. Coding-work attention always outranks the game.

Never weaken another product's security settings or overwrite unrelated MCP/hook configuration merely to make Waitloop work.
