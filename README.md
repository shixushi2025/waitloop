# Waitloop

**Tiny games while your coding agent runs.**

Waitloop is a developer-native waiting layer for coding agents. It notices when an agent is working, gives short waits somewhere to go, and gets out of the way when work needs attention again.

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is intentionally not an engagement product. The goal is to make agent latency less awkward without turning the distraction into the primary activity.

## Current alpha

The repository now contains an end-to-end Cloudflare implementation:

- canonical coding-agent lifecycle events and `AgentSession` Durable Objects
- lifecycle adapters for Claude Code, Cursor, and Codex
- CLI install/pair/status/open flows
- short-lived browser device pairing and scoped device credentials
- a tested Dou Dizhu rules engine and legal-move generator
- server-authoritative `GameRoom` Durable Objects with hidden-information projection
- public browser rooms protected by room-scoped HttpOnly credentials
- four participant types: Human, Bot, Hosted Agent, Connected Agent
- server-hosted DeepSeek and OpenAI game agents when provider secrets are configured
- MCP-connected game seats with only `get_turn` and `play_move`
- CI validation including TypeScript, Vitest, frozen installs, and `wrangler deploy --dry-run`

The game entry is `/game.html` when the Worker is running locally or deployed.

## Player types

```text
Player
├── Human
├── Bot
├── Hosted Agent
│   ├── DeepSeek
│   └── GPT / OpenAI
└── Connected Agent
    ├── Codex
    ├── Claude Code
    ├── Cursor
    └── other MCP-compatible agents
```

Current Dou Dizhu modes are:

```text
you + 2 bots
you + DeepSeek + bot       # when configured
you + GPT + bot            # when configured
you + connected agent + bot
```

Bots are simple deterministic server players and never call a model. Hosted agents call a model from the Worker using only that seat's visible game state. Connected agents control one seat through a room-scoped MCP capability.

## Product principles

- **Work comes first.** A completed or blocked coding-agent task takes priority over a game.
- **Developer-native.** The UI should feel at home beside a terminal or editor: quiet, keyboard-first, monospace-first, and low-chrome.
- **Minimal lifecycle data.** Source code, prompts, file contents, tool arguments, terminal output, and repository data are not required for the waiting experience.
- **Server-authoritative games.** Models and external agents select legal move IDs; the game server owns rules, state, and hidden information.
- **One core, many adapters.** Codex, Claude Code, Cursor, DSH, and future agents map into a small Waitloop lifecycle protocol.
- **MCP is for participation, not lifecycle detection.** Hooks/adapters report coding-agent state. MCP lets a connected agent occupy and play one game seat.

## Core waiting loop

```text
coding agent starts work
        ↓
Waitloop receives running state
        ↓
user opens a game
        ↓
user plays against bots / hosted AI / connected agent
        ↓
coding agent completes or needs attention
        ↓
Waitloop pauses the game
        ↓
user returns to work
```

## Architecture

```text
                         waitloop.run
                              │
                     Cloudflare Worker
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   static web              HTTP API             remote MCP
                              │
        ┌─────────────────────┼──────────────────────────────┐
        │                     │                 │            │
 AgentSession DO       DeviceRegistry DO   PairingRequest DO GameRoom DO
        │                                                   │
    WebSocket                                          WebSocket
                                                          │
                                               Bot / Hosted Agent / MCP
```

The repository is a TypeScript monorepo with a deliberately small framework/dependency surface.

```text
waitloop/
├── apps/
│   └── web/
├── packages/
│   ├── cli/
│   ├── protocol/
│   ├── game-core/
│   └── doudizhu/
├── worker/
├── integrations/
│   └── claude-code/
├── docs/
├── AGENTS.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── wrangler.jsonc
```

## Hosted agents

Hosted providers are enabled only when their Worker secrets exist:

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
```

Optional model overrides:

```text
WAITLOOP_DEEPSEEK_MODEL
WAITLOOP_OPENAI_MODEL
WAITLOOP_HOSTED_AGENT_TIMEOUT_MS
```

See [`docs/hosted-agents.md`](docs/hosted-agents.md) for the provider, privacy, fallback, and usage-accounting design.

## Documentation

- [`docs/product.md`](docs/product.md) — product definition, user journey, non-goals
- [`docs/architecture.md`](docs/architecture.md) — runtime boundaries and data flow
- [`docs/protocol.md`](docs/protocol.md) — lifecycle and game wire contracts
- [`docs/security.md`](docs/security.md) — privacy/auth/security invariants
- [`docs/game-system.md`](docs/game-system.md) — generic game architecture
- [`docs/doudizhu-rules.md`](docs/doudizhu-rules.md) — exact current rule profile
- [`docs/mcp.md`](docs/mcp.md) — seat-scoped MCP model and tool boundary
- [`docs/hosted-agents.md`](docs/hosted-agents.md) — model-backed game players
- [`docs/pairing.md`](docs/pairing.md) — device pairing and scoped credentials
- [`docs/design.md`](docs/design.md) — visual/interaction language
- [`docs/roadmap.md`](docs/roadmap.md) — implementation sequence and acceptance criteria
- [`docs/status.md`](docs/status.md) — what is actually implemented now

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

The Worker is configured from `wrangler.jsonc`. Production secrets must never be committed to the repository.

CI runs the same dependency/type/test checks and additionally executes a Wrangler deployment dry-run so Worker configuration and Durable Object exports are validated before Cloudflare deployment.

## Domain

The primary product domain is **waitloop.run**.

## License

MIT. See [`LICENSE`](LICENSE).
