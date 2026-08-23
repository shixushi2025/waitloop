# Waitloop

**Tiny games while your coding agent runs — including a Human-operated table inside MCP Apps-capable Agent clients.**

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is a developer-native waiting layer, not an engagement/casino product. Coding work always has priority.

## Current priority

The focus is stabilizing the existing Human MCP App and Agent create/join/wait/play/reconnect paths in real Hosts, not continuously adding modes.

## Agent entrypoints

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
```

`agent.json` declares GitHub mirrors for Agent/browser environments that block direct Markdown navigation.

## CLI and stable MCP

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

Install the stable local stdio MCP once:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

Runtime command:

```text
waitloop mcp
```

### Human wants to play in the Agent client

```text
open_game({gameId:"doudizhu", mode:"human-bots"})
```

On an MCP Apps-capable Host, Waitloop renders:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

The Human can select cards, play, pass, request a hint, clear, refresh, and use fullscreen where supported.

The Human is the real owner/controller of `seat-1`; this is not an Agent pretending to be the Human. Existing Human Room APIs remain authoritative.

App-only tools:

```text
ui_get_game
ui_play_cards
ui_pass
ui_hint
```

Human cookies stay in private `~/.waitloop/app-rooms` state. A random `wlui_` capability is delivered only in tool-result `_meta` to the embedded App, is required by each app-only tool, and is absent from model-visible content.

If the active Host does not support MCP Apps, Waitloop returns an explicit fallback. The standalone Web URL starts a separate browser-controlled game; it does not transfer the private inline Room.

### Agent should play autonomously

```text
create_room({gameId:"doudizhu", mode:"agent-bots"})
```

This preserves the existing Agent-owned headless flow:

```text
seat-1 Agent
seat-2 Bot
seat-3 Bot
```

### Model-visible local surface

The published npm alpha exposes:

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

The bridge reuses existing Human Room HTTP, Room/Join HTTP, and remote Room MCP. Raw credentials are not returned through model-visible tools.

CLI Agent-Room equivalents:

```bash
waitloop room create
waitloop join WL-XXXXXXXXXX
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

Default Join output is credential-safe. `--raw-mcp` remains an explicit advanced fallback.

## Lifecycle integration

Lifecycle reporting is optional and separate from Agent/Human game credentials:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop install codex
```

`waitloop install codex`/`claude-code` also configure stable MCP. Codex lifecycle command hooks remain subject to Codex's own `/hooks` review/trust boundary. Plugin packaging cannot bypass that requirement.

## Game identity

```text
Room       one active game runtime
Seat       stable position (`seat-1`, `seat-2`, `seat-3`)
Actor      Human | Bot | Hosted Agent | Connected Agent
Binding    Actor -> Seat
Controller Actor currently allowed to play
Advisor    bound Actor that may inspect/comment but not play until delegated
```

Identifiers are not credentials.

Current modes:

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

`open_game()` presents existing Human `bots` mode through an MCP App. `create_room()` uses existing fully headless `agent-bots` mode.

## Efficient Agent play and recovery

Remote/local Agent MCP provide `wait_for_turn()`. It returns on turn, finish, lobby, pause, Controller change, or a bounded transport timeout. Timeout never auto-passes or replaces a Casual Agent.

Remote and local MCP also provide `wait_for_room_update(afterRoomSeq, timeoutMs?)`. It waits for semantic `roomSeq` changes such as moves, comments, Controller transitions, and Room phase changes, so Advisors can observe without gaining `seat:play`. It remains a bounded current-run wait, not background wake-up or the final push transport.

MCP cannot wake an Agent after a final reply. A request for the Agent to play until finished must keep the current run active:

```text
wait_for_turn()
-> play_move()
-> wait_for_turn()
-> ...
-> game_finished
```

Human-operated `open_game()` is different: after render, the Human drives the game by clicking.

Connected Seat owners can explicitly:

```text
yield_to_bot()
... bridge/harness restarts and reconnects ...
take_control()
```

Seat owner, ID, hand, role, and history remain unchanged. Reconnect never silently steals control. In `agent-bots`, yielding may let all three Bots finish the game.

## Safety baseline

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join/MCP/comment/control/recovery/Human mutation limits;
- one-time ~20 minute Join codes;
- ~24 hour active Rooms;
- hashed server credentials;
- private local Agent credential and Human cookie custody;
- UI-only `wlui_` capability in result `_meta`, absent from model content;
- app-only Human tools requiring that capability;
- self-contained MCP App with no direct credentialed network traffic;
- capability/revision checks for every mutation;
- hidden-information projections and negative tests.

No database/account layer is required for current one-Room recovery.

## Current implementation

Also included:

- Claude Code/Cursor/Codex lifecycle adapters;
- deterministic Bots + configurable Hosted Agent Seats;
- server-authoritative Dou Dizhu with random landlord until bidding is implemented;
- companion advice/comments and Human/Agent Controller switching in standalone Web;
- browser Room recovery and temporary Bot fallback;
- CI-gated Cloudflare production deployment;
- strict CI plus repository/onboarding/MCP Apps contracts.

See [`docs/status.md`](docs/status.md), [`docs/architecture.md`](docs/architecture.md), [`docs/mcp.md`](docs/mcp.md), and [`docs/README.md`](docs/README.md).

Repository-editing Agents must follow [`AGENTS.md`](AGENTS.md).

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
pnpm check:mcp-stdio
pnpm dev
```

## Domain

**https://waitloop.run**

## License

MIT.
