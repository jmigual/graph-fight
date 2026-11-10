# 8. Rust/TypeScript API surface

Status: Accepted (2026-11-09)
Amended by 0021: the module also exports `Bot` (`new Bot(game, level, starters)`,
`think(budget)`), `Level` and `Starter`, a bot's search on its own copy of a `Game`; `Game` itself
is unchanged.
Amended by 0025: `Game.sandbox(field, frame, x_max, y_max, player_radius, players, obstacles)` builds
a test arena from hand-placed players and obstacles, `fire_from`/`fire_param_from` fire from any
player without changing the game and return `TrialShot {points, hits, obstacles}`, and
`with_random_obstacles` redraws the obstacles; new `GameError` and `FireError` variants go with them.
Superseded in part by 0020: the constructor takes `frame: Frame` (`Map` or `Player`) right after
`field`.
Superseded in part by 0014: `fire` returns `FireError` (including `UndefinedAtShooter`); the shooter validates with `check`/`check_param`; `fire`/`fire_param` take a `clockwise` direction flag.

## Context

TypeScript draws and networks, and Rust owns all simulation (ADR 2). The boundary should be
one small `Game` surface that serves both field kinds.

## Decision

Exported via `wasm-bindgen`, extending the existing `Game`:

- `new Game(field, x_max, y_max, num_obstacles, min_obstacle, max_obstacle, players_per_team, player_radius, seed)`
  is the existing constructor with `field: Field` added first. Arena constants stay in TS,
  where they already are; they are compiled into the shared bundle, so they never travel.
- `arena(): Arena` (existing; the serialized `holes` field is now populated).
- `get_current_team_idx(): number` (existing).
- `fire(expr): Shot`: `y=f(x)` on XY, `r=f(θ)` on Disc.
- `fire_param(a, b): Shot`: `x(t),y(t)` on XY, `r(t),θ(t)` on Disc.
- `skip_turn()`, `eliminate_team(idx)`, and `winner(): number | undefined`. `winner` is `Some`
  once at most one team has living players.
- `Shot` is a Tsify struct `{points: Point[]}`. Kills and craters are read from `arena()`.

`fire`/`fire_param` return `Err(String)` on a parse error and leave state unchanged. The local
shooter validates by firing on its own `Game` before sending. Remote parse errors map to
`skip_turn()` (ADR 7). The Rust-only `Game::shoot` stub is replaced by these methods.

## Consequences

- TS never needs a mode enum. Field kind plus arity determines the mode.
- `Player.formula` and `get_current_formula` remain unused (pre-existing). They are left
  alone and flagged, not removed.
