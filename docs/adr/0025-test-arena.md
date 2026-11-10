# 25. Test arena: an offline sandbox with hand-placed players and obstacles

Status: Accepted (2026-11-10). Amends 0008 (`Game` gains `sandbox`, `fire_from`,
`fire_param_from` and `with_random_obstacles`) and 0017 (lobby button, the game screen's test
mode, hit and selection rings, selectors).

## Context

The user asked: "add a test-arena mode where I can add a player in any location and write formulas
and see how they behave. I can optionally add obstacles but an arena with no obstacles should also
be possible for testing." The defaults agreed with the user: a "Test arena" button in the lobby,
fully offline; the field and frame picked as in the host form; players of at least two teams placed
by clicking, moved by dragging and removable; obstacles optional (none by default, hand-placed with a
size, random from the engine's generator, clearable); any player fires with the normal editor; the
path is drawn with the pen and what it hit is highlighted; nothing is permanent, so a shot can be
repeated; formula errors show as in a game.

A game's arena only comes from a seed (ADR 2, 11), and `fire` kills, leaves a crater and passes the
turn (ADR 4, 14), so neither fits a sandbox.

## Decision

- **Engine (amends ADR 8).** `src/game/sandbox.rs` adds to `Game`, reusing the arena, team and shot
  code (no second copy of any geometry):
  - `Game.sandbox(field, frame, x_max, y_max, player_radius, players, obstacles)`, a static
    constructor taking `players: {x, y, team}[]` (grouped by team in the given order, so
    `teams[t].players[i]` is the `i`-th of team `t`) and `obstacles: {x, y, r}[]`. It always has at
    least two teams, empty ones included, so the turn methods never index an empty list.
  - Validation returns `GameError`: the extents, the disc's square and the sizes as in `new`
    (`NonPositiveExtent`, `DiscNotSquare`, `NonPositiveSize`), and five new variants:
    `TeamOutOfRange` (team 8 or more, one per team colour), `PlayerOutside` (a player must lie
    fully inside the field), `ObstacleOutside` (as in a generated game: fully inside the disc, centre
    inside on XY), `PlayerOnObstacle` and `PlayersOverlap` (touching counts, as in placement). NaN
    and infinite positions are outside. Players may not overlap each other, which the request did
    not ask for: overlapping faces could not be told apart or clicked.
  - `fire_from(team, player, expr, cw)` and `fire_param_from(team, player, a, b, cw)` parse and fire
    like `fire`/`fire_param` from any player, on a clone of the arena, through `shot::explicit` and
    `shot::parametric`. They take `&self`: the game, the turn and the craters never change. They
    return `TrialShot {points, hits, obstacles}`: the points as in `Shot`, the players alive before
    and dead after as `[team, player]` (friendly fire counts, the shooter is never hit), and the
    obstacles holding the last point when the shot stopped in one (ADR 14 records that point).
    `FireError::UnknownPlayer` is a shooter index that does not exist.
  - `with_random_obstacles(num, min, max, seed)` returns a copy whose obstacles are replaced by the
    generator of `new` (`Arena::add_obstacles`, clear of the players), retried like `init`.
  - Nothing in a game calls these, and `Game::new`, `fire`, the turn rotation and the wire are
    unchanged, so lockstep (ADR 2) is untouched. The seed for random obstacles comes from
    `crypto.getRandomValues` and never travels.
- **Client.** `js/arena.ts` runs the mode; `js/index.ts` only calls `initArena(editor, show, ARENAS,
  PLAYER_RADIUS)` and asks it to redraw when no game is on. The arena reuses the game section:
  `#game[data-mode=test]` hides the status bar, the out note and the roster and shows `.test-only`
  parts. The editor (helper buttons, saved formulas, templates, modes, the disc's direction) is the
  game's; `editor.refresh` now also sets the input labels, so both screens use it. The arena never
  calls `lobby.announce` or `joinGame`, and `window.__state()` stays `null`.
- **Setup.** `#test-field` and `#test-frame`, as in the host form. Opening the arena or changing the
  field starts over with an empty board (XY or the disc, map-centred by default); changing the frame
  keeps the setup. The arena constants are the game's (ADR 15). The UI offers two teams; the
  engine takes up to eight.
- **Placing and moving.** "Place" chooses Team 1 player, Team 2 player or Obstacle, with an
  obstacle radius slider (0.2 to 2, step 0.1). A click or tap on an empty spot places; every change
  rebuilds the game with `Game.sandbox`, so the engine is the only judge of a valid spot. A refusal
  changes nothing and `#test-error` (`role="alert"`) says "Can't place a player there. A player must
  be fully inside the field." with the engine's reason. A press within 10 CSS px of an edge is on
  that player or obstacle, so small faces can be tapped; players win over obstacles. Dragging a
  player (from 4 px) moves it through valid spots only; letting go on an invalid spot says why. In
  test mode the board has `touch-action: none`, so a drag moves a player instead of the page.
  "Random obstacles" replaces all obstacles with the field's game count and sizes; "Clear
  obstacles" removes them.
- **Selecting and removing.** A click on a player makes it the shooter (black ring, grid origin in
  the player frame, the `x` or `θ₀` marks of our turn) and selects it; a click on an obstacle selects
  it and keeps the shooter. A drag does not change the shooter. A player placed while there is no
  shooter becomes it. "On the board" (`#test-items`) lists one button per player and obstacle
  ("Team 1 player 1 at (-8.0, 0.0), shooter", "Obstacle 1, radius 1.0, at (0.0, 0.0)"),
  `aria-pressed` on the selection: it is the keyboard's way to select. Delete or Backspace on a row
  removes that item and keeps the focus in the list; "Remove selected" and Delete or Backspace
  after a click on the board remove the selection. Removing the shooter leaves none, and Fire stays
  disabled until a player is chosen.
- **Shooting.** The editor's Fire runs `fire_from`/`fire_param_from` from the shooter. Slider
  letters and engine errors go to `#error` as in a game ("The formula is undefined at the shooter").
  `#last-shot` (the polite live region) says "Team 1 player 1 fired y = 0. It hit Team 2 player 1.
  It stopped in obstacle 1."; it is emptied and refilled, so a repeated shot is announced again.
- **Board.** `render.ts` draws it as in a game: the pen animation, the label and the shooter's gaze.
  `View` gains two optional fields: `hits` rings each hit player 2.5 px in `--danger` 8 px outside
  its head and each obstacle the shot stopped in 3 px outside its edge, with the final frame;
  `picked` rings the selected obstacle in `--mark` 7 px outside. Both tokens are at least 3:1 on the
  paper (ADR 17, section 2).
- **Paths.** As in a game, each player's last path stays (thin, 75 %) and the newest is full with its
  label. Every setup change (place, move, remove, obstacles, frame) and "Clear paths" clear them all,
  since a path drawn for another setup would mislead.
- **Selectors** for the e2e test: `#test-open`, `#test-exit`, `#test-field`, `#test-frame`,
  `#place-team-1`, `#place-team-2`, `#place-obstacle`, `#obstacle-size`, `#random-obstacles`,
  `#clear-obstacles`, `#clear-paths`, `#remove-selected`, `#test-items` (one `li` per item),
  `#test-error`, and the game's `#arena`, `#fire`, `#input-a`, `#input-b`, `#error`, `#last-shot`.
  Scenario AI also requires that no lobby event, game-room subscription or WebRTC connection is made.

## Consequences

- ADR 17, section 9 (no preview) still holds for games. The arena previews nothing either: trying a
  formula means firing it, on a board the player set up.
- The `Game` surface grows by four methods, five `GameError` variants and one `FireError` variant
  that only the arena uses. `Arena::from_parts` and `Team::from_positions` are no longer test-only.
- Placing and moving are pointer only; the keyboard can select and remove but not place. A setup is
  not saved and lasts until the arena is left.
- A player exactly at the disc centre has no direction to face in the player frame, so its shots
  there are empty (no points, no error).
