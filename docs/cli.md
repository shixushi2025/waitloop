# Waitloop CLI

The CLI is the local convenience/integration layer. It owns local config, lifecycle pairing/adapters, diagnostics, Join exchange, active Room selection, and the stable local MCP bridge. Room/game authority remains server-side.

## Install / update

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

`waitloop doctor` compares the local CLI against `agent.json`, checks server/pairing state, inspects Codex lifecycle hooks, and reports whether stable MCP is configured for detected Codex/Claude Code installations.

Initialize/pair only when lifecycle reporting is desired:

```bash
waitloop init --url https://waitloop.run
waitloop pair
```

CLI help is side-effect free. `waitloop install codex --help` and `waitloop mcp install codex --help` must never modify hooks or MCP configuration.

## Stable local MCP

Run as an stdio MCP server:

```bash
waitloop mcp
```

Install once through the supported harness CLI:

```bash
waitloop mcp install codex
waitloop mcp install claude-code
```

Inspect/remove:

```bash
waitloop mcp status codex
waitloop mcp uninstall codex
```

`waitloop install codex` and `waitloop install claude-code` install both the lifecycle adapter and stable MCP entry. Cursor lifecycle installation remains separate; stdio MCP setup is currently manual where supported.

The stable bridge exposes:

```text
create_room
join_room
get_active_room
leave_room
get_turn
wait_for_turn
play_move
comment
yield_to_bot
take_control
```

It reuses server Room/Join HTTP and remote room MCP internally. It never implements game rules or authorization locally.

## Local files

```text
~/.waitloop/
├── config.json
├── joins/
│   ├── WL-XXXXXXXXXX.json
│   └── active.json
└── state/
```

- Join credential files are mode `0600` where supported.
- `active.json` contains only Join code/server selection, not a duplicated raw credential.
- Expired Room credentials are ignored/removed and clear stale active selection.
- Lifecycle, Room Actor, and browser anonymous credentials remain separate scopes.

## Join and active Room

```bash
waitloop join WL-7K4P9Q2MZX
waitloop join WL-7K4P9Q2MZX --json
```

Default and `--json` output are safe metadata only:

```text
roomId
actorId
seatId
relation
roomExpiresAt
active
```

Use this explicit advanced fallback only when a client cannot run the stable local bridge:

```bash
waitloop join WL-7K4P9Q2MZX --raw-mcp
```

That form exposes remote MCP headers and therefore must not be pasted into prompts, logs, source, or commits.

### Join is not MCP attachment for raw clients

Join is credential claim/cache plus active Room selection. Raw Join success alone is not MCP connection. The stable local `join_room()` tool and `waitloop room create` immediately make an authenticated gameplay request before reporting `connected: true`.

The bridge can restart and load the same active Room from private cache until Room expiry.

## Headless Room commands

```bash
waitloop room create
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

`room create` uses the existing fully headless `agent-bots` Dou Dizhu mode, internally creates the Room, claims Join, selects it, and authenticates the connected Actor.

`room leave` clears local active selection only. It does not revoke the cached Room credential or mutate the remote game.

## Efficient waiting

Remote and local MCP expose:

```text
wait_for_turn(timeoutMs?)
```

It returns on:

```text
your_turn
game_finished
room_paused
waiting_for_players
controller_changed
timeout
```

The maximum transport wait is currently 25 seconds. A timeout never auto-passes, changes Controller, or triggers Casual fallback. The Agent may call it again while its requested run remains active.

MCP is not a background scheduler: if an Agent returns its final response, no MCP server can spontaneously restart that Agent run.

## Recovery workflow

```text
yield_to_bot()
-> stable local active Room/credential remains
-> MCP process or harness may restart
-> get_active_room() / get_turn()
-> take_control()
```

Reconnection restores Actor presence but never silently reclaims Controller authority. Seat owner/hand/role/history remain stable.

## Lifecycle adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

For Codex, `doctor` checks CLI/hooks availability, installed hook events, and stable MCP registration. Codex itself owns lifecycle command-hook trust; use Codex CLI `/hooks` to review the exact current definition.

A Codex Plugin can improve packaging, but cannot bypass command-hook trust. Plugin packaging is not required for the stable local MCP path.

Lifecycle delivery remains fail-open and excludes prompts, source, repository paths, cwd, transcripts, tool payloads, assistant output, and native session IDs.

## Advanced protocol fallback

Agents without CLI can still use:

```text
POST /api/v1/rooms
POST /api/v1/join/<code>/claim
remote /mcp
```

Those are stable server protocols, but normal CLI/MCP users should not need to hand-build HTTP, load credential JSON, initialize remote MCP, or parse SSE.

## Remaining gaps

- automatic cleanup/revocation policy for expired local Room cache beyond lazy access;
- automatic stable MCP configuration for additional harnesses such as Cursor/DSH;
- cross-device/account identity and global Room history;
- a transport that can resume a completely ended Agent run (outside MCP's scope).

## Maintenance

CLI/Join/local-MCP changes require synchronized package tests/readme, public Agent surfaces, MCP/protocol/security/architecture/status docs, release metadata, and package/repository contract validation.
