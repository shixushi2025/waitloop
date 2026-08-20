# Current implementation status

This is the compact handoff snapshot of the current system. It describes durable truth, not implementation history.

## Deployment

- Production: `https://waitloop.run`.
- Cloudflare Worker + Static Assets + Durable Objects.
- GitHub `main` auto-deploys through Cloudflare.
- CI independently validates Wrangler dry-run bundling.

## Coding-agent lifecycle

Canonical states:

```text
idle | running | waiting | completed | failed
```

Lifecycle adapters:

```text
Claude Code   available
Cursor        available
Codex         available
DSH           planned
```

Lifecycle reporting is fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

Runtime components include `AgentSession`, `DeviceRegistry`, `PairingRequest`, scoped `wldev_...` credentials, and explicit browser pairing.

## CLI and Agent discovery

Public CLI channel:

```bash
npm install -g @waitloop/cli@alpha
```

Important commands include `init`, `pair`, `join`, `install`, `status`, `open`, and `doctor`. Exact package version/capability metadata is authoritative in `packages/cli/package.json` and `apps/web/public/agent.json`.

Stable Agent surfaces:

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/api/v1/rooms
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

CLI, raw HTTP, Join URL, Skill, and MCP intentionally overlap as access methods; server runtime/rules are shared.

## Game identity model

The current runtime separates:

```text
Seat       actual player position/hand/role
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to play the Seat
Advisor    Actor allowed to inspect/comment on its bound Seat but not play until delegated
```

Only active Controller has `seat:play`. Seat owner retains `seat:control` and can delegate/take back control. Controller changes never change the Seat's hand, role, history, or ownership.

Legacy rooms where participant==player==seat are normalized into this model when read.

## Current Dou Dizhu room modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

Semantics:

- `bots`: Human + 2 deterministic bots.
- `hosted-agent`: Human + configured hosted model + bot.
- `connected-agent`: Human and connected Agent occupy separate Seats.
- `companion-agent`: Human + 2 bots; connected Agent is advisor of the Human Seat. It sees that Seat's private hand/legal options, may comment, and cannot play until delegated.
- `agent-bots`: connected Agent controls its own Seat against 2 bots; create/join/play can be fully headless with no Web UI.

Current pre-bidding setup randomly chooses the landlord from the three Seats. Full bidding/scoring is not implemented.

## Room and connected Actor lifecycle

```text
room created
  -> waiting_for_players
  -> Join code claimed
  -> connected Actor connecting
  -> first authenticated MCP request
  -> Actor connected
  -> playing
```

Join response identifies `actorId`, `seatId`, and relation (`controller` or `advisor`). Historical `wlseat_...` token prefix remains, but the credential now represents one room-scoped Actor binding.

The Web UI is a Human client, not a prerequisite. Headless Agents can call:

```http
POST /api/v1/rooms

{"version":1,"gameId":"doudizhu","mode":"agent-bots"}
```

then claim the returned Join code and use MCP.

## MCP gameplay

Current tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
```

- `get_turn` returns the private view of the Actor's explicitly bound Seat plus capabilities/runtime metadata.
- `play_move` succeeds only for the active Controller with a current revision and server-generated legal move.
- `comment` is a bounded side channel and does not change game state, turn, legality, or game revision.

An advisor receives `not_active_controller` until the Seat owner delegates control.

## Human Web experience

Current UI includes:

- stable Seat identity plus separate Controller/runtime status;
- authoritative TURN marker;
- current trick + recent game activity;
- companion comment section separate from game history;
- `control/ me | agent` for Human Seat delegation/take-back;
- Human private hand remains visible while delegated, but play/pass/hint controls disable;
- connected Actor lobby with CLI/Join URL/raw MCP paths;
- bot action presentation pacing without server sleeps;
- soft elapsed Agent timing with no forced casual timeout;
- coding-agent attention pause behavior.

## Hidden-information/security behavior

- browser Human does not receive exhaustive machine `legalMoves[]`;
- unrelated Seats' private hands are never exposed;
- an advisor sees only the private Seat it was explicitly bound to;
- lobby projection hides cards/landlord before connected readiness;
- stale/out-of-turn/non-controller moves are rejected;
- Human and Agent cannot simultaneously mutate the same Seat as active controllers.

## Hosted agents

Configured DeepSeek/OpenAI seats receive only their Seat projection/legal move IDs. Provider error/invalid output/infrastructure timeout falls back to deterministic legal play.

## Validation

CI validates:

```text
frozen pnpm install
root + CLI TypeScript
Vitest suite
repository contract / docs-Agent synchronization
CLI npm tarball + packaged --version
browser JavaScript syntax
Agent discovery files
Wrangler dry-run
```

## Known gaps

- full Dou Dizhu bidding / rob-landlord / scoring;
- connected Actor reconnect/disconnect and explicit replace-with-bot recovery;
- a server-side `wait_for_turn`/long-poll mechanism to avoid Agent polling;
- stable local MCP bridge / automatic harness MCP installation after `waitloop join`;
- generalized multi-connected-Actor all-ready gating beyond current single joined Actor modes;
- arbitrary multiple advisors/spectators/commentators and richer relation policy;
- room/credential cleanup beyond current Join expiry;
- rate limiting/abuse controls for public room creation, Join, MCP, pairing, lifecycle, comments, and hosted inference;
- hosted inference budgets/quotas;
- stronger production CSP/CORS/security hardening;
- DSH lifecycle adapter;
- Arena/benchmark mode.

Forward priorities live in [`roadmap.md`](roadmap.md).
