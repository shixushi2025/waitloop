---
name: waitloop
description: Integrate Waitloop with coding-agent lifecycle hooks and safely create, join, advise, control, yield, and recover a room-scoped Waitloop game actor.
---

# Waitloop

Use this skill when the user asks to install, configure, diagnose, open, pair, create, join, advise, comment on, play, yield, or resume through Waitloop.

Canonical guide: https://waitloop.run/agent.md
Machine manifest: https://waitloop.run/agent.json
Room API: https://waitloop.run/api/v1/rooms
Join pattern: https://waitloop.run/join/<join-code>
Game MCP: https://waitloop.run/mcp

If the harness cannot directly read the canonical Markdown URL, read the `guideMirrors` declared in `agent.json` instead of assuming Waitloop/Cloudflare is unavailable.

## Core model

```text
Seat       stable room-scoped game player position
Actor      human/bot/hosted/connected runtime identity
Controller Actor currently allowed to play a Seat
Advisor    Actor bound to a Seat that may inspect/comment but not play until delegated
```

Actor ID is not authorization. A secret credential proves the Actor capability.

Lifecycle hooks are separate and only report coding-work state.

## Install / initialize

Consult `https://waitloop.run/agent.json` first. During alpha, use the explicit dist-tag:

```bash
npm install -g @waitloop/cli@alpha
waitloop --version
waitloop doctor
```

`waitloop doctor` checks the published Waitloop CLI version and, when Codex is detected, its CLI version/hooks capability plus the installed Waitloop hook events. If it prints an update command, use that command before diagnosing older behavior.

Initialize/pair only when lifecycle integration is desired:

```bash
waitloop init --url https://waitloop.run
waitloop pair
```

Install only lifecycle adapters actually present. `waitloop install codex` installs the hook definition, but Codex still owns trust: command hooks do not run until the exact current definition is reviewed/trusted in Codex CLI `/hooks`.

A Codex Plugin may eventually make packaging/distribution nicer, but plugin-bundled command hooks use the same Codex trust flow. Do not claim that a Plugin removes hook review.

## Create or join without Web

Join:

```bash
waitloop join WL-7K4P9Q2MZX
waitloop join WL-7K4P9Q2MZX --json
```

Raw Join is available through `https://waitloop.run/join/<join-code>` or the Join API.

**Join is credential claim/cache, not MCP attachment.** Do not report the Agent as connected merely because `waitloop join` succeeded. The room considers the Actor connected only after an authenticated request reaches `/mcp`.

If the current harness session cannot hot-add a newly claimed MCP server, use its supported MCP config/reload path or use raw MCP HTTP for the current task. Keep the cached bearer token out of model-visible output/logs whenever possible.

Create a fully headless Agent-vs-bots room:

```http
POST https://waitloop.run/api/v1/rooms
Content-Type: application/json

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

The HTTP Room API is the current control plane. The room-scoped MCP endpoint is the gameplay plane. Do not require the browser and do not invent Room-creation tools on the current MCP server.

New Dou Dizhu rooms expose stable room-scoped Seat IDs such as `seat-1`, `seat-2`, and `seat-3`.

A Join code is one-time and short-lived (currently about 20 minutes). The claimed room Actor credential can reconnect while the room remains active (currently about 24 hours).

## MCP tools

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

Transport:

```text
Authorization: Bearer <wlseat_...>
X-Waitloop-Room: <room-id>
```

### Normal play

1. Call `get_turn()`.
2. Read `actorId`, `viewerSeatId`, relation, capabilities, Controller, and legal moves.
3. Only call `play_move` when `seat:play` is present.
4. Use a server-generated move ID and the exact revision.
5. On stale state, call `get_turn()` again.

### Continuous play semantics

MCP does not wake an Agent after the Agent has sent its final answer.

- If the user asks only to **connect/verify**, one authenticated `get_turn()` is enough.
- If the user asks to **take over / keep playing / play until finished**, keep the current Agent run active until that stopping condition is met.
- Current alpha has no `wait_for_turn()`. If another Human/connected Actor owns the turn, wait briefly and poll `get_turn()` at a low frequency rather than tight-looping.

Do not return a final response after connection if the user explicitly asked for continuous play.

### Advisor

An Advisor may see the private state/legal options of the single Seat it is explicitly bound to and may use `comment(text)`. It cannot play until the Seat owner delegates control.

### Step away / reconnect

For an Actor that owns and controls its Seat:

```text
yield_to_bot()
```

creates a temporary deterministic Bot Controller while preserving the Seat ID, owner, hand, role, and game history.

The CLI caches the room credential under `~/.waitloop/joins`. Reconnect using that same room credential. Reconnection itself does not steal control back.

When ready:

```text
take_control()
```

explicitly restores the Seat owner and removes the temporary Bot controller.

Never infer that elapsed time alone authorizes `yield_to_bot`; Casual fallback is explicit.

## Human browser recovery

Human Web users may receive a persistent anonymous Actor identity in an HttpOnly cookie. Actor ID and credential are separate. If the shorter room-view cookie disappears, the remembered Actor credential can recover room access during the room lifetime.

This is browser/device-local anonymous identity, not an account or cross-device profile.

## Security / privacy

- Never use Actor ID or Seat ID as a credential.
- Never place room Actor credentials in URLs, prompts, source, commits, Skill files, or logs.
- Keep lifecycle credentials separate from room credentials.
- Respect `room:manage`, `seat:control`, and `seat:play` capabilities.
- Waitloop currently applies request body limits, room-creation/hosted-room rate limits, per-room Actor rate limits, short Join expiry, and room expiry.
- Rate limiting is abuse protection, not accounting.

Lifecycle reporting must not include prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

## Diagnostics

```bash
waitloop doctor
waitloop status
waitloop config
waitloop open --print
```

Treat `agent.md` and `agent.json` as the public product contract. CLI, HTTP, Join URL, Skill, and MCP overlap by design; business rules and authorization remain server-side.
