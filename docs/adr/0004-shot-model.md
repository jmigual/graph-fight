# 4. Shot model: anchoring, sampling, collisions (XY field)

Status: Accepted (2026-11-09)
Superseded in part by 0020: the host picks the frame. This ADR's anchoring is the "player-centred"
frame; the default "map-centred" frame uses map coordinates offset to start at the shooter, with
no mirror.

## Context

Shots follow a player-typed curve. The model must be simple, deterministic (ADR 2), and shared
by both field kinds (ADR 5). On the 2-player rectangular XY field the modes are `y = f(x)` and
parametric `x(t), y(t)`.

## Decision

- **Anchoring.** A mode yields a local curve `P(s)`. The world trajectory is
  `shooter + D(P(s) - P(0))`, so every curve starts at the shooter. On XY,
  `P(s) = (s, f(s))` or `(x(s), y(s))`, and `D` mirrors x for a shooter with `x > 0`, so
  shots always head toward the centre and `y = x` is a 45-degree upward shot from either side.
- **Parameter range.** `s` runs over `[0, 2*x_max]` (the arena width) for both XY modes.
- **Sampling.** Fixed base step `range/4000`. If the next point lies more than `0.05` world
  units from the previous one, the step is halved and retried. The shot ends if the step
  underflows `range*1e-9` (a discontinuity) or after 200 000 evaluations. Consecutive
  trajectory points are therefore at most 0.05 apart.
- **Collision, checked per sample point, in order:**
  1. A non-finite point ends the shot.
  2. A point outside the field ends the shot.
  3. A point inside an obstacle and not inside any crater ends the shot and adds a crater
     (radius 0.5) at that point to `Arena.holes`.
  4. A point within the radius of a living player other than the shooter kills that player.
     The shot continues, and friendly fire counts.
- **Turn advance** after a shot, a parse error from a remote peer, or a timeout: the shooting
  team rotates to its next living player, then the turn passes to the next team with a living
  player. A team whose current player died rotates to a living one.

## Consequences

- Point tests with 0.05 spacing cannot tunnel through players (radius 0.3) or obstacles
  (radius 0.2 or more). Grazes shallower than the chord error may be missed, which is
  acceptable.
- Craters let later shots pass through obstacles. Players are eliminated outright, with no
  health points.
