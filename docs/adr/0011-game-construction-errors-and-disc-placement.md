# 11. Typed construction errors and disc placement details

Status: Accepted (2026-11-09)

## Context

ADR 5 fixes the disc geometry and sector layout but leaves open how construction failures are
reported, how a team's players are drawn inside its sector, and how teams on a disc avoid each
other.

## Decision

- `Game::new` returns `Result<Game, GameError>`, a plain enum (`XyNeedsTwoTeams`,
  `DiscNotSquare`, `DiscPlayerTooLarge`, `NoValidLayout`, ...) so tests assert on the variant.
  `GameError` converts into a JS string for the WASM boundary.
- Extents, obstacle sizes and the player radius must be finite and positive (NaN and infinity
  would panic inside `rand`).
- On a disc an obstacle must lie fully inside (`|pos| + size <= R`); on XY only its centre must.
- `Field::Disc` also rejects `player_radius > R/2`, since the placement annulus
  `[R/2, R - radius]` would be empty.
- Team `i` draws players directly: angle uniform in `[2πi/N - π/N, 2πi/N + π/N)`, radius
  uniform in area over the annulus. Obstacles use rejection sampling from the bounding square
  (ADR 5). Direct sampling avoids a 5-10% acceptance rate with many teams.
- Player placement now also rejects overlap with players of earlier teams. On the XY field
  the halves are disjoint so nothing changes, but adjacent disc sectors touch.
- `Arena` does not serialize its field kind; the client already knows it.

## Consequences

- Layout failures still surface only as `NoValidLayout` after the existing retry budget.
- Arenas of existing XY seeds differ from the previous version only through the changed
  collision check; both are deterministic per ADR 2.
