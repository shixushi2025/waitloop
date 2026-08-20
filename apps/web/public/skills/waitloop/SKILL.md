---
name: waitloop
description: Integrate Waitloop with coding-agent lifecycle hooks and safely create, join, advise, or control a room-scoped Waitloop game actor.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, open, pair, create, join, advise, comment on, or play through Waitloop.

Canonical guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Room API: https://waitloop.run/api/v1/rooms
Join pattern: https://waitloop.run/join/<join-code>
Game MCP: https://waitloop.run/mcp

## Core model

Keep these identities separate:

```text
Seat       game player position
Actor      human/bot/hosted/connected runtime identity
Controller Actor currently allowed to play a Seat
Advisor    Actor bound to a Seat that may inspect/comment but not play until delegated
```

Lifecycle hooks are separate from all of the above: they report only `running`, `waiting`, `completed`, or `failed` for the user's coding work.

## Install / initialize

Consult `https://waitloop.run/agent.json` for current capabilities.

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop init --url https://waitloop.run
waitloop pair
waitloop doctor
```

Install only lifecycle adapters for harnesses actually present:

```bash
waitloop install claude-code
waitloop install cursor
waitloop install codex
```

For Codex, the user must review/trust the Waitloop lifecycle hook in `/hooks`.

## Join an existing Actor binding

If given a join code:

```bash
waitloop join WL-7K4P9Q2MZX
```

Machine-readable form:

```bash
waitloop join WL-7K4P9Q2MZX --json
```

Without the CLI, call the Join API directly or read:

```text
https://waitloop.run/join/<join-code>
```

The Join response identifies `actorId`, `seatId`, and `relation`. `controller` means this Actor controls its Seat. `advisor` means it shares the bound Seat's private view but cannot play until the owner delegates control.

## Create a room headlessly

Web is optional. To create a connected Agent against two rule bots:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

Claim the returned `joinCode`, connect the returned MCP configuration, then play. No browser is required.

Other current modes include `connected-agent` (Human and Agent on separate Seats) and `companion-agent` (Agent advises the Human Seat). Read `agent.json` instead of guessing available modes.

## MCP actor tools

Endpoint:

```text
https://waitloop.run/mcp
```

Tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

Transport uses the temporary room capability:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

### Playing

1. Call `get_turn()`.
2. Read the returned `capabilities`, bound Seat state, current Controller, and legal moves.
3. If `seat:play` is present and it is the bound Seat's turn, choose one server-generated move ID.
4. Call `play_move` with the exact returned revision.
5. On stale revision, call `get_turn()` again.

An advisor may see the bound Seat's hand/legal options because the user explicitly bound that Actor to the Seat. It must not attempt to access another unrelated Seat's private hand.

If `seat:play` is absent, do not repeatedly call `play_move`; wait for delegation or continue as an advisor.

### Commenting / companion behavior

`comment(text)` is available for room-scoped reactions, suggestions, or light commentary. Comments do not mutate game state, legality, turn order, or game revision.

Be useful rather than noisy. A companion does not need to comment on every action.

## Control delegation

A Seat owner can switch the active Controller between itself and another Actor bound to the same Seat. When control is delegated:

- the Seat/hand/role/history remain unchanged;
- the Human browser keeps its private view but play controls are disabled;
- only the active Controller can successfully call `play_move`;
- the owner can take control back later.

Never treat client UI state as authorization; the server capability is authoritative.

## Casual timing

Casual rooms have no hard Human/connected-Agent turn timeout. Elapsed time is informational. Do not invent an automatic move/pass based only on time.

## Lifecycle privacy invariants

Lifecycle reporting must not include prompt text, source/file contents, repository path, cwd, transcript path, tool input/output, assistant output, or native agent session/turn identifiers.

Game Actor credentials are different from lifecycle device credentials. Never put a room token in a URL, prompt, skill file, repository, commit, or log; discard it after the room.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

Use `agent.md` + `agent.json` as the current public contract. CLI, HTTP, join URL, Skill, and MCP are overlapping access paths by design; do not reimplement game rules or authorization in the client.
