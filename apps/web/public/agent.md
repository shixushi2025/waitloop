# Waitloop Agent Integration Guide

Canonical URL: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Agent skill: https://waitloop.run/skills/waitloop/SKILL.md
Local MCP command: `waitloop mcp`
Remote room MCP: https://waitloop.run/mcp
Source: https://github.com/shixushi2025/waitloop

Waitloop is a developer-native waiting layer for coding agents. Work has priority over games. Lifecycle integration and game participation are deliberately separate.

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

## The supported Agent path

The primary Agent interface is the stable local stdio MCP server:

```text
waitloop mcp
```

It is installed once in a supported harness. It exposes both control-plane conveniences and gameplay tools while reusing the existing server APIs internally:

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

Room Actor credentials stay in private local Waitloop state. Local MCP tools return safe Room/Actor/Seat metadata and game snapshots, never the bearer credential.

The same stdio command accepts MCP 2026-07-28 discovery and supported legacy initialize clients. Long-running tool calls are tracked independently so `wait_for_turn()` does not block cancellation handling for the entire bridge.

The underlying boundaries remain:

```text
Room/Join HTTP API  server control protocol
remote /mcp         one authorized Room Actor gameplay protocol
local waitloop mcp  stable Agent-facing bridge over both
CLI                 human/script convenience over the same clients
Web                 Human UI
```

HTTP is an advanced fallback and implementation boundary; a normal Agent should not need to hand-build HTTP requests or JSON-RPC/SSE parsing.

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

Lifecycle hooks never carry game credentials and game MCP credentials never authorize lifecycle ingestion.

### Codex hook trust

`waitloop install codex` writes the lifecycle hook definition and installs the stable MCP entry. Codex itself still owns command-hook review/trust. Use Codex CLI `/hooks` to review the exact lifecycle command definition.

Plugin packaging may improve distribution, but plugin-bundled command hooks use the same trust-review boundary. A Plugin is not required for the current stable MCP path.

## Create a headless Room

Preferred local MCP call:

```text
create_room({"gameId":"doudizhu","mode":"agent-bots"})
```

Equivalent CLI:

```bash
waitloop room create
```

The bridge internally creates the existing `agent-bots` Room, claims its Join capability, caches the room Actor credential, selects it as active, and authenticates the first gameplay request. A browser is never required.

Advanced raw fallback:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

## Join an existing Room

Preferred local MCP call:

```text
join_room({"code":"WL-7K4P9Q2MZX"})
```

Equivalent CLI:

```bash
waitloop join WL-7K4P9Q2MZX
```

`waitloop join` claims/caches the credential and selects that Room as the local bridge's active Room. Default and `--json` output are credential-safe. Use `--raw-mcp` only for an advanced client that cannot use the stable local bridge.

A Join code is one-time and currently expires after about 20 minutes. The claimed Actor credential remains reconnectable while the Room remains active, currently about 24 hours.

For historical clarity: Join is credential claim/cache. It does **not** mean the currently running Agent has connected unless either the local bridge authenticates a gameplay request or an advanced client connects directly to remote `/mcp`. `join_room` and `waitloop room create` perform that connection check before reporting `connected: true`.

## Active Room context

The bridge keeps one active Room selection in private local state. It survives bridge restarts while the cached Room credential remains valid.

```text
get_active_room()
```

returns safe metadata plus the current snapshot. To clear only the local selection:

```text
leave_room()
```

This does not revoke the remote credential or mutate the game. It preserves explicit reconnect until Room expiry.

## Efficient turn waiting

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

If the harness or user cancels an in-flight wait, allow MCP cancellation to stop it. The local bridge consumes `notifications/cancelled`, aborts the matching proxied HTTP request, and suppresses the cancelled stale tool result. The remote polling loop observes the same request abort and stops promptly rather than waiting for the 25-second timeout.

Cancellation itself never auto-passes, auto-plays, yields to a Bot, calls `take_control`, or changes any game state.

`get_turn()` remains available for an immediate snapshot. Do not tightly poll `get_turn()` when `wait_for_turn()` is available.

## Recoverable local errors

When the bridge can classify a failure, local MCP tool errors may include:

```text
error.code
error.message
error.nextAction   optional
error.retrySafe    optional
```

Follow `nextAction` only when it remains consistent with the user's request. `retrySafe: true` is reserved for operations known to be safe to repeat, especially read/wait transport failures.

