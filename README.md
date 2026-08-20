# Waitloop

**Tiny games while your coding agent runs.**

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is a developer-native waiting layer, not an engagement/casino product. Coding work always has priority.

## Agent entrypoints

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/api/v1/rooms
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

Room/Join HTTP is the control plane; MCP is room-scoped gameplay. Web is optional for Agent-only operation.

## CLI

```bash
npm install -g @waitloop/cli@alpha
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
waitloop join WL-XXXXXXXXXX
```

The CLI caches room Actor context/credential for reconnect; raw HTTP + MCP remains equally valid.

## Game identity

```text
Room       one active game runtime
Seat       stable game position (`seat-1`, `seat-2`, `seat-3`)
Actor      Human | Bot | Hosted Agent | Connected Agent
Binding    Actor -> Seat
Controller Actor currently allowed to play
Advisor    bound Actor that may inspect/comment but not play until delegated
```

Seat/Actor IDs are identifiers, not credentials.

Current modes:

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

`companion-agent` lets an Agent see/advise the Human Seat and optionally take delegated control. `agent-bots` is fully headless.

## Recovery / takeover

Human browsers receive a persistent anonymous Actor identity plus a separate secret credential; no account/database is required for one-Room recovery. If the shorter room viewer cookie is lost, the remembered Actor can recover room access while the Room is active.

Eligible Seats can explicitly use a temporary Bot Controller without changing Seat owner, hand, role, or history.

Connected Seat owners can:

```text
yield_to_bot()
... leave / reconnect with cached room credential ...
take_control()
```

Reconnect never silently steals control back. Casual elapsed time never forces takeover.

## MCP

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Game rules, hidden information, current Controller, and revision checks remain server-side.

## Safety baseline

Current runtime includes:

- 16 KiB JSON body limit;
- Cloudflare native room-creation rate limiting and tighter hosted-room limit;
- per-Room/per-Actor Join/MCP/comment/control/recovery limits;
- one-time ~20 minute Join codes;
- ~24 hour active Room lifetime;
- hashed credentials at rest;
- capability checks for Room/Seat mutations.

No global database/account layer is required yet. Cross-device identity/history can be added later if product needs justify a global index.

## Current implementation

Also included:

- canonical lifecycle states with Claude Code/Cursor/Codex adapters;
- scoped device pairing;
- deterministic bots + configurable hosted DeepSeek/OpenAI Seats;
- server-authoritative Dou Dizhu with random landlord until bidding is implemented;
- Human-safe browser projection, current trick/activity, companion comments, and presentation pacing;
- GitHub `main` -> Cloudflare auto deployment;
- strict CI and repository-contract synchronization.

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
