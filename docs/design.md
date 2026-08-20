# Design language

Waitloop should feel like a developer utility that happens to contain small games, not a gaming portal/casino/retention product.

## Principles

- monospace-first where useful;
- quiet neutral surfaces;
- hierarchy through spacing/typography;
- keyboard-first, pointer/touch usable;
- motion only to communicate state/history;
- no autoplay sound/reward mechanics;
- coding-agent attention outranks game UI.

## Seat and Actor language

Never imply that a Seat changed identity because control changed.

```text
Seat       stable player position
Actor      human/bot/agent identity
Controller current Actor allowed to play
Advisor    bound Actor allowed to inspect/comment
```

New Dou Dizhu Seats are room-scoped `seat-1/2/3`, but Human UI should normally show meaningful labels (`you`, `bot`, `agent`) rather than raw IDs except in diagnostics.

Player rows show stable Seat separately from Controller/runtime status:

```text
players/
  you      FARMER      11 cards    CONTROL · you
> agent    LANDLORD     8 cards    TURN · Codex · 18s
  bot      FARMER      13 cards    READY
```

## Control delegation

For a Human Seat with an Advisor:

```text
control/
you control this seat · Codex advises
[me] [agent]
```

After delegation the row remains the Human Seat. Human may still see its hand, but play/pass/hint disable because server `seat:play` is absent.

Delegation and take-back are always explicit.

## Temporary Bot fallback

Fallback is a Controller state, not a replacement player identity.

```text
players/
  agent seat   FARMER   9 cards   BOT TAKEOVER   [restore agent]
```

or:

```text
[replace with bot]
[let bot play]
[restore owner]
```

Rules for UX:

- never auto-trigger fallback because a Casual timer elapsed;
- label it `temporary bot`/`bot takeover`, not as if the original Seat vanished;
- preserve the original Seat label/role/card count;
- restore action is explicit;
- a connected-Agent owner restore button remains disabled until that owner reconnects;
- reconnect alone must not visually imply control has already returned;
- work-attention UI still outranks fallback controls.

## Companion comments

Comments live in a separate `companion/` section, not `activity/`. Comments are visually secondary and should not encourage noise after every move.

## Connected Actor lobby

Before first authenticated MCP request:

```text
waiting_for_players

connected_actor_lobby/
$ waitloop join WL-XXXXXXXXXX
join URL
raw MCP configuration
```

The lobby may show Actor relation/Seat ID for diagnostics. It must not expose dealt cards/landlord before start.

## Room recovery messaging

Browser recovery from the persistent anonymous Actor credential should be quiet and automatic. Do not make the user understand cookies/credentials to reopen their active Room.

When recovery is impossible, distinguish:

```text
room expired
room unavailable / this browser is not the owning Actor
```

Never display the anonymous Actor secret credential.

Join pages may display Join/Room expiry, `actorId`, `seatId`, and relation because these are identifiers/context, not credentials.

## Game presentation

Keep separate:

```text
authoritative TURN
current trick
activity (game history)
companion comments
Controller/runtime status
presentation replay
```

Worker/game logic never sleeps for visual effect; browser can replay authoritative history deltas. Respect reduced motion.

## Timing language

Casual time is informational:

```text
Codex · TURN · 18s
Codex · TURN · 1m 14s · taking longer than usual
```

No aggressive countdown unless a future Arena policy actually enforces one.

## Headless use

Web is Human UI, not an Agent requirement. `agent.md`, Room HTTP API, Join, and MCP must fully describe Agent-only use.

## Responsive/accessibility

- stack player/control sections on narrow screens;
- fallback actions remain readable/touchable;
- never encode readiness/control only by color;
- preserve focus states, contrast, reduced motion;
- cards/actions remain touch-safe.

## Product mark

Prefer typographic marks such as `waitloop_`, `> waitloop`, or `waitloop()`.
