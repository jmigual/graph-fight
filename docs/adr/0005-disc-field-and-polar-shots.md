# 5. Disc field with polar shots; field kind is a host option

Status: Accepted (2026-11-09)
Superseded in part by 0014 (shot direction: CCW is the default; clockwise mirrors θ) and by
0020 (the host picks the frame: this polar frame at the shooter is "player-centred"; the default
"map-centred" frame puts the polar origin at the map centre, offset to start at the shooter).

## Context

A rectangle split into halves suits 2 players but not 3 or more. The user wants a round
arena with polar formulas for more than 2 players, optionally also for 2 players. Shots are
relative to the shooter.

## Decision

- `#[wasm_bindgen] enum Field { Xy, Disc }`, chosen by the host and sent in `start`.
  `Xy` is allowed only with exactly 2 teams, and `Game::new` returns `Err` otherwise. `Disc`
  works for any team count of 2 or more.
- **Disc geometry.** Radius `R = y_max`; `Game::new` requires `x_max == y_max` for `Disc`.
  Points are drawn uniformly in the disc by rejection sampling from the bounding square
  (seeded `rng`, deterministic). Team `i` of `N` owns the sector centred on angle `2πi/N` with
  width `2π/N`. Its players are placed with `r` in `[R/2, R - radius]`. Obstacles are anywhere
  inside the disc. Overlap rules are the existing ones.
- **Polar shots.** The local frame has its origin at the shooter, with `θ = 0` pointing at the
  disc centre and `θ` counter-clockwise. `D` is the rotation from local +x to the
  shooter-to-centre direction. Mode `r = f(θ)` uses `P(θ) = f(θ)(cos θ, sin θ)` with `θ` in
  `[0, 2π]`. Mode `r(t), θ(t)` uses `P(t) = r(t)(cos θ(t), sin θ(t))` with `t` in `[0, 2R]`.
  Anchoring, sampling, collisions, and turn advance are identical to ADR 4. "Outside the field"
  means `|p| > R`.
- No generic coordinate-system abstraction. The trajectory walker takes a closure
  `Fn(f64) -> Point`. Field kind is matched in three places: the `contains` check, obstacle and
  player placement, and the choice of `D` plus the explicit-mode variable (`x` or `θ`).

## Consequences

- One engine path serves four modes. A straight shot at the centre is `r(t)=t, θ(t)=0`.
  A straight line is not expressible as `r = f(θ)` from the origin, which is why the parametric
  polar mode exists.
- Team placement by sector replaces the rectangle `Team.area` for discs. Placement takes a
  sampling closure instead of a stored `Rectangle`.
