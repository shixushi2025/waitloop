# Design language

Waitloop should feel like a developer utility that happens to contain small games. It should not look like a gaming portal, casino, or retention-oriented entertainment product.

## Principles

- monospace-first where it improves information density;
- quiet neutral surfaces;
- hierarchy through spacing/typography rather than decoration;
- keyboard-first while remaining pointer/touch usable;
- motion only when it communicates state/history;
- no autoplaying sound, coins, streaks, XP, loot, daily rewards, or retention mechanics;
- coding-agent attention always outranks game celebration.

## Core metaphor

A Waitloop screen is closer to a terminal/status panel than a dashboard.

```text
waitloop_

agent/
codex       running
elapsed     00:47

game/
doudizhu    ready

> enter
```

## Seat and Actor language

The UI must not imply that a Seat changes identity merely because control changes.

```text
Seat       the actual player position/hand/role
Actor      human/bot/agent related to that Seat
Controller Actor currently allowed to play
Advisor    Actor that can inspect/comment without playing
```

Player rows therefore show the stable Seat and separately communicate runtime control:

```text
players/
  you      FARMER      11 cards    CONTROL · you
> agent    LANDLORD     8 cards    TURN · Codex · 18s
  bot      FARMER      13 cards    READY
```

If a companion controls the Human Seat, the row remains `you`; it should say `CONTROL · agent companion`, not rename the Seat to Codex.

## Current game presentation

```text
current_trick/
codex seat    pair     J J

activity/
23  you        10 10
24  bot        pass
25  agent      J J

companion/
Codex     “I would probably hold the bomb.”

hand/
[3] [3] [4] [5] [6] [7] [9] [Q] [K] [A] [2]
```

`TURN` always means the authoritative current **Seat**. The Controller is a separate runtime fact. Presentation/replay must use another visual treatment rather than moving the TURN marker historically.

## Control delegation UI

When a Human Seat has a connected advisor, show an explicit control block:

```text
control/
you control this seat · Codex advises

[me] [agent]
```

After delegation:

```text
control/
Codex controls this seat · you can take back control anytime

[me] [agent]
```

Required behavior:

- delegation is explicit, never inferred from silence/time;
- `agent` remains disabled until the connected Actor is actually online;
- Human keeps seeing its own hand after delegation;
- Human play/pass/hint controls visually disable while the Agent controls the Seat;
- taking control back is always visible and low-friction;
- do not imply that delegation transfers Seat ownership.

## Companion / comments

Agent commentary is a secondary side channel, not game activity.

Use a distinct `companion/` section. Do not insert comments into `activity/`, because `activity/` represents authoritative game actions.

Comments should be visually quiet. An Agent should not be encouraged to comment after every move, and comments must never compete with work-attention notifications.

## Connected Actor lobby

Before a connected Actor authenticates, present a lobby rather than a frozen game:

```text
waiting_for_players

connected_actor_lobby/
$ waitloop join WL-XXXXXXXXXX

join URL
raw MCP configuration
```

The join relationship may be independent `controller` or same-Seat `advisor`. The Human's dealt hand/landlord remain hidden until the waiting room starts.

## Headless Agent use

The Web UI is not required for Agent-only tables. `agent.md`/HTTP/MCP must fully describe headless create/join/play. The Web can visualize such capabilities, but must not become an invisible dependency.

## Automated-action pacing

Server/game logic remains fast; do not add Worker sleeps for visual effect. The browser may replay newly observed authoritative history with short delays, while `activity/` preserves the final readable record.

Respect `prefers-reduced-motion`.

## Timing language

Casual timing is informational, not coercive.

Good:

```text
Codex · TURN · 18s
Codex · TURN · 1m 14s · taking a little longer
```

Do not show an aggressive countdown or automatically delegate/pass because a casual threshold elapsed.

## Interruption state

When coding work becomes actionable, the game visually recedes:

```text
────────────────────────────────
claude completed · 00:51

game paused

[return to work]
────────────────────────────────
```

Game victory/control/comment UI must not cover an agent waiting/completed/failed notification.

## Responsive/accessibility

- stack complex player/control/table sections on narrow screens;
- wrap card hands as touch-safe tokens;
- preserve readable Seat turn + Controller state;
- never encode readiness/control only by color;
- maintain visible focus states;
- support reduced motion;
- preserve sufficient contrast.

## Product mark

Prefer a typographic mark:

```text
waitloop_
> waitloop
waitloop()
```

The product name remains `Waitloop`; decorative punctuation is presentation only.
