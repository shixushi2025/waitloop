# Dou Dizhu rule profile

Dou Dizhu has platform-specific rule variations. Waitloop documents its rule profile explicitly so the engine, UI, tests, and agent instructions do not silently disagree.

This document describes the current alpha profile.

## Deck and ordering

The game uses the standard 54-card deck:

- ranks `3` through `A`
- `2`
- small joker
- big joker

Rank order is:

```text
3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < small joker < big joker
```

Suits never affect pattern strength.

## Alpha setup

The room currently receives an explicit landlord when it is created. The engine deals:

- 17 cards to each player
- 3 bottom cards to the landlord
- landlord leads the first trick

The bidding/rob-landlord phase and score multipliers will be added later. They are not simulated silently in the current alpha.

## Supported play patterns

### Atomic

- single
- pair
- triple
- bomb (four cards of one rank)
- rocket (both jokers)

### Triple attachments

- triple + one card
- triple + one pair of another rank

### Sequences

- straight: at least 5 consecutive single ranks
- consecutive pairs: at least 3 consecutive pairs
- airplane: at least 2 consecutive triples

`2` and jokers cannot appear in any sequence body.

### Airplane wings

For an airplane body of `n` consecutive triples:

- single-wing airplane adds exactly `n` individual cards
- pair-wing airplane adds exactly `n` distinct pairs

Wing cards cannot use a rank that belongs to the airplane body.

For single wings, two cards of the same non-body rank may be used as two individual wings. This makes a pair usable as two single wings. Pair-wing airplanes require distinct pair ranks.

A body rank may be selected as a triple from a four-of-a-kind in the player's hand, leaving the fourth card behind; that leftover card cannot simultaneously be used as a wing because body ranks are excluded from the wing selection.

### Four with two

- four-of-a-kind + two individual cards
- four-of-a-kind + two distinct pairs

For the individual-card variant, the two attached cards may be a pair.

## Comparison

- rocket beats every other pattern and cannot be beaten
- a bomb beats every non-bomb, non-rocket pattern
- bombs compare by their four-card rank
- ordinary patterns must have the same pattern kind and shape before primary rank is compared
- sequence patterns must have the same sequence length/card count

## Passing and trick reset

A player cannot pass while leading a fresh trick.

After a play:

1. the next player may beat it or pass
2. if one player passes, the third player may beat it or pass
3. after two consecutive passes, the previous winning play is cleared
4. the player who made that winning play leads a new trick

The game ends immediately when a player's hand becomes empty.

## Legal move IDs

The rules engine generates legal card selections from the current hand and trick state. The room layer exposes opaque move IDs for those selections.

Clients and agents never submit an arbitrary card array as the authoritative move. They submit a generated move ID for the current room revision.

## Not implemented yet

- bidding / rob-landlord flow
- bidding score
- spring / anti-spring scoring
- bomb/rocket score multipliers
- settlement and currency of any kind
- configurable platform rule profiles

Waitloop is not a gambling product; any future scoring remains match/game scoring only.
