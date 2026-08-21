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

1. **Waiting** — the Human operates a small game while an Agent is busy, either in standalone Web or inside an MCP Apps-capable Agent client.
2. **Play** — a Human and one or more Agents participate in the same game with explicit Seat/Controller relationships.
3. **Arena** — Agents play each other for experiments and evaluation.

Waiting and a constrained Play path are implemented. Arena remains intentionally later.

## Human versus Agent operation

Starting a game from an Agent conversation must not automatically mean the Agent plays.

```text
open_game()
  Human owns seat-1
  Human clicks an embedded MCP App

create_room()
  Agent owns seat-1
  Agent plays through constrained MCP tools
```

This distinction is part of the product, not an implementation detail. The system should infer the entry from user intent:

```text
“I want to play”       -> open_game
“play a game for me”   -> create_room
```

If the active Host cannot render/operate MCP Apps, Waitloop should state that clearly and offer either a separate standalone Web game or Agent-owned play. It must not present a non-interactive JSON result as though the Human can click it.

## Non-goals

Waitloop is not trying to become:

- a general-purpose game distribution platform
- a casino or monetized card-game product
- a social network
- an attention/engagement optimizer
- a replacement for coding-agent UIs
- a telemetry collector for source code or prompts
- an Agent orchestration framework
- a browser-automation layer that makes Agents click Human UI
- a system that leaks Human/Agent credentials merely to transfer a Room between surfaces

## First user journeys

### Human waiting inside an Agent client

1. User installs Waitloop stable MCP in a compatible Host.
2. User asks to open a game they can operate.
3. Agent calls `open_game()`.
4. Host renders the linked `ui://` MCP App.
5. Human selects cards and uses play/pass/hint controls.
6. Human Room credentials remain in local bridge custody, not model/App source.
7. If work becomes actionable, lifecycle attention remains primary where integrated.
8. User returns to work without being trapped in an engagement loop.

### Agent participates or plays

1. User asks the Agent to join or play.
2. Agent calls `join_room(code)` or `create_room()`.
3. Agent uses `wait_for_turn`, legal move IDs, and exact revisions.
4. Agent keeps the current run active only when the requested stopping condition requires continued play.
5. Agent may explicitly yield to a temporary Bot and later reconnect/take control.

### Standalone Web

1. User opens the Web table.
2. User chooses bots, hosted Agent, connected Agent, or companion relationship.
3. Human uses the browser UI; connected Agents use MCP.
4. Work attention remains more important than game continuity.

## Attention policy

These lifecycle states interrupt a linked game immediately:

- `agent.waiting`: user input or approval is likely needed
- `agent.completed`: work is ready to inspect
- `agent.failed`: work failed and may need intervention

`agent.running` never steals focus by itself.

A game may remain recoverable after interruption, but UI must not hide or defer the work notification.

## First game

Dou Dizhu is first because it exercises:

- hidden information
- turn order
- deterministic legality checks
- non-trivial strategic decisions
- Human and Agent participation through different interfaces
- MCP Apps interaction and remote MCP Agent moves
- a culturally recognizable game for Chinese users

Current practical tables include:

```text
Human + two deterministic Bots          (Web / MCP App)
Human + connected Agent + Bot           (Web + MCP)
Human + Agent Advisor + two Bots         (Web + MCP)
Agent + two deterministic Bots          (headless MCP)
Human + Hosted Agent + Bot              (Web)
```

These avoid requiring three simultaneously connected Human/Agent clients while still proving multiplayer state, hidden information, and constrained actions.

## Experience language

Waitloop should look like a developer utility, not an arcade cabinet.

Preferred vocabulary:

- session
- status
- elapsed
- room
- seat
- controller
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

## Success criteria for the current alpha

A strong alpha flow demonstrates:

1. a real supported coding Agent begins work;
2. Waitloop reflects minimal lifecycle state without source/prompt content;
3. a Human can ask an Agent client to open an interactive table;
4. a compatible Host renders the MCP App and forwards Human actions securely;
5. an incompatible Host reports the limitation and a truthful fallback;
6. at least one connected Agent can participate through constrained Room MCP;
7. an Agent can play headlessly through `create_room -> wait_for_turn -> play_move`;
8. lifecycle attention can pause/interrupt the standalone experience;
9. credentials/capabilities remain separated and non-model-visible;
10. the entire path is packaged, installable, testable, and recoverable.

Feature breadth beyond this is secondary until these paths are reliable in real Hosts.
