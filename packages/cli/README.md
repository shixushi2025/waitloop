# @waitloop/cli

Waitloop CLI connects local coding agents to [waitloop.run](https://waitloop.run) without sending prompts, source code, repository contents, tool payloads, terminal output, or raw Room credentials into model-visible MCP results. It also serves a Human-operated Dou Dizhu MCP App from the same stable local bridge.

## Install / update

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

Initialize/pair only when coding-agent lifecycle reporting is desired:

```bash
waitloop init --url https://waitloop.run
waitloop pair
```

## Stable local MCP

Install once:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

Stable stdio command:

```text
waitloop mcp
```

The bridge supports legacy 2025-era and 2026-07-28 MCP clients through the official MCP v2 stdio server entry.

## Human-operated MCP App

When the user wants to play personally inside an MCP Apps-capable Agent client, the Agent should call:

```text
open_game({"gameId":"doudizhu","mode":"human-bots"})
```

The result links to:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

The Human can select cards, play, pass, request a hint, clear, refresh, and use fullscreen where the Host allows it.

The Human is the actual owner/controller of `seat-1`. The bridge creates an ordinary Human `bots` Room and proxies the existing Human Room APIs; it does not make the Human App impersonate an Agent Actor.

App-only tools:

```text
ui_get_game
ui_play_cards
ui_pass
ui_hint
```

Private Human state:

```text
~/.waitloop/app-rooms/<sha256(room-id)>.json
```

This stores the Human Room cookies and a random `wlui_...` App capability with private local permissions. The capability is delivered only through tool-result `_meta` to the embedded App, is required by every app-only tool, and is absent from model-visible text/structured content.

The App resource is self-contained and makes no direct credentialed network request. All actions flow through the Host's MCP `tools/call` proxy into the local bridge.

A compatible Host must render MCP Apps, read `ui://` resources, preserve the initial result `_meta`, and proxy App server-tool calls. Unsupported Hosts receive a safe fallback. The standalone web URL starts a separate browser-controlled game; it does not resume the private inline Room.

A still-valid interactive Room can be reopened through:

```text
open_game({"roomId":"<room-id>"})
```

## Agent-owned Room tools

When the Agent should play autonomously, use:

```text
create_room({"gameId":"doudizhu","mode":"agent-bots"})
```

Model-visible local tools:

```text
open_game()
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

The bridge reuses Waitloop Human Room HTTP, Room/Join HTTP, and remote Agent Room MCP. Raw Agent credentials remain in private local cache and are never returned through these tools.

`waitloop install codex` and `waitloop install claude-code` install both lifecycle integration and stable MCP. Cursor lifecycle installation remains available, while MCP configuration is currently manual where supported.

## Create / join / reconnect Agent Room

CLI equivalents:

```bash
waitloop room create
waitloop join WL-7K4P9Q2MZX
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

`room create` creates and connects `agent-bots`. `join` claims/caches the one-time Agent capability and selects that Room as active.

Default output and `--json` do not expose bearer credentials. Advanced raw Agent configuration remains explicit:

```bash
waitloop join WL-7K4P9Q2MZX --raw-mcp
```

Do not paste that output into prompts, logs, source, or commits.

Agent cache:

```text
~/.waitloop/joins/<code>.json
~/.waitloop/joins/active.json
```

Expired Agent Room credentials are ignored/removed. The active pointer contains Join/server context, not another copy of the secret.

`room leave` clears local Agent active selection only; the credential stays cached for explicit reconnect until Room expiry. It does not remove Human App sessions.

## Efficient continuous Agent play

Use `wait_for_turn()` instead of polling `get_turn()`. It returns on turn, finish, pause, lobby, Controller change, or a bounded transport timeout.

A timeout never auto-passes or takes over a Casual Seat. MCP also cannot restart an Agent after a final answer, so a request for the Agent to “play until finished” must keep the current run active through `wait_for_turn -> play_move`.

Human-operated `open_game()` is click-driven and should not be replaced by an Agent gameplay loop unless the user changes intent.

## Yield / recovery

```text
yield_to_bot()
-> bridge/harness may restart
-> get_active_room() / get_turn()
-> take_control()
```

The same Seat, owner, hand, role, and history remain intact. Reconnect never silently steals control from a temporary Bot. In `agent-bots`, yielding may leave all three Seats under Bot control and allow the game to finish.

## Lifecycle integrations

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
waitloop install all
```

Codex command hooks still require review/trust of the exact definition in Codex CLI `/hooks`. Stable MCP, MCP Apps, and lifecycle trust are separate concerns. Plugin packaging cannot bypass command-hook trust.

CLI help is side-effect free: `waitloop install codex --help` and `waitloop mcp install codex --help` never change local configuration.

## Agent-facing contract

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/skills/waitloop/SKILL.md
```

If direct Markdown navigation is blocked, `agent.json` declares GitHub mirrors.

## Privacy

Lifecycle device credentials, Agent Room credentials, Human Room cookies, and App capabilities are separate scopes. Never put them in URLs, source control, prompts, or logs. App capability values belong only in MCP tool-result `_meta` delivered to the embedded App.

## License

MIT
