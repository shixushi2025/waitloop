# Current implementation status

This is the compact handoff snapshot of current durable truth.

## Deployment and validation

- Production: `https://waitloop.run`.
- Cloudflare Worker + Static Assets + Durable Objects.
- GitHub `main` auto-deploys through Cloudflare.
- CI validates TypeScript, Vitest, repository contract, CLI npm tarball/version, browser JS, Agent discovery, and Wrangler dry-run.

## Coding-agent lifecycle

```text
idle | running | waiting | completed | failed
```

Claude Code, Cursor, and Codex lifecycle adapters are available; DSH remains planned. Lifecycle reporting is fail-open and excludes prompt/source/repository/cwd/transcript/tool/assistant/native-session content.

For Codex, the CLI installer writes the Waitloop hook definition, while Codex retains authority over hook review/trust. `waitloop doctor` checks detected Codex CLI version, whether its hooks feature is available, and whether all four Waitloop lifecycle hook events are installed. It cannot bypass or silently grant Codex hook trust.

A Codex Plugin is not the current primary integration path. Plugin packaging can improve Skill/MCP/hook distribution, but plugin-bundled command hooks still require Codex's hook trust-review flow.

## Public Agent/CLI surfaces

```text
https://waitloop.run/agent.md
https://waitloop.run/agent.json
https://waitloop.run/llms.txt
https://waitloop.run/skills/waitloop/SKILL.md
https://waitloop.run/api/v1/rooms
https://waitloop.run/join/<join-code>
https://waitloop.run/mcp
```

`agent.json` also declares GitHub mirrors of `agent.md`. This is intentional because some Agent/browser sandboxes may block direct navigation to a Markdown URL even when ordinary HTTP fetch works. Agent discovery must not depend on one browser fetch path.

CLI alpha channel:

```bash
npm install -g @waitloop/cli@alpha
waitloop doctor
```

`doctor` compares the local Waitloop CLI version with the currently published version in the server machine manifest and prints the canonical update command when they differ.

CLI/HTTP/Join/Skill/MCP overlap as entry methods; business rules and authorization are shared server-side.

## Identity and game model

```text
Room       one runtime/game instance
Seat       stable room-scoped game position (seat-1/seat-2/seat-3)
Actor      human | bot | hosted-agent | connected-agent
Binding    Actor -> Seat relationship
Controller Actor currently allowed to mutate the Seat
Advisor    bound Actor that may inspect/comment but cannot play until delegated
```

Actor ID and Seat ID are identifiers, not credentials.

New browser rooms use a persistent anonymous Human Actor ID plus a separate secret `wla_...` credential in an HttpOnly cookie. The Actor credential is hashed into each Room. If the shorter room viewer cookie expires/disappears, the same browser Actor can recover viewer access during the Room lifetime. This is browser/device-local anonymous identity, not an account or cross-device identity system.

No database/D1 is used for this. Room-local actors, Seats, bindings, credentials, comments, fallback state, and game state remain in `GameRoom` Durable Object storage.

## Current Dou Dizhu modes

```text
bots
hosted-agent
connected-agent
companion-agent
agent-bots
```

- `connected-agent`: Human and Agent occupy separate Seats.
- `companion-agent`: Agent is Advisor of Human Seat and may comment/inspect private Seat state; it plays only after explicit delegation.
- `agent-bots`: connected Agent owns `seat-1` against two deterministic bots and can run fully headlessly.

Current pre-bidding landlord selection remains random among the three Seats. Full bidding/scoring is not implemented.

## Room / Join lifetime

- new Room lifetime: about 24 hours;
- Join code lifetime: about 20 minutes;
- Join code: one-time claim;
- claimed MCP Actor credential: reconnectable while the Room remains active;
- room credentials and anonymous Actor credentials are separate scopes.

Connected room start remains:

```text
room created
-> waiting_for_players
-> Join claimed
-> Actor connecting
-> first authenticated MCP request
-> Actor connected
-> playing
```

`waitloop join` performs only the Join claim/cache step. It does not hot-inject a newly claimed MCP server into an already-running Agent harness. Join success therefore must not be reported as "Agent connected" until an authenticated MCP request actually reaches `/mcp`.

Current modes still gate one joined connected Actor. The domain model can represent more, but generalized multi-connected-Actor readiness is not shipped yet.

## MCP gameplay and recovery

Current tools:

```text
get_turn()
play_move(expectedRevision, moveId)
comment(text)
yield_to_bot()
take_control()
```

`yield_to_bot()` lets a connected Seat owner explicitly hand the same Seat to a temporary deterministic Bot. Ownership, Seat ID, cards, role, and history remain unchanged.

The cached room credential can reconnect. Reconnect only restores Actor presence; it does **not** silently reclaim controller authority. The Seat owner explicitly calls `take_control()` when ready.

MCP is request/response participation and cannot wake an Agent after that Agent has returned a final answer. When the user explicitly requests continuous play, the Agent must keep its current run active until the requested stopping condition. Current alpha has no `wait_for_turn`, so waiting for another Human/connected Actor still requires low-frequency polling rather than a server-side wait primitive.

Casual timing remains soft: no automatic timeout-based pass or takeover.

## Human Web recovery / takeover

The Human Web UI can:

- delegate Human Seat to a connected companion and take it back;
- explicitly `let bot play` for an eligible Seat;
- as Room owner, `replace with bot` for another eligible Human/connected-Agent Seat;
- restore the original owner when it is available;
- keep the original Seat/hand/role/history unchanged during takeover;
- recover Room access from the persistent anonymous Actor credential when the room-view cookie is missing.

## Security currently implemented

- 16 KiB JSON request-body limit;
- Cloudflare native room-creation rate limit;
- tighter hosted-agent room-creation rate limit;
- per-Room/per-Actor Join, MCP read/move, comment, recovery, and controller-change limits;
- one-time short Join codes;
- bounded Room lifetime;
- hashed device/viewer/Actor/MCP credentials at rest in Room/registry state;
- server-side capabilities (`room:manage`, `seat:control`, `seat:play`) for mutations;
- hidden-information projection tests;
- stale/out-of-turn/non-controller rejection.

Rate limiting is abuse protection and intentionally not an accounting system.

## CLI quality checks

Current CLI/package validation includes:

- packaged `--version` matches `package.json`;
- stable docs do not hard-code an exact CLI release;
- expired Join cache entries are ignored/refreshed;
- nested help such as `waitloop install codex --help` is side-effect free and cannot create hook configuration;
- public Agent/CLI/MCP contracts remain synchronized through `pnpm check:repo-contract`.

## Known gaps

- full Dou Dizhu bidding / rob-landlord / scoring;
- automatic transport-level disconnect detection (current fallback is explicit; Agent can also explicitly `yield_to_bot()`);
- server-side `wait_for_turn`/long-poll to avoid Agent polling;
- stable local MCP bridge / automatic harness MCP installation after `waitloop join`;
- generalized multiple connected Actors / multiple Join capabilities per Room;
- arbitrary multiple advisors/spectators/commentators;
- cross-device/account identity and global Room history/indexing;
- hosted inference budgets/quotas beyond request-rate protection;
- broader rate limits for lifecycle/pairing and additional production CSP/CORS hardening;
- DSH lifecycle adapter;
- Arena/benchmark mode.

Forward priorities live in [`roadmap.md`](roadmap.md).
