# Design language

Waitloop should look like a developer utility that happens to contain games. It should not look like a gaming portal.

## Principles

- monospace-first where it improves information density
- quiet neutral surfaces
- strong hierarchy through spacing and typography, not decoration
- keyboard-first interaction
- motion only when it communicates state
- no gradients by default
- no glassmorphism
- no neon/arcade visual language
- no autoplaying sound
- no retention mechanics

## Core visual metaphor

A Waitloop screen is closer to a terminal status panel than a dashboard.

```text
waitloop_

agent
────────────────────────────────
codex       running
elapsed     00:47

game
────────────────────────────────
doudizhu    ready

> enter
```

## Status language

Canonical agent status labels:

```text
idle
running
waiting
completed
failed
```

Avoid marketing synonyms that blur semantics.

## Game presentation

Games should inherit the same shell and typography. Individual games may introduce minimal domain-specific visuals, but the shell remains consistent.

Dou Dizhu example:

```text
doudizhu / room_a83f

landlord       codex
turn           you

last
10 10

hand
03 03 04 05 06 07 08 09 J J Q K A 2

legal
01    J J
02    pass

> 01
```

Clickable controls can coexist with command-like labels. The UI should be usable without remembering commands.

## Interruption state

When work becomes actionable, the game should visually recede instead of competing for attention:

```text
────────────────────────────────
claude completed · 00:51

game paused

[return to work]
────────────────────────────────
```

Do not show a celebratory game overlay above an agent completion event.

## Responsive behavior

Mobile is supported for the web experience, but the primary interaction model remains compact and keyboard-friendly on desktop.

On narrow screens:

- stack status and game content
- avoid horizontal tables
- render card hands as wrap-safe compact tokens
- keep the primary work-return action visible

## Accessibility

- never encode agent state using color alone
- maintain visible focus states
- support reduced motion
- keep interactive targets touch-safe on mobile
- semantic labels for card/move controls
- preserve sufficient contrast in both light and dark themes

## Logo direction

Prefer a typographic mark over a game-controller icon.

Candidates:

```text
waitloop_
> waitloop
waitloop()
```

The product name remains `Waitloop`; decorative punctuation is presentation only.
