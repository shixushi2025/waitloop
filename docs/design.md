# Design language

Waitloop should feel like a developer utility that happens to contain small games, not a gaming portal/casino/retention product.

## Principles

- monospace-first where useful;
- quiet neutral surfaces;
- hierarchy through spacing/typography;
- keyboard-first, pointer/touch usable;
- motion only to communicate state/history;
- no autoplay sound/reward mechanics;
- coding-agent attention outranks game UI;
- normal Agent paths should not expose transport credentials or implementation plumbing.

## Seat and Actor language

Never imply that a Seat changed identity because control changed.

```text
Seat       stable player position
Actor      human/bot/agent identity
Controller current Actor allowed to play
Advisor    bound Actor allowed to inspect/comment
```

Human UI normally shows `you`, `bot`, or Agent label rather than raw `seat-1/2/3`, except diagnostics.

```text
players/
  you      FARMER      11 cards    CONTROL · you
> agent    LANDLORD     8 cards    TURN · Codex · 18s
  bot      FARMER      13 cards    READY
```

## Agent connection hierarchy

Primary connected-Agent guidance should be simple:

```text
connect your agent/

recommended
$ waitloop join WL-XXXXXXXXXX

stable MCP
$ waitloop mcp install codex

advanced
show raw MCP configuration
```

With stable MCP installed, an Agent may call `join_room(code)` directly. Raw headers remain collapsed/advanced and must be labeled sensitive.

The lobby should distinguish:

```text
Join claimed / active locally
MCP authenticated / Agent connected
```

Do not show “connected” before the first authenticated gameplay request.

## Control delegation

For a Human Seat with Advisor:

```text
control/
you control this seat · Codex advises
[me] [agent]
```

After delegation the row remains the Human Seat. Human may see hand, but play/pass/hint disable because `seat:play` is absent. Delegation/take-back are explicit.

## Temporary Bot fallback

Fallback is Controller state, not replacement player identity.

```text
players/
  agent seat   FARMER   9 cards   BOT TAKEOVER   [restore agent]
```

Rules:

- never auto-trigger because Casual time elapsed;
- label temporary Bot/takeover clearly;
- preserve Seat label/role/card count;
- restore explicitly;
- connected-Agent restore disabled until owner reconnects;
- reconnect alone does not imply Controller returned;
- work attention outranks fallback controls.

## Efficient wait language

`wait_for_turn()` is invisible transport efficiency, not a visible competitive timer.

Human-facing UI may show elapsed status:

```text
Codex · TURN · 18s
Codex · TURN · 1m 14s · taking longer than usual
```

A 25-second MCP transport timeout should not appear as “Agent timed out” or “move expired”. The Agent simply waits again while its run remains active.

No aggressive countdown unless a future Arena policy enforces one.

## Continuous-play expectation

Agent-facing instructions distinguish:

```text
connect / verify
-> one snapshot may finish the request

play until finished
-> keep current Agent run active
-> wait_for_turn
-> play_move
-> repeat until game_finished
```

Do not imply that an ended Agent response continues in background.

## Companion comments

Comments live in separate `companion/`, not game `activity/`. They are visually secondary and should not encourage noise after every move.

## Connected Actor lobby

Before authenticated MCP:

```text
waiting_for_players

connected_actor_lobby/
$ waitloop join WL-XXXXXXXXXX
join URL
stable MCP guidance
advanced raw configuration
```

Lobby may show relation/Seat ID for diagnostics. It must not expose dealt cards/landlord before start.

## Room recovery messaging

Browser recovery from anonymous Actor credential should be quiet. Users should not need to understand cookies/credentials.

Distinguish:

```text
room expired
room unavailable / this browser is not the owning Actor
```

Never display anonymous Actor or cached MCP secret. Join pages may show Room/Join expiry, Actor ID, Seat ID, relation.

Local bridge `leave_room` messaging must be explicit:

```text
active room cleared locally
credential remains cached until room expiry
remote game unchanged
```

## Game presentation

Keep separate:

```text
authoritative TURN
current trick
activity
companion comments
Controller/runtime status
presentation replay
```

Worker/game logic never sleeps for visual effect; browser may replay authoritative history. Respect reduced motion.

## Headless use

Web is Human UI, not an Agent requirement. Primary headless path is stable local MCP/CLI. Raw Room HTTP + remote MCP remain advanced fallback.

## Responsive/accessibility

- stack player/control sections on narrow screens;
- fallback actions remain readable/touchable;
- never encode readiness/control only by color;
- preserve focus states, contrast, reduced motion;
- cards/actions remain touch-safe.

## Product mark

Prefer typographic marks such as `waitloop_`, `> waitloop`, or `waitloop()`.
