# Waitloop

**Tiny games while your coding agent runs.**

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is a developer-native waiting layer, not an engagement/casino product. Coding work always has priority.

## Current priority

The focus is stabilizing the existing discovery -> install -> create/join -> wait/play -> yield/reconnect path, not continuously adding modes.

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

The bridge exposes:

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

It reuses the existing Room/Join HTTP control plane and remote Room MCP internally. Room credentials stay in private local cache and are not returned through model-visible tools.

CLI equivalents:

```bash
waitloop room create
waitloop join WL-XXXXXXXXXX
waitloop room current
waitloop room wait --timeout-ms 25000
waitloop room leave
```

Default Join output is credential-safe. `--raw-mcp` remains an explicit advanced fallback.

## Lifecycle integration

Lifecycle reporting is optional and separate from game MCP:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop install codex
```

`waitloop install codex`/`claude-code` also configure stable MCP. Codex lifecycle command hooks remain subject to Codex's own `/hooks` review/trust boundary. Plugin packaging cannot bypass that trust requirement.

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

`agent-bots` is fully headless; local `create_room()` uses that existing mode.

## Efficient play and recovery

Remote/local MCP provide `wait_for_turn()`. It returns on turn, finish, lobby, pause, Controller change, or a bounded transport timeout. Timeout never auto-passes or replaces a Casual Agent.

MCP is request/response participation and cannot wake an Agent after a final reply. A request to play until finished must keep the current Agent run active through:

```text
wait_for_turn()
-> play_move()
-> wait_for_turn()
-> ...
-> game_finished
```

Connected Seat owners can explicitly:

```text
yield_to_bot()
... bridge/harness restarts and reconnects ...
take_control()
```

Seat owner, ID, hand, role, and history remain unchanged. Reconnect never silently steals control.

## Safety baseline

- 16 KiB JSON body limit;
- Cloudflare Room-create and tighter Hosted Room-create limits;
- per-Room/per-Actor Join/MCP/comment/control/recovery limits;
- one-time ~20 minute Join codes;
- ~24 hour active Rooms;
- hashed server credentials;
- local MCP credential custody;
- capability/revision checks for every mutation;
- hidden-information projections and negative tests.

No database/account layer is required for current one-Room recovery.

## Current implementation

Also included:

- Claude Code/Cursor/Codex lifecycle adapters;
- deterministic Bots + configurable Hosted Agent Seats;
- server-authoritative Dou Dizhu with random landlord until bidding is implemented;
- companion advice/comments and Human/Agent Controller switching;
- browser Room recovery and temporary Bot fallback;
- GitHub `main` -> Cloudflare auto deployment;
- strict CI plus repository/onboarding contracts.

See [`docs/status.md`](docs/status.md), [`docs/architecture.md`](docs/architecture.md), and [`docs/README.md`](docs/README.md).

Repository-editing Agents must follow [`AGENTS.md`](AGENTS.md).

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
pnpm dev
```

## Domain

**https://waitloop.run**

## License

MIT.
