# 14. Shot engine and turn details

Status: Accepted (2026-11-09)
Superseded in part by 0020 (shot direction on the disc: clockwise sweeps θ downward; undefined
at the shooter means at `θ₀`).

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
- **Errors.** `fire` and `fire_param` parse and validate before touching any state and return
  `Err(FireError)`, converted to a string at the WASM boundary. The turn is not consumed.
  `FireError` is a parse error, or `UndefinedAtShooter` when the curve is not finite at the
  start of its range (`1/x`, `ln(x)`, `sin(x)/x`), since it cannot be anchored at the shooter.
- **`check` / `check_param`** run the same path as `fire` / `fire_param` on a copy of the
  game, so the shooter's UI can reject a bad formula before sending it. A remote shot that
  fails is applied as `skip_turn`.
- **Teams** must have at least one player (`GameError::EmptyTeam`); otherwise a team could never
  take its turn.
- **Turn rotation.** After a shot or `skip_turn` the shooting team rotates to its next living
  player, then the turn goes to the next team (cyclic by index) with a living player. If that
  team's current player is dead it rotates to a living one first. Only team index and player
  index order matter, so every peer computes the same rotation.
- **Elimination.** `eliminate_team` kills all players of the team. Eliminations are applied
  in the order the host relays them (ADR 12), so they need not commute with shots. If the
  eliminated team was current, the turn passes to the next living team without rotating
  players. An unknown index is ignored.
- **No living shooter.** If the current team has no living player (everyone eliminated),
  `fire`, `fire_param` and `skip_turn` change nothing and the shot is empty.
- **Shot direction (disc).** `fire` and `fire_param` take `clockwise: bool`; `check` and
  `check_param` do not, since both errors are raised before the frame is built.
  Counter-clockwise (`false`) is the ADR 5 frame. Clockwise reflects the shooter's local frame
  across its x axis (θ → −θ, i.e. across the shooter-to-centre axis) by negating the local `y`
  column of `D`; it applies to both `r = f(θ)` and `r(t), θ(t)`. On the XY field the flag is
  ignored (XY already mirrors toward the centre), so a client may always send it. The direction
  is part of the shot, so it travels in the shot message as `cw` (ADR 7) and every peer applies
  the same shot.
- **`winner()`** is `undefined` when no team has living players, as well as while several do.

## Consequences

- The UI must stop calling `fire` once `winner()` is defined or every team is gone.
