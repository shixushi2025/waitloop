# Product

## Problem

Coding agents increasingly spend noticeable time running tools, editing files, executing tests, waiting on subprocesses, or completing remote work. During that interval the user is neither fully occupied nor truly free: attention remains anchored to the task because the agent may finish or ask for input at any moment.

Existing entertainment products optimize for retention. Waitloop optimizes for interruption.

The product should make a short wait feel intentional, then stop immediately when work becomes actionable again.

## Product statement

**Waitloop is a tiny waiting layer for coding agents.**

```ts
while (agent.running) {
  waitloop();
}
```

The core experience has three modes:

1. **Waiting** — the user plays while an agent is busy.
2. **Play** — a user and one or more agents participate in the same game.
3. **Arena** — agents play each other for experiments and evaluation.

Only Waiting is required for the first release. Play is the first differentiator. Arena is intentionally later.

## Non-goals

Waitloop is not trying to become:

- a general-purpose game distribution platform
- a casino or monetized card-game product
- a social network
- an attention/engagement optimizer
- a replacement for coding-agent UIs
- a telemetry collector for source code or prompts
- an agent orchestration framework

## First user journey

1. User installs a Waitloop integration for a supported coding agent.
2. The adapter observes a lifecycle event and maps it to the Waitloop protocol.
3. Waitloop shows `running` with elapsed time.
4. After a configurable grace period, a game can be entered.
5. The game is keyboard-first and designed for short sessions.
6. When the agent completes, fails, or requires user input, the game is paused.
7. The work state is shown above the game and becomes the primary action.
8. The user returns to the agent.

## Attention policy

The following states interrupt a game immediately:

- `agent.waiting`: user input or approval is likely needed
- `agent.completed`: work is ready to inspect
- `agent.failed`: work failed and may need intervention

`agent.running` never steals focus by itself.

A game may continue in the background after interruption, but the UI must not hide or defer the work notification.

## First game

Dou Dizhu is the first multiplayer game because it exercises useful architectural constraints:

- hidden information
- turn order
- deterministic legality checks
- non-trivial strategic decisions
- agent participation via MCP
- a culturally recognizable game for Chinese users

The first practical table is:

```text
human + coding agent + deterministic/simple bot
```

This avoids requiring three simultaneously connected human/agent clients while still proving multiplayer state, hidden information, and MCP moves.

## Experience language

Waitloop should look like a developer utility, not an arcade cabinet.

Preferred vocabulary:

- session
- status
- elapsed
- room
- move
- return
- resume

Avoid:

- coins
- streaks
- XP
- loot
- daily rewards
- flashy victory effects
- autoplaying sound

## Success criteria for v0.1

A v0.1 demonstration is successful when all of the following happen in one flow:

1. A real supported coding agent begins work.
2. Waitloop reflects the running state without receiving source code or prompt content.
3. The user can open a small game.
4. The agent completion/waiting event reaches Waitloop in real time.
5. The game pauses and the UI clearly returns attention to work.
6. At least one agent can participate in Dou Dizhu through constrained game tools.

Anything beyond those six points is secondary for v0.1.
