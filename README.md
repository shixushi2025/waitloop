# Waitloop

**Tiny games while your coding agent runs.**

Waitloop is a developer-native waiting layer for coding agents. It notices when an agent is working, gives you a small distraction while you wait, and gets out of the way the moment the agent needs your attention again.

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is intentionally not an arcade, social game platform, or engagement product. The product goal is the opposite: make short periods of agent latency less awkward without stealing attention from the work.

## Current alpha

The repository now contains the first end-to-end building blocks rather than only a product mockup:

- canonical coding-agent lifecycle events and an `AgentSession` Durable Object
- a Claude Code lifecycle adapter that reports only minimal status metadata
- generic game room contracts with revision/stale-move protection
- a tested Dou Dizhu rules engine and legal-move generator
- a `GameRoom` Durable Object with viewer-specific hidden-information projections
- a restrained web alpha for `you + 2 bots` and `you + agent + bot`
- a seat-scoped MCP boundary with only `get_turn` and `play_move`

The alpha game entry is `/game.html` when the Worker is running locally or deployed.

Implementation status and known gaps are tracked in [`docs/status.md`](docs/status.md). Do not treat the current alpha authentication model as production-ready.

## Product principles

- **Work comes first.** A completed or blocked agent task immediately takes priority over a game.
- **Developer-native.** The UI should feel at home beside a terminal or editor: quiet, keyboard-first, monospace-first, and low-chrome.
- **Minimal lifecycle data.** Source code, prompts, file contents, tool arguments, terminal output, and repository data are not required for the core waiting experience.
- **One core, many adapters.** Codex, Claude Code, Cursor, DSH, and future agents map into a small Waitloop event protocol instead of leaking platform-specific semantics into the core.
- **Games are plugins.** The runtime is game-agnostic; Dou Dizhu is the first game implementation.
- **MCP is for agent participation, not lifecycle detection.** Hooks/adapters report agent state. MCP lets an authorized agent occupy and play one game seat.

## First end-to-end target

```text
coding agent starts work
        ↓
Waitloop receives `agent.running`
        ↓
after a short delay, the waiting UI becomes available
        ↓
user starts a small game
        ↓
agent reports `agent.completed` or `agent.waiting`
        ↓
Waitloop pauses the game and returns attention to work
```

The first multiplayer target is:

```text
You  vs  Agent  vs  Bot
        Dou Dizhu
```

## Architecture

Waitloop targets one Cloudflare Worker deployment with static assets and two Durable Object authorities:

```text
                         waitloop.run
                              │
                     Cloudflare Worker
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
       static web          HTTP API          remote MCP
            │                 │                 │
            └──────────┬──────┴──────┬──────────┘
                       │             │
                AgentSession DO   GameRoom DO
                       │             │
                   WebSocket      WebSocket
```

The repository is a TypeScript monorepo and deliberately keeps framework/dependency surface small.

```text
waitloop/
├── apps/
│   └── web/                  # waitloop.run UI
├── packages/
│   ├── protocol/             # canonical agent lifecycle contracts
│   ├── game-core/            # game-agnostic contracts
│   └── doudizhu/             # Dou Dizhu rules/state machine
├── worker/                   # Worker routes + Durable Objects + MCP
├── integrations/
│   └── claude-code/          # first lifecycle adapter
├── docs/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── wrangler.jsonc
```

## Documentation

- [`docs/product.md`](docs/product.md) — product definition, user journey, non-goals
- [`docs/architecture.md`](docs/architecture.md) — runtime boundaries and data flow
- [`docs/protocol.md`](docs/protocol.md) — lifecycle and game wire contracts
- [`docs/security.md`](docs/security.md) — privacy/auth/security invariants
- [`docs/game-system.md`](docs/game-system.md) — generic game architecture
- [`docs/doudizhu-rules.md`](docs/doudizhu-rules.md) — exact current rule profile
- [`docs/mcp.md`](docs/mcp.md) — seat-scoped MCP model and tool boundary
- [`docs/design.md`](docs/design.md) — visual/interaction language
- [`docs/roadmap.md`](docs/roadmap.md) — implementation sequence and acceptance criteria
- [`docs/status.md`](docs/status.md) — what is actually implemented now

## Development sequence

Implementation follows dependency order rather than surface area:

1. product/protocol/security contract
2. workspace and canonical agent events
3. AgentSession runtime and real lifecycle adapter
4. generic game contracts
5. Dou Dizhu rules/state machine
6. GameRoom runtime and web alpha
7. seat-scoped MCP participation
8. installer/pairing UX
9. Cursor, Codex, and DSH adapters
10. additional games and later Agent Arena experiments

## Local development

The intended workflow is:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

The Worker is configured from `wrangler.jsonc`. Production secrets must not be committed to the repository.

The repository includes a CI workflow for typecheck/tests. Until an actual clean CI run is observed for the complete current dependency graph, treat compile/test status as pending validation rather than assumed green.

## Domain

The primary product domain is **waitloop.run**.

## License

MIT. See [`LICENSE`](LICENSE).
