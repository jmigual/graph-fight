# 20. Shots in map coordinates, offset to start at the shooter

Status: Accepted (2026-11-10); supersedes in part 0004 (anchoring), 0005 (polar frame) and 0014
(shot direction)

## Context

ADRs 4 and 5 drew every shot in a frame local to the shooter: on XY `x` pointed toward the
centre (mirrored for a right-hand shooter), and on the disc the polar origin was the shooter with
`θ = 0` pointing at the centre. The user wants both fields to behave like Graphwar: formulas are
in the map's own coordinates, and the curve is moved so that it departs from the shooter.

## Decision

- **Map frame.** The origin is the map centre, `x` to the right, `y` up; on the disc `θ = 0` is
  the map's `+x` axis and `θ` grows counter-clockwise. This is the same for every player.
- **Anchoring.** Every mode yields a curve `P(s)` in map coordinates and the world point is
  `shooter + (P(s) − P(0))`, so the first point is exactly the shooter and only deterministic f64
  maths is involved (ADR 2). There is no mirror and no rotation.
- **`y = f(x)`.** `x` starts at the shooter's `x_p` and sweeps toward the other half: `+x` for a
  shooter with `x_p ≤ 0`, `−x` otherwise, over the arena width `2 x_max`. `f` is evaluated at the
  actual map `x`, and `y = f(x) − f(x_p) + y_p` (Graphwar's vertical offset). So `y = 3` is the
  horizontal line through the shooter and `y = x` has slope 1 from either side.
- **`x(t), y(t)`** with `t` in `[0, 2 x_max]` as before: `(x(t) − x(0) + x_p, y(t) − y(0) + y_p)`.
  The formula alone decides the direction; a right-hand shooter heads left with `x(t) = −t`.
- **Disc `θ₀`.** The shooter is at polar `(r_p, θ₀)` with `θ₀ = atan2(y, x)` taken in `[0, 2π)`.
  The range matters for formulas that are not 2π-periodic (`θ²`, `ln(θ)`, `1/θ`): a shooter just
  below the `+x` axis starts at `θ₀ ≈ 2π`, not `≈ 0`.
- **`r = f(θ)`.** `θ` sweeps one turn, `[θ₀, θ₀ + 2π]` counter-clockwise or `[θ₀ − 2π, θ₀]`
  downward when clockwise, and `f` is evaluated at the actual `θ`. The drawn radius is
  `f(θ) − f(θ₀) + r_p`, so `r = 3` orbits the centre at the shooter's distance and `r = θ`
  spirals outward from the shooter (clockwise, the same `r = θ` spirals inward). One turn
  reaches every direction; a slow spiral that needs more turns can be written faster. The base
  step (`range/4000`), adaptive halving and evaluation cap of ADR 4 are unchanged.
- **`r(t), θ(t)`.** `t` runs over `[0, 2R]` as before. The point is at radius
  `r(t) − r(0) + r_p` and angle `θ₀ + (θ(t) − θ(0))`, or `θ₀ − (θ(t) − θ(0))` when clockwise.
  `r = −t, θ = 0` is a straight shot through the centre; `r = t` goes straight out.
- **Negative radius.** Standard polar: a point with `r < 0` lies on the opposite side of the
  centre, so a shot can pass through it. This needs no extra rule.
- **`UndefinedAtShooter`** now means the start value is not finite: `f(x_p)`, `f(θ₀)`, or
  `x(0)`, `y(0)`, `r(0)`, `θ(0)`. `1/x` fires from `x_p = −8`, and `1/(x + 8)` does not.
- **Clockwise** reverses the disc sweep (it no longer mirrors a shooter frame). It is a mirror
  image across the line from the centre through the shooter only when `f` is even about `θ₀`,
  and always for `r(t), θ(t)`. The flag still travels as `cw`, and XY still ignores it.

## Consequences

- A formula's shape is about the map, which every player shares, so players reason in one fixed
  frame. The boards draw the map's axes (ADR 17, section 4).
- Absolute map positions matter: a parabola's vertex or a bump can be put at a chosen map `x`,
  and a non-periodic polar formula changes between team 0's players, whose sector straddles
  `θ = 0`.
- A straight line toward an arbitrary point on the disc is `r(t), θ(t)` only, as before.
