# Waitloop CLI

The CLI is the local convenience/integration layer between Waitloop and coding agents. It owns local config, device pairing, lifecycle hook installation, diagnostics, opening the current waiting session, and Join-code exchange.

It does **not** own game rules, room authorization, Actor/Seat relationships, or MCP tool semantics; those remain server-side.

## Install

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Exact published version/capabilities are authoritative in `packages/cli/package.json` and `https://waitloop.run/agent.json`.

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

Lifecycle device credentials and game Actor credentials are separate scopes.

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

## Pairing / lifecycle adapters

`waitloop pair` creates a short-lived pairing request, normally opens a browser for explicit approval, and stores a scoped `agent:write` device credential locally.

Install only adapters for harnesses actually present:

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

Codex users must review/trust the Waitloop lifecycle hook in `/hooks`. Waitloop must not bypass that trust step.

Lifecycle delivery is bounded and fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

DSH lifecycle support remains planned unless `agent.json` says otherwise.

## Join a connected Actor

A Join code may represent either an independent Agent controller or an advisor bound to another Seat:

```bash
waitloop join WL-7K4P9Q2MZX
```

Structured output:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

Current CLI behavior:

1. normalizes the code;
2. calls the Join API;
3. exchanges the one-time code for a temporary `wlseat_...` room credential;
4. caches the room credential under `~/.waitloop/joins` for safe retry;
5. prints the temporary MCP configuration.

The historical `wlseat_` prefix remains, but the server now treats it as one room-scoped **Actor binding**. The raw Join API response contains `actorId`, `seatId`, and relation (`controller` or `advisor`). The Agent can also inspect its exact capabilities through MCP `get_turn()`.

The existing CLI binary intentionally does not reimplement the relationship/capability rules.

## CLI is optional for game participation

Agents may instead:

```text
POST /api/v1/rooms
POST /api/v1/join/<code>/claim
POST /mcp
```

For example `mode: "agent-bots"` creates a fully headless Agent + 2 bot room with no browser dependency. The CLI is convenience, not the control-plane authority.

## Game MCP is separate

Current tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

Installing lifecycle hooks does not globally install a playable room Actor. Each game capability remains temporary and room-scoped.

An advisor can inspect its explicitly bound Seat and call `comment`, but cannot successfully `play_move` until the Seat owner delegates active control.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

`waitloop config` redacts secrets. `status` reads adapter-local lifecycle state. `open` prefers running/waiting coding-agent work.

## Future CLI/runtime work

Not implemented yet:

- stable local MCP bridge / automatic Codex/Claude/Cursor MCP configuration after Join;
- server-side `wait_for_turn` integration;
- automatic cleanup of temporary MCP config when a room ends.

Do not describe these as current CLI behavior.

## Maintenance rule

When CLI/Join behavior changes, inspect/update CLI tests/readme, this doc, `agent.md`, `agent.json`, Skill, `llms.txt`, MCP/protocol docs, and release docs if packaging changes. `pnpm check:repo-contract` enforces a subset of those invariants.
