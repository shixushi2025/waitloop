# Waitloop

**Tiny games while your coding agent runs.**

Waitloop is a developer-native waiting layer for coding agents. It notices when an agent is working, gives you a small distraction while you wait, and gets out of the way the moment the agent needs your attention again.

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is intentionally not an arcade, social game platform, or engagement product. The product goal is the opposite: make short periods of agent latency less awkward without stealing attention from the work.

## Product principles

- **Work comes first.** A completed or blocked agent task immediately takes priority over a game.
- **Developer-native.** The UI should feel at home beside a terminal or editor: quiet, keyboard-first, monospace-first, and low-chrome.
- **Local-first events.** Agent integrations should send the minimum state necessary. Source code, prompts, file contents, and repository data are not required for the core waiting experience.
- **One core, many adapters.** Codex, Claude Code, Cursor, DSH, and future agents map into a small Waitloop event protocol instead of leaking platform-specific semantics into the core.
- **Games are plugins.** The first game is Dou Dizhu; the core must not depend on card-game-specific rules.
- **MCP is for agent participation, not lifecycle detection.** Hooks/adapters report agent state. MCP lets an agent join and play a game.

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

The first multiplayer demonstration will be:

```text
You  vs  Agent  vs  Bot
        Dou Dizhu
```

## Architecture

Waitloop is designed for Cloudflare Workers and Durable Objects:

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

The repository is a TypeScript monorepo. The initial packages are deliberately small and framework-light.

```text
waitloop/
├── apps/
│   └── web/                  # waitloop.run UI
├── packages/
│   ├── protocol/             # canonical agent/game wire types
│   ├── game-core/            # generic game contracts
│   └── doudizhu/             # Dou Dizhu engine
├── worker/                   # Worker routes + Durable Objects + MCP boundary
├── integrations/             # platform adapters
├── docs/
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
└── wrangler.jsonc
```

## Development sequence

The project is implemented in dependency order rather than by surface area:

1. Product and protocol documentation
2. Workspace and shared TypeScript configuration
3. Canonical agent event protocol
4. Generic game contracts
5. Worker API and `AgentSession` Durable Object
6. Minimal web waiting UI
7. Dou Dizhu rules engine with tests
8. `GameRoom` Durable Object
9. MCP game tools
10. Claude Code adapter
11. Cursor adapter
12. Codex adapter
13. DSH adapter
14. Agent-vs-agent / arena experiments

See [`docs/roadmap.md`](docs/roadmap.md) for acceptance criteria.

## Local development

The intended workflow is:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

The Cloudflare worker is configured from `wrangler.jsonc`. No production secrets should be committed to the repository.

## Domain

The primary product domain is **waitloop.run**.

## License

MIT. See [`LICENSE`](LICENSE).