Do not blindly replay cancelled or failed mutating operations. Call `get_turn()` first because the remote outcome can be uncertain after a transport interruption.

If an active Room is expired, missing, or no longer authorized, the bridge clears the stale active pointer and directs the Agent toward `create_room()` or a fresh `join_room(code)` when appropriate.

## Gameplay tools

### `get_turn()`

Returns the private projection of the explicitly bound Seat, public Room state, current Controller, capabilities, and server-generated legal move IDs. It never exposes an unrelated Seat's hidden hand.

### `play_move(expectedRevision, moveId)`

Only the active Controller can play. Use the exact revision and a server-generated move ID from `get_turn()` or `wait_for_turn()`.

### `comment(text)`

Writes a bounded side-channel comment. It does not change game state, revision, turn order, or legality.

### `yield_to_bot()`

A connected Actor that owns and controls its Seat may explicitly hand control to a deterministic temporary Bot. Seat ID, owner, cards, role, and history remain unchanged. This is never triggered solely by elapsed Casual time.

### `take_control()`

After reconnecting with the same cached Room credential, the Seat owner explicitly reclaims control from the temporary Bot. Reconnection itself never silently steals control.

## Continuous Agent play

MCP is request/response participation; it cannot wake an Agent after that Agent has already returned a final reply.

If the user asks only to **connect or verify**, `join_room`/`get_turn` may be enough. If the user asks to **take over, continue playing, or finish the game**, keep the current Agent run active:

```text
wait_for_turn()
  -> if your_turn: reason and play_move()
  -> if timeout: wait_for_turn() again while the request remains active
  -> if controller_changed: wait or take_control only when authorized/requested
  -> if cancelled: stop that wait and follow the user's/harness's interruption
  -> if game_finished: return the final result
```

Do not reply “connected” and terminate when the requested stopping condition is game completion.

## Advisor behavior

An Advisor may see the private state and legal options of the one Seat it is explicitly bound to and may call `comment(text)`. It cannot call `play_move` until the Seat owner explicitly delegates Controller authority.

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
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Raw Join/remote MCP configuration must never be printed into prompts, logs, source, or commits.

## Current Room modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

- `connected-agent`: Human and Agent occupy separate Seats.
- `companion-agent`: Agent is Advisor of the Human Seat until explicitly delegated.
- `agent-bots`: connected Agent owns `seat-1` against two deterministic bots; fully headless.

New Dou Dizhu Rooms use stable `seat-1`, `seat-2`, and `seat-3` identifiers. IDs never authorize access.

## Browser identity and fallback

Human Web users receive a persistent anonymous Actor ID plus a separate HttpOnly credential; no account is required. If the shorter Room viewer cookie disappears, the remembered credential can restore Room access during Room lifetime.

A Room/Seat owner may explicitly choose temporary Bot fallback. The original owner can later resume without changing the Seat's game state.

## Security baseline

Current safeguards include:

- 16 KiB JSON request-body cap;
- Cloudflare Room-create and tighter hosted-room rate limiting;
- per-Room/per-Actor Join, MCP, mutation, comment, control, and recovery limits;
- one-time short Join capabilities;
- bounded Room lifetime;
- server-side capability/revision checks;
- separate identifiers and credentials;
- local MCP credential custody;
- cancellation that aborts transport waiting without hidden game mutation or stale result delivery.

Rate limits are abuse protection, not accounting.

## Agent operating order

1. Read `agent.json` and this guide; use a declared mirror if direct Markdown fetch is blocked.
2. Install/update the CLI and run `waitloop doctor`.
3. Configure the stable MCP once with `waitloop mcp install <agent>` or the lifecycle installer.
4. Call `create_room()` for headless Agent-vs-bots, or `join_room(code)` for a supplied Join code.
5. Call `wait_for_turn()` rather than polling; respect harness/user cancellation instead of inventing game timeout behavior.
6. Check capabilities, revision, and legal move IDs before `play_move`.
7. Keep the current Agent run active when the user requested continued play or completion.
8. Use `yield_to_bot()` only as an explicit owner action.
9. Reconnect through cached active Room context and call `take_control()` explicitly when ready.
10. Advisors may inspect/comment but need explicit delegation to play.
11. Coding-work attention always outranks the game.

Never weaken another product's security settings or overwrite unrelated MCP/hook configuration merely to make Waitloop work.
