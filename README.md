# Waitloop

**Tiny games while your coding agent runs.**

Waitloop is a developer-native waiting layer for coding agents. It notices when an agent is working, gives short waits somewhere to go, and gets out of the way when work needs attention again.

```ts
while (agent.running) {
  waitloop();
}
```

Waitloop is intentionally not an engagement product. The goal is to make agent latency less awkward without turning the distraction into the primary activity.

## Public Agent entrypoints

Give an AI agent this stable guide:

```text
https://waitloop.run/agent.md
```

Related public surfaces:

```text
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

`agent.md` is the universal installation/integration guide. `agent.json` is the machine-readable capability manifest. `/join/<code>` is temporary room-specific onboarding. MCP is room/seat-scoped and is not lifecycle detection.

Repository-editing agents must follow [`AGENTS.md`](AGENTS.md), not the public product `agent.md`.

## CLI

Install the current public alpha channel with:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
```

Initialize/pair a local coding-agent environment:

```bash
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Join a connected-agent game seat:

```bash
waitloop join WL-XXXXXXXXXX
```

The exact current CLI version/capabilities are authoritative in `packages/cli/package.json` and `apps/web/public/agent.json`; stable docs intentionally avoid hard-coding alpha patch versions.

## Current product

The current implementation includes:

- canonical coding-agent lifecycle states and `AgentSession` Durable Objects;
- Claude Code, Cursor, and Codex lifecycle adapters;
- public browser device pairing and scoped lifecycle credentials;
- CLI install/pair/join/status/open flows;
- server-authoritative hidden-information game rooms;
- Dou Dizhu with tested legal move generation and current pre-bidding random landlord assignment;
- deterministic rule bots;
- hosted DeepSeek/OpenAI game seats when provider secrets are configured;
- connected-agent rooms through join code + MCP;
- `waitloop join <code>` and raw MCP as equal connection paths;
- connected-agent lobby that starts only after the MCP seat authenticates;
- human-safe browser game projection without exhaustive machine `legalMoves[]`;
- current trick, recent activity, authoritative turn, and soft connected-agent elapsed-time UI;
- automatic Cloudflare deployment from GitHub `main` plus CI Wrangler dry-run validation.

Current implementation state and known gaps are maintained in [`docs/status.md`](docs/status.md).

## Player model

```text
Player
├── Human
├── Bot
├── Hosted Agent
│   ├── DeepSeek
│   └── OpenAI
└── Connected Agent
    ├── Codex
    ├── Claude Code
    ├── Cursor
    └── other MCP-compatible agents
```

Current Dou Dizhu modes:

```text
you + 2 bots
you + configured hosted agent + bot
you + connected agent + bot
```

Connected-agent rooms have two first-class connection paths:

```text
waitloop join <code>
raw room-scoped MCP configuration
```

Casual tables may show elapsed thinking/waiting time, but they do not force a move because a casual timer expired.

## Product principles

- **Work comes first.** Waiting/completed/failed coding-agent state takes priority over a game.
- **Developer-native.** Quiet, keyboard-friendly, monospace-oriented, low-chrome UI.
- **Minimal lifecycle data.** No prompt/source/tool/transcript content is required.
- **Server-authoritative games.** Rules, hidden information, turn order, and legality remain server-side.
- **One core, many adapters.** Vendor-specific lifecycle details stay outside the core protocol/runtime.
- **MCP is participation, not lifecycle detection.** Hooks report work state; MCP controls one temporary game seat.

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
```

Repository layout:

```text
waitloop/
├── apps/web/
├── packages/
│   ├── cli/
│   ├── protocol/
│   ├── game-core/
│   └── doudizhu/
├── worker/
├── integrations/
├── docs/
├── AGENTS.md
└── wrangler.jsonc
```

See [`docs/architecture.md`](docs/architecture.md) for responsibility/trust boundaries.

## Documentation

Start with [`docs/README.md`](docs/README.md). It defines:

- which document is canonical for each subsystem;
- how temporary design notes are handled;
- how docs/public Agent surfaces must stay synchronized with code;
- what a new coding agent should read first.

`main` documentation describes current durable truth, not implementation chronology.

## Local development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm check:repo-contract
pnpm check:cli-package
pnpm dev
```

CI additionally validates browser JavaScript and runs a Wrangler deployment dry-run.

Production secrets must never be committed to the repository.

## Domain

**https://waitloop.run**

## License

MIT. See [`LICENSE`](LICENSE).
