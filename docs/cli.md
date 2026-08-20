# Waitloop CLI

The CLI is the local convenience/integration layer. It owns local config, lifecycle pairing/adapters, diagnostics, and Join exchange. Room/game authority remains server-side.

## Install

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Exact package version/candidate status is authoritative in `packages/cli/package.json` and `agent.json`.

## Local files

```text
~/.waitloop/
├── config.json
├── joins/
└── state/
```

Lifecycle device credentials, cached Room Actor credentials, and browser anonymous Actor credentials are different scopes.

## Join cache

```bash
waitloop join WL-7K4P9Q2MZX
waitloop join WL-7K4P9Q2MZX --json
```

Current Join cache stores the room-scoped credential plus, when returned by the server:

```text
roomId
actorId
seatId
relation
roomExpiresAt
MCP endpoint/headers
```

Human CLI output displays Actor/Seat/relation; `--json` exposes them for an automated harness.

The raw credential is cached privately under `~/.waitloop/joins/<code>.json` so the same Actor can reconnect while the Room remains active. The Join code itself is one-time and expires much sooner than the Room.

A cached MCP credential is not a global Waitloop identity and is not reused for lifecycle reporting.

## Recovery workflow

After an Agent owns/controls a Seat:

```text
MCP yield_to_bot()
-> CLI/MCP process may leave
-> cached room credential remains
-> reconnect same MCP config
-> MCP get_turn()
-> MCP take_control()
```

Reconnection does not automatically reclaim Controller authority. The explicit `take_control()` step is intentional.

## Headless control plane

CLI is optional. Agents may use raw HTTP:

```text
POST /api/v1/rooms
POST /api/v1/join/<code>/claim
```

then use MCP. `mode:"agent-bots"` is fully headless.

The CLI does not implement Room rules/capability decisions itself.

## Current MCP tools

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

## Lifecycle adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

Codex users must review/trust the lifecycle hook in `/hooks`. Lifecycle delivery stays fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

## Not implemented yet

- stable local MCP bridge / automatic harness MCP configuration after Join;
- `wait_for_turn`/long-poll integration;
- automatic removal of temporary local MCP config at Room end.

Do not describe those as current behavior.

## Maintenance

CLI/Join changes require synchronized CLI package docs, public Agent surfaces, MCP/protocol/security docs, release metadata, and package validation. `pnpm check:repo-contract` enforces key cross-file invariants.
