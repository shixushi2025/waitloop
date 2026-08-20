# Waitloop CLI

The CLI is the local convenience/integration layer. It owns local config, lifecycle pairing/adapters, diagnostics, and Join exchange. Room/game authority remains server-side.

## Install / update

During the alpha channel, use the explicit dist-tag:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

`waitloop doctor` checks the published CLI version from the configured Waitloop server's `agent.json`. If the local binary differs, it prints the canonical update command instead of leaving the user to infer which npm tag is current.

Initialize/pair only when lifecycle reporting is desired:

```bash
waitloop init --url https://waitloop.run
waitloop pair
```

Exact package version/candidate status is authoritative in `packages/cli/package.json` and `agent.json`.

CLI help is side-effect free. In particular, `waitloop install codex --help` prints help and must never create/modify a hook file.

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

The raw credential is cached privately under `~/.waitloop/joins/<code>.json` so the same Actor can reconnect while the Room remains active. Expired room cache entries are ignored/removed rather than being printed as usable MCP configuration. The Join code itself is one-time and expires much sooner than the Room.

A cached MCP credential is not a global Waitloop identity and is not reused for lifecycle reporting.

### Join is not MCP attachment

`waitloop join` claims/caches the room Actor capability and prints its MCP configuration. It does **not** hot-inject a new remote MCP server into an already-running Codex/Claude/Cursor session.

Therefore:

```text
waitloop join succeeds
    !=
Agent is connected to the room
```

The room considers the Actor connected only after an authenticated request reaches `/mcp`.

Until a stable local MCP bridge exists, a harness that cannot add MCP dynamically must use its own supported MCP configuration/reload path, or use raw MCP HTTP for that current task without leaking the cached bearer credential into chat/log output.

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

MCP does not continue running after an Agent returns a final response. Continuous play is an Agent-run behavior, not a CLI background daemon.

## Lifecycle adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

For Codex, `waitloop doctor` additionally checks:

- detected Codex CLI version;
- whether `codex features list` reports hooks available;
- how many of the four Waitloop lifecycle hook events are installed.

Codex owns hook trust. An installed command hook is still skipped until the exact current definition is reviewed/trusted through Codex's hook review flow (`/hooks` in Codex CLI).

A Codex Plugin can improve packaging/distribution of Skill/MCP/hooks, but plugin-bundled command hooks use the same trust-review flow. Plugin packaging is not a substitute for trust.

Lifecycle delivery stays fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

`doctor` is intended to answer the first-line questions before users start manual debugging: current Waitloop CLI, server reachability, pairing status, detected agents, and Codex hook compatibility/installation.

## Not implemented yet

- stable local MCP bridge / automatic harness MCP configuration after Join;
- `wait_for_turn`/long-poll integration;
- automatic removal of temporary local MCP config at Room end;
- account/cross-device identity.

Do not describe those as current behavior.

## Maintenance

CLI/Join changes require synchronized CLI package docs, public Agent surfaces, MCP/protocol/security docs, release metadata, and package validation. `pnpm check:repo-contract` enforces key cross-file invariants.
