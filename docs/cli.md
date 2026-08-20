# Waitloop CLI

The CLI is the local integration layer between Waitloop and coding agents. It owns local configuration, device pairing, lifecycle hook installation, diagnostics, opening the current waiting session, and connected-agent room join-code exchange.

Game rules, room authority, hosted game agents, MCP tools, and remote session state remain server-side.

## Install

The public alpha channel is installed with:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
```

The exact published version is machine-readable in:

```text
packages/cli/package.json
https://waitloop.run/agent.json
```

Do not hard-code a particular alpha patch version into general installation documentation.

Then initialize and pair:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Canonical external-agent instructions:

```text
https://waitloop.run/agent.md
```

## Local files

```text
~/.waitloop/
├── config.json
├── joins/
└── state/
    ├── claude-code/
    ├── cursor/
    └── codex/
```

`config.json` contains the stable local device identity and, after pairing, a scoped lifecycle device credential. Join credentials are separate room-scoped capabilities and must never be treated as lifecycle credentials.

Raw device credentials are not stored server-side; the server stores only their digest. Native coding-agent session identifiers remain local correlation data and are not emitted in lifecycle events.

## Commands

```text
waitloop init [--url URL] [--yes]
waitloop pair [--no-open] [--bootstrap-token TOKEN]
waitloop join <join-code> [--url URL] [--json]
waitloop unpair
waitloop doctor
waitloop install <claude-code|cursor|codex|all>
waitloop uninstall <claude-code|cursor|codex|all>
waitloop status
waitloop open [--print]
waitloop config
waitloop hook <claude-code|cursor|codex>
waitloop --version
```

Development/migration options may exist in the binary but are not normal public setup instructions unless `agent.md`/`agent.json` expose them.

## Initialize

```bash
waitloop init --url https://waitloop.run
```

Initialization creates/updates local config, preserves the local device ID, detects installed coding agents, and can install supported lifecycle adapters.

## Pair a device

Normal flow:

```bash
waitloop pair
```

The CLI:

1. ensures a local device identity exists;
2. creates a short-lived pairing request;
3. keeps a high-entropy verifier locally;
4. opens the browser approval URL unless `--no-open` is used;
5. waits for explicit browser approval;
6. exchanges the verifier for one `agent:write` device credential;
7. stores that credential privately.

The privileged bootstrap path exists only for development/recovery and must not become the normal end-user setup path.

## Join a connected-agent game seat

Connected-agent rooms expose a temporary code such as:

```text
WL-7K4P9Q2MZX
```

Claim it with:

```bash
waitloop join WL-7K4P9Q2MZX
```

For an automated agent that wants structured output:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

The command:

1. normalizes the join code;
2. calls the room-specific join API;
3. exchanges the one-time code for a `wlseat_...` room credential;
4. stores/caches only the room-scoped join information locally;
5. prints the temporary MCP configuration for that room.

Claiming the code moves the seat to `connecting`. The connected-agent room remains in `waiting_for_players` until the claimed MCP credential is actually used. The first authenticated MCP request marks the seat connected and starts the room.

The CLI is a convenience layer. Agents without the CLI can use the `/join/<code>` onboarding path and raw MCP configuration.

## Unpair

```bash
waitloop unpair
```

The CLI self-revokes the remote device credential and removes it locally. Device lifecycle credentials and game seat credentials are separate scopes.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

`waitloop config` redacts secrets. `status` reads adapter-local latest-state files. `open` prefers a running/waiting coding-agent turn.

## Install and uninstall lifecycle adapters

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
waitloop install all

waitloop uninstall claude-code
waitloop uninstall cursor
waitloop uninstall codex
waitloop uninstall all
```

Installers merge only Waitloop-owned hook entries and preserve unrelated user configuration. Uninstallers remove only Waitloop-owned handlers.

### Claude Code

Lifecycle mapping includes running/waiting/completed/failed signals from supported Claude hooks. Prompt text, working directory, transcript path, tool input, and tool output are ignored.

A source-only Claude Code plugin also exists under `integrations/claude-code/`, but normal product setup should prefer the CLI installer so pairing/configuration remain centralized.

### Cursor

The Cursor installer maps supported user/stop/session lifecycle events into the canonical Waitloop protocol. Native conversation/generation identifiers stay local.

### Codex

The Codex installer adds Waitloop hooks and the user must review/trust the Waitloop hook through Codex's `/hooks` UI. Waitloop must not bypass that trust step.

Prompt text, working directory, tool payloads, assistant output, and native session/turn identifiers are not emitted to Waitloop.

### DSH

DSH detection may exist, but the lifecycle adapter is still planned. Do not invent a `waitloop install dsh` command until implementation and `agent.json` mark it available.

## Lifecycle credential order

Normal lifecycle delivery prefers a scoped device credential. Legacy Worker-wide ingest/access values are migration/development mechanisms, not recommended user credentials.

The device credential grants lifecycle ingestion (`agent:write`) only. It does not grant arbitrary browser, game, admin, or MCP access.

## Hook delivery behavior

Lifecycle delivery is best-effort and fail-open. A Waitloop outage must not become a coding-agent outage. Network delivery uses a bounded timeout.

## Game MCP is separate

Installing lifecycle hooks does not globally install a playable MCP seat.

A connected-agent room creates a separate temporary capability for:

```text
get_turn()
play_move(expectedRevision, moveId)
```

Room/seat authentication remains outside model-visible tool arguments. See [`mcp.md`](mcp.md).

## Maintenance rule

When CLI behavior changes, update the same change set across:

- CLI implementation/tests;
- `packages/cli/README.md`;
- this document;
- `apps/web/public/agent.md`;
- `apps/web/public/agent.json`;
- `apps/web/public/skills/waitloop/SKILL.md`;
- `llms.txt` when discovery/entrypoints change;
- release documentation when release mechanics change.

`pnpm check:repo-contract` enforces a subset of these synchronization invariants.