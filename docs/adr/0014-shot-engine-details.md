# 14. Shot engine and turn details

Status: Accepted (2026-11-09)

## Context

ADRs 4, 5, 7 and 8 fix the shot model and the API but leave a few engine details open.

## Decision

- **Recorded points.** `Shot.points` holds every sampled point that passed the finite and
  in-field checks, including the point inside an obstacle where the shot stopped. The
  non-finite or outside point that ends a shot is not recorded.
- **Step size.** The step resets to the base step for every advance and is halved only until
  the next point is within 0.05. The first point is the shooter's own position.
- **Hit test.** A point hits a player when its distance to the player centre is at most the
  player radius. The shooter is never hit by its own shot.
- **Parse errors.** `fire` and `fire_param` parse before touching any state and return
  `Err(ParseError)`, converted to a string at the WASM boundary. The turn is not consumed.
- **Turn rotation.** After a shot or `skip_turn` the shooting team rotates to its next living
  player, then the turn goes to the next team (cyclic by index) with a living player. If that
  team's current player is dead it rotates to a living one first. Only team index and player
  index order matter, so every peer computes the same rotation.
- **Elimination.** `eliminate_team` kills all players of the team and resets its player index
  to 0, so the arena is identical whether elimination comes before or after a shot by another
  team. If the eliminated team was current, the turn passes to the next living team without
  rotating players. An unknown index is ignored.
- **No living shooter.** If the current team has no living player (everyone eliminated),
  `fire`, `fire_param` and `skip_turn` change nothing and the shot is empty.
- **`winner()`** is `undefined` when no team has living players, as well as while several do.

## Consequences

- The UI must stop calling `fire` once `winner()` is defined or every team is gone.
- Eliminating the shooting team before its own shot arrives drops that shot (ADR 7: sender is
  no longer the current team); this is the one case where elimination does not commute.
