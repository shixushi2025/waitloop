# Dou Dizhu rule profile

Dou Dizhu has platform-specific variations. Waitloop documents its current rule profile explicitly so the engine, UI, tests, and agent-visible state do not silently disagree.

## Deck and ordering

The game uses the standard 54-card deck:

- ranks `3` through `A`;
- `2`;
- small joker;
- big joker.

Rank order:

```text
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < small joker < big joker
```

Suits never affect pattern strength.

## Current pre-bidding setup

Full bidding / rob-landlord is not implemented yet.

Until bidding exists, Waitloop chooses the landlord uniformly from the three table seats when preparing a playable table. The landlord is **not** fixed to the human player.

The engine then deals:

- 17 cards to each player;
- 3 bottom cards to the selected landlord;
- landlord leads the first trick.

For connected-agent rooms, the browser stays in `waiting_for_players` until the external MCP seat connects. During that lobby projection the browser does not receive the prepared hand or landlord assignment. Once the seat is ready, the table becomes playable using the prepared landlord/deal.

Bidding/scoring is a future rules-layer capability and must not be simulated silently in generic room code.

## Supported play patterns

### Atomic

- single;
- pair;
- triple;
- bomb (four cards of one rank);
- rocket (both jokers).

### Triple attachments

- triple + one card;
- triple + one pair of another rank.

### Sequences

- straight: at least 5 consecutive single ranks;
- consecutive pairs: at least 3 consecutive pairs;
- airplane: at least 2 consecutive triples.

`2` and jokers cannot appear in a sequence body.

### Airplane wings

For an airplane body of `n` consecutive triples:

- single-wing airplane adds exactly `n` individual cards;
- pair-wing airplane adds exactly `n` distinct pairs.

Wing cards cannot use a rank from the airplane body.

For single wings, two cards of the same non-body rank may count as two individual wings. Pair-wing airplanes require distinct pair ranks.

A body rank may be selected as a triple from a four-of-a-kind, leaving the fourth card behind; that leftover card cannot simultaneously be used as a wing because body ranks are excluded from wing selection.

### Four with two

- four-of-a-kind + two individual cards;
- four-of-a-kind + two distinct pairs.

For the individual-card variant, the two attached cards may themselves form a pair.

## Comparison

- rocket beats every other pattern and cannot be beaten;
- bomb beats every non-bomb/non-rocket pattern;
- bombs compare by four-card rank;
- ordinary patterns must have the same pattern kind/shape before primary rank is compared;
- sequence patterns must have the same sequence length/card count.

## Passing and trick reset

A player cannot pass while leading a fresh trick.

After a play:

1. the next player may beat it or pass;
2. if one player passes, the third may beat it or pass;
3. after two consecutive passes, the previous winning play is cleared;
4. the player who made that winning play leads the new trick.

The game ends immediately when a player's hand becomes empty.

## Legal moves and clients

The engine generates legal card selections from the current hand and trick state.

Machine players receive server-generated legal move IDs and submit the chosen ID for the exact room revision.

Browser humans do not receive the exhaustive legal-move enumeration. They select card IDs, and the server resolves/validates the selection against the current authoritative legal moves.

## Determinism/testing

Rules tests should inject a fixed deck or controlled randomness. No rules test should depend on production shuffling.

Changes to combination classification, comparison, legal-move generation, pass/trick progression, setup, or public projection require regression tests.

## Not implemented yet

- bidding / rob-landlord flow;
- bidding score;
- spring / anti-spring scoring;
- bomb/rocket score multipliers;
- final score settlement;
- configurable platform rule profiles.

Waitloop is not a gambling product. Any future score is match/game scoring only.