# 20. Map-centred polar shots with a radial offset

Status: Accepted (2026-11-10); supersedes in part 0005 (polar frame) and 0014 (shot direction)

## Context

ADR 5 put the polar origin at the shooter, with `θ = 0` pointing at the disc centre. The user
wants polar coordinates about the map centre instead, with the shot moved so that it departs
from the shooter, the way Graphwar shifts `y = f(x)` vertically to pass through the player.

## Decision

- **Frame.** Polar coordinates are centred on the map centre; `θ = 0` is the map's `+x` axis
  and `θ` grows counter-clockwise, the same for every player. The shooter is at `(r_p, θ₀)`.
- **`θ₀` range.** `θ₀ = atan2(y, x)` taken in `[0, 2π)`. The range matters for formulas that
  are not 2π-periodic (`θ²`, `ln(θ)`, `1/θ`): a shooter just below the `+x` axis starts at
  `θ₀ ≈ 2π`, not `≈ 0`.
- **`r = f(θ)`.** `θ` sweeps one turn, `[θ₀, θ₀ + 2π]` counter-clockwise or `[θ₀ − 2π, θ₀]`
  downward when clockwise, and `f` is evaluated at the actual `θ`. The drawn radius is
  `f(θ) − f(θ₀) + r_p`, so `r = 3` orbits the centre at the shooter's distance and `r = θ`
  spirals outward from the shooter (clockwise, the same `r = θ` spirals inward). One turn
  reaches every direction; a slow spiral that needs more turns can be written faster. The base
  step (`2π/4000`), adaptive halving and evaluation cap of ADR 4 are unchanged.
- **`r(t), θ(t)`.** `t` runs over `[0, 2R]` as before. The point is at radius
  `r(t) − r(0) + r_p` and angle `θ₀ + (θ(t) − θ(0))`, or `θ₀ − (θ(t) − θ(0))` when clockwise.
  `r = −t, θ = 0` is a straight shot through the centre; `r = t` goes straight out.
- **Negative radius.** Standard polar: a point with `r < 0` lies on the opposite side of the
  centre, so a shot can pass through it. This needs no extra rule.
- **Anchoring.** As in ADR 4, the world point is `shooter + (P(s) − P(0))`, so the first point
  is exactly the shooter and only deterministic f64 maths is involved (ADR 2).
- **`UndefinedAtShooter`** now means `f(θ₀)`, `r(0)` or `θ(0)` is not finite. `1/θ` fires from
  a shooter at `θ₀ = π`, and `1/(θ − pi)` does not.
- **Clockwise** reverses the sweep (it no longer mirrors a shooter frame). It is a mirror image
  across the line from the centre through the shooter only when `f` is even about `θ₀`, and
  always for `r(t), θ(t)`. The flag still travels as `cw` and XY still ignores it.
- XY shots are unchanged.

## Consequences

- Any formula's shape is about the centre, which every player shares, so a player can reason
  in one fixed map frame. The disc board draws that frame (ADR 17, section 4).
- Shots of team 0, whose sector straddles `θ = 0`, can change a lot between two of its players
  for non-periodic formulas.
- A straight line toward an arbitrary point is `r(t), θ(t)` only, as before.
