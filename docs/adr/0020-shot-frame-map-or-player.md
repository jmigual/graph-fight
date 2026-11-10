# 20. Shot frame: map-centred (default) or player-centred, chosen by the host

Status: Accepted (2026-11-10); supersedes in part 0004 (anchoring), 0005 (polar frame), 0008
(constructor), 0012 and 0015 (`start` and lobby listing fields) and 0014 (shot direction). Refined by
0025: a player-frame shooter at the disc centre, which only the test arena can place, faces `+x`.

## Context

ADRs 4 and 5 drew every shot in a frame local to the shooter: on XY `x` pointed toward the
centre (mirrored for a right-hand shooter), and on the disc the polar origin was the shooter with
`θ = 0` pointing at the centre. The user wants both fields to behave like Graphwar: formulas are
in the map's own coordinates, and the curve is moved so that it departs from the shooter. They
then asked to keep both: the game creator decides whether coordinates are centred on the map or
on the player.

## Decision

- **Option.** The host picks the frame when creating a game: "Map-centred (like Graphwar)", the
  default, or "Player-centred", the ADR 4 and 5 frames unchanged (XY mirrored toward the centre,
  polar origin at the shooter with `θ = 0` toward the centre, clockwise mirrors across the
  shooter-to-centre axis, undefined means at local `x = 0`, `θ = 0` or `t = 0`). The engine takes
  `Frame { Map, Player }` in `Game::new` after `Field`; it applies to both fields and both modes,
  and there is no per-shot flag. Every combination of field and frame is valid, so `Frame` adds
  no `GameError`. On the wire `start` carries `frame: "map" | "player"` and the lobby listing
  carries it too, so joiners see it before joining; both are required and validated like
  `field` (amends ADR 12's message list). Only a build older than this ADR omits it: such a
  listing still shows as another version, and such a `start` reaches the version check, which
  turns it away (ADR 12). The rest of this section is the map-centred frame.
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
- **Disc `θ₀`.** The shooter is at polar `(r_p, θ₀)` with `θ₀ = atan2(y, x).rem_euclid(2π)`, in
  `[0, 2π]`: it is in `[0, 2π)` except that a shooter a hair below the `+x` axis can round up to
  exactly `2π` (the board's label then reads `0.00`). The range matters for formulas that are not
  2π-periodic (`θ²`, `ln(θ)`, `1/θ`): a shooter just below the `+x` axis starts at `θ₀ ≈ 2π`,
  not `≈ 0`.
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
- **Clockwise** reverses the disc sweep in the map frame (the player frame still mirrors). It is
  a mirror image across the line from the centre through the shooter only when `f` is even about
  `θ₀`, and always for `r(t), θ(t)`. The flag still travels as `cw`, and XY still ignores it.

## Consequences

- In the map frame a formula's shape is about the map, which every player shares, so players
  reason in one fixed frame, and the boards draw the map's axes (ADR 17, section 4). In the
  player frame the boards keep the shooter's frame.
- The engine keeps both code paths; they differ only in the curve and the linear map `D` of the
  anchoring `shooter + D(P(s) − P(0))` (identity in the map frame).
- Starter templates suit the map frame (ADR 17, section 8); in the player frame they still parse
  and fire, with the shapes of the shooter's frame.
- Absolute map positions matter: a parabola's vertex or a bump can be put at a chosen map `x`,
  and a non-periodic polar formula changes between team 0's players, whose sector straddles
  `θ = 0`.
- A straight line toward an arbitrary point on the disc is `r(t), θ(t)` only, as before.
