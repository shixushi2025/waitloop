# Waitloop

**Tiny games while your coding agent runs.**

Waitloop is a developer-native waiting layer for coding agents. It gives short waits somewhere to go, then gets out of the way as soon as coding work needs attention.

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is not an engagement/casino product.

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

`agent.md` is the stable guide; `agent.json` is machine-readable capability truth; Room/Join HTTP is the control plane; MCP is room-scoped gameplay. Web is optional for Agent-only operation.

Repository-editing agents must follow [`AGENTS.md`](AGENTS.md) and [`docs/README.md`](docs/README.md).

## CLI

```bash
npm install -g @waitloop/cli@alpha
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Join an existing connected Actor capability:

```bash
waitloop join WL-XXXXXXXXXX
```

CLI is convenience, not a protocol requirement; Agents may use raw HTTP + MCP directly.

## Game model

Waitloop separates game identity from runtime control:

```text
Seat       actual player position / hand / role
Actor      Human | Bot | Hosted Agent | Connected Agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to play the Seat
Advisor    Actor allowed to inspect/comment on its bound Seat but not play until delegated
```

This enables three distinct Agent relationships without adding game-specific hacks:

```text
independent player
  Human Seat + Agent Seat + Bot Seat

companion
  Human owns Seat
  Agent advises same Seat
  Human may delegate/take back control

headless Agent
  Agent Seat + 2 bots
  HTTP + Join + MCP only, no browser
```

Current Dou Dizhu room modes:

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

The server owns rules, hidden information, Actor capabilities, current Controller, and revisions. Human/Agent clients do not duplicate game authorization.

## MCP

Current tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

An advisor sees only its explicitly bound Seat's private view. `play_move` is rejected until that Actor becomes active Controller. Comments are a side channel and never alter game revision, turn order, or legality.

## Current implementation

The repository includes:

- canonical coding-agent lifecycle state + `AgentSession` Durable Objects;
- Claude Code, Cursor, and Codex lifecycle adapters;
- scoped browser/device pairing;
- public CLI + npm Trusted Publishing/OIDC;
- server-authoritative Dou Dizhu engine/runtime;
- deterministic bots and configurable hosted DeepSeek/OpenAI seats;
- Actor/Seat/controller/advisor runtime model;
- Human-to-Agent Seat delegation and take-back;
- companion comments/advice;
- fully headless Agent + two-bot room creation;
- connected Actor Join codes and fixed room-scoped MCP endpoint;
- Human-safe browser projection without exhaustive machine legal moves;
- random landlord until full bidding is implemented;
- current trick/activity/presentation pacing and soft Agent elapsed timing;
- GitHub `main` -> Cloudflare automatic deployment;
- strict CI + repository-contract synchronization checks.

Current details/gaps: [`docs/status.md`](docs/status.md).

## Product principles

- **Work comes first.** Coding-agent waiting/completed/failed state outranks the game.
- **Developer-native.** Quiet, keyboard-friendly, low-chrome UI.
- **Minimal lifecycle data.** No prompt/source/tool/transcript content required.
- **Server-authoritative.** Rules, hidden information, revisions, and Actor capabilities remain server-side.
- **Client-neutral control plane.** Web, CLI, and Agent HTTP converge on the same room runtime.
- **MCP is participation, not lifecycle detection.** Lifecycle hooks report work; MCP interacts with one temporary room Actor.

## Architecture

```text
coding agents -> integrations -> lifecycle protocol -> AgentSession DO

Web / CLI / Agent HTTP -> Room + Join control plane -> GameRoom DO
Connected Agent       -> MCP gameplay plane -------> GameRoom DO
Hosted model          -> hosted runner ------------> GameRoom DO
Human Web             -> human room API -----------> GameRoom DO
```

See [`docs/architecture.md`](docs/architecture.md).

## Documentation

Start with [`docs/README.md`](docs/README.md). `main` documents current durable truth, not implementation chronology. Transitional design notes are removed after their durable decisions are extracted.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
pnpm dev
```

CI also validates browser JavaScript and Wrangler deployment bundling.

## Domain

**https://waitloop.run**

## License

MIT. See [`LICENSE`](LICENSE).
