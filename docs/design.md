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
- normal Agent/Human paths do not expose transport credentials or implementation plumbing;
- unsupported Host capability is stated honestly rather than hidden behind a broken control.

## Human UI versus Agent play language

The first choice is who operates the Seat:

```text
open_game
  Human clicks an MCP App table

create_room
  Agent owns seat-1 and plays through MCP tools
```

Human-facing prompts such as “I want to play”, “open the game UI”, or “let me choose cards” should lead to `open_game`. Agent-autonomous prompts should lead to `create_room`.

Never render an Agent-owned Room as though the Human can click its hand, and never let a Human MCP App impersonate an Agent Actor.

## MCP App visual contract

Resource:

```text
ui://waitloop/doudizhu/v1
text/html;profile=mcp-app
```

The inline App is a compact utility panel, not a miniature casino page. Required visual regions:

```text
brand + refresh/fullscreen controls
role / turn / status / revision
three Seat summaries
current trick
recent activity
your hand
actions: play / pass / hint / clear
state/error/fallback message
```

The App should inherit Host color/font variables where available and remain readable with its own neutral fallbacks. It must support narrow layouts by stacking players/table panels.

Interaction rules:

- cards are buttons with visible selected state;
- unavailable actions are disabled, not silently ignored;
- Human can always distinguish current turn and own Seat;
- refresh is explicit in addition to bounded automatic polling;
- fullscreen is offered only if the Host advertises it;
- teardown stops polling;
- no autoplay audio, confetti, reward animation, or retention prompt;
- activity is recent authoritative history, not model narration;
- the compact MCP App shows only the latest four activity rows, in chronological order, without an internal scrollbar;
- long activity rows stay single-line and truncate visually rather than widening or scrolling the panel;
- current trick remains separate from recent activity, so limiting the list never hides the authoritative play to beat;
- error text tells the Human what to do next.

The App is self-contained: no external script, stylesheet, tracking pixel, or direct credentialed fetch.

## MCP App Host fallback language

Do not say “your game is open” when the Host did not render or operate the App.

A visible model-facing JSON or structured tool result is not proof that rendering failed. Some Hosts show the safe tool result in the transcript and render the linked MCP App at the same time. Do not automatically launch the browser fallback merely because the model can see the snapshot; use fallback only after the active Host actually fails to show or operate the App, or the Human reports that inline controls are absent.

Use explicit wording:

```text
This Host does not currently provide the MCP Apps capabilities needed for inline controls.

Open the standalone web table to start a separate Human game,
or use create_room if the Agent should play.
```

The fallback URL starts a **separate game**. Do not imply same-Room continuation because private Human cookies and `wlui_` capability are not transferable in the URL.

## MCP App private capability UX

The Human should never see or manually copy:

```text
wl_actor
wl_room_*
wlui_*
```

The Host/App/local bridge handles them invisibly. If the App capability is missing/invalid, disable actions and advise reopening with `open_game(roomId)` rather than displaying the token.

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

The first MCP App Human-vs-bots release may use simpler Seat summaries, but it still preserves this semantic model.

## Agent connection hierarchy

Primary connected-Agent guidance:

```text
connect your agent/

recommended
$ waitloop join WL-XXXXXXXXXX

stable MCP
$ waitloop mcp install codex

advanced
show raw MCP configuration
```

With stable MCP installed, an Agent may call `join_room(code)` directly. Raw headers remain collapsed/advanced and labeled sensitive.

The lobby distinguishes:

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

The first MCP App release does not yet expose connected-agent/companion delegation controls. Those remain standalone Web functionality until added with explicit server capabilities.

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

In `agent-bots`, yielding Agent `seat-1` may allow all three Bots to finish. UI/docs must call it handoff, not pause.

## Efficient wait language

`wait_for_turn()` is invisible Agent transport efficiency, not a visible competitive timer.

Human-facing UI may show elapsed status:

```text
Codex · TURN · 18s
Codex · TURN · 1m 14s · taking longer than usual
```

A 25-second MCP transport timeout should not appear as “Agent timed out” or “move expired”. The Agent simply waits again while its run remains active.

The Human MCP App uses bounded state refresh while the iframe remains open. This is not a model loop or turn deadline.

## Continuous-play expectation

Agent-facing instructions distinguish:

```text
connect / verify
-> one snapshot may finish the request

Agent plays until finished
-> keep current Agent run active
-> wait_for_turn
-> play_move
-> repeat until game_finished

Human plays inline
-> open_game
-> Human clicks App controls
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
room unavailable / this client is not the owning Actor
interactive Room not present in this local bridge
Host cannot operate MCP Apps
```

Never display anonymous Actor, cached Agent secret, Human cookies, or App capability.

Local bridge `leave_room` messaging:

```text
active Agent room cleared locally
credential remains cached until room expiry
remote game unchanged
```

Human App reopen messaging:

```text
open_game(roomId)
-> reopen still-valid local interactive Room
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

Worker/game logic never sleeps for visual effect; Web/App may present authoritative history. Respect reduced motion.

## Headless use

Standalone Web is not an Agent requirement. Primary Agent headless path is stable local MCP/CLI. Raw Room HTTP + remote MCP remain advanced fallback.

Human inline use is also local MCP but requires an MCP Apps-capable Host. Tool support alone is not sufficient proof of UI support.

## Responsive/accessibility

- stack player/control/table sections on narrow screens;
- fallback actions remain readable/touchable;
- never encode readiness/control only by color;
- preserve focus states, contrast, reduced motion;
- cards/actions remain touch-safe;
- selected cards expose pressed state;
- disabled actions remain visibly distinguishable;
- App resizes through Host notifications without page-level scroll assumptions.

## Product mark

Prefer typographic marks such as `waitloop_`, `> waitloop`, or `waitloop()`.
