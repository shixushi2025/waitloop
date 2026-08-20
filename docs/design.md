# Design language

Waitloop should feel like a developer utility that happens to contain small games. It should not look like a gaming portal, casino, or retention-oriented entertainment product.

## Principles

- monospace-first where it improves information density;
- quiet neutral surfaces;
- hierarchy through spacing/typography rather than decoration;
- keyboard-first while remaining pointer/touch usable;
- motion only when it communicates state/history;
- no gradients by default;
- no glassmorphism/neon/arcade visual language;
- no autoplaying sound;
- no coins, streaks, XP, loot, daily rewards, or retention mechanics;
- work/agent attention always outranks game celebration.

## Core visual metaphor

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

## Canonical lifecycle language

Use the actual lifecycle states rather than marketing synonyms:

```text
idle
running
waiting
completed
failed
```

## Game presentation

Games inherit the same shell and information language.

Current Dou Dizhu presentation model:

```text
doudizhu / room_...

players/
  you         FARMER      11 cards
> codex       LANDLORD     8 cards    TURN · 18s
  bot         FARMER      13 cards

current_trick/
codex         pair         J J

activity/
23  you        10 10
24  bot        pass
25  codex      J J

hand/
[3] [3] [4] [5] [6] [7] [9] [Q] [K] [A] [2]

actions/
> play selected
  pass
  hint
```

The `>` / `TURN` marker means the **authoritative current player**, not “the move currently being animated.” Presentation/replay state must use a separate visual treatment.

## Automated-action pacing

Server/game logic remains fast and authoritative. Do not add Worker sleeps merely to make bots look human.

The browser may replay newly observed authoritative history with short presentation delays so the human can see intermediate actions. `activity/` remains visible after the replay so actions are not lost.

Respect `prefers-reduced-motion` and do not make pacing necessary for understanding the final state.

## Connected-agent lobby

Before a connected agent authenticates its MCP seat, the table should clearly present a lobby rather than a frozen game:

```text
waiting_for_players

players/
✓ you       ready
… agent     waiting
✓ bot       ready

connect/
$ waitloop join WL-XXXXXXXXXX

> raw MCP configuration
> agent.md help
```

Do not show the human's dealt hand or landlord assignment during this waiting projection.

## Timing language

Casual game timing is informational, not coercive.

Good:

```text
Codex · THINKING · 18s
Codex · THINKING · 1m 14s · taking longer than usual
```

Do not show an aggressive countdown that implies a forced move when the casual runtime does not enforce one.

Hard clocks may exist in a future Arena/benchmark policy, but they should be visually/policy distinct from casual Waitloop tables.

## Interruption state

When work becomes actionable, the game visually recedes instead of competing for attention:

```text
────────────────────────────────
claude completed · 00:51

game paused

[return to work]
────────────────────────────────
```

Do not show a game victory overlay above an agent waiting/completed/failed event.

## Responsive behavior

Mobile is supported, while desktop remains compact and keyboard-friendly.

On narrow screens:

- stack status/game content;
- avoid horizontal tables that require precision scrolling;
- wrap card hands as compact touch-safe tokens;
- preserve readable turn/current-trick/activity state;
- keep work-return actions visible.

## Accessibility

- never encode state using color alone;
- maintain visible focus states;
- support reduced motion;
- keep interactive targets touch-safe;
- use semantic labels for cards/actions;
- preserve sufficient contrast;
- avoid motion that hides required state transitions.

## Product mark

Prefer a typographic mark over game-controller imagery.

Examples:

```text
waitloop_
> waitloop
waitloop()
```

The product name remains `Waitloop`; decorative punctuation is presentation only.