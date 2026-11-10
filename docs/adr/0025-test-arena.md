# 25. Test arena: an offline sandbox with hand-placed players and obstacles

Status: Accepted (2026-11-10). Amends 0008 (`Game` gains `sandbox`, `fire_from`,
`fire_param_from` and `with_random_obstacles`) and 0017 (lobby button, the game screen's test
mode, hit and selection rings, selectors). Refines 0020: a player-frame shooter at the disc centre
faces `+x` (see Consequences).

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
    `FireError::UnknownPlayer` is a shooter index that does not exist. A player can stand at the
    disc centre, where `trace` has a rule of its own (Consequences, last item).
  - `with_random_obstacles(num, min, max, seed)` returns a copy whose obstacles are replaced by the
    generator of `new` (`Arena::add_obstacles`, clear of the players), retried like `init`.
  - Nothing in a game calls these, and `Game::new`, `fire`, the turn rotation and the wire are
    unchanged, so lockstep (ADR 2) is untouched. The seed for random obstacles comes from
    `crypto.getRandomValues` and never travels.
- **Client.** `js/arena.ts` runs the mode; `js/game.ts` only calls `initArena(editor, show, ARENAS,
  PLAYER_RADIUS)`, asks it to redraw when no game is on, and closes it in `toLobby` (`js/room.ts`): an invite link
  pasted in the arena (ADR 24) goes through there, and its room must not open in test mode. The
  arena knows nothing of seats (bots, local players) or listings. It reuses the game section:
  `#game[data-mode=test]` hides the status bar, the out note and the roster and shows `.test-only`
  parts; opening the arena shows `#shot-form`, which a game we were out of left hidden. The editor (helper buttons, saved formulas, templates, modes, the disc's direction) is the
  game's; `editor.refresh` now also sets the input labels, so both screens use it. The arena never
  calls `lobby.announce` or `joinGame`, and `window.__state()` stays `null`.
- **Setup.** `#test-field` and `#test-frame`, as in the host form. Opening the arena or changing the
  field starts over with an empty board (XY or the disc, map-centred by default); changing the frame
  keeps the setup. The arena constants are the game's (ADR 15). The teams are a game's: 2 on XY
  and up to `MAX_PLAYERS` (8) on the disc, in their ADR 17 colours and faces.
- **Placing and moving.** "Place" chooses Player or Obstacle; "Team" (`#test-team`, with a swatch
  in the team's colour and number) picks the player's team, and a slider the obstacle radius (0.2
  to 2, step 0.1). A click or tap on an empty spot places; every change rebuilds the game with
  `Game.sandbox`, so the engine is the only judge of a valid spot. A refusal changes nothing and
  `#test-error` (`role="alert"`) says "Can't place a player there. A player must be fully inside
  the field." with the engine's reason. A press within 10 CSS px of an edge is on that player or
  obstacle, so small faces can be tapped; players win over obstacles. A press is the main button
  (or a touch) of one pointer, followed by its id, and ends if the pointer is cancelled or loses
  its capture; once it moves 4 px (10 px for a finger) it is a drag or a swipe and never places or
  selects. Dragging a player moves it through valid spots only and selects it; letting go on an
  invalid spot says why. In test mode the board has `touch-action: none`, so a drag moves a player
  instead of the page. "Random obstacles" replaces all obstacles with the field's game count and
  sizes; "Clear obstacles" removes them.
- **Position.** Number fields `x` and `y` in a "Position" group place what Place chooses ("Place at
  x, y", or Enter) and move the selection ("Move selected to x, y"), through the same engine check
  and `#test-error`. Both are required numbers, checked by the form before the engine sees them.
  They are the keyboard's way to place and move, and the way to exact spots. They are filled with
  the selection's position after a click, a list choice or a drag, and at no other time, so a
  typed value survives a shot or a redraw.
- **Selecting and removing.** A click on a player makes it the shooter (black ring, grid origin in
  the player frame, the `x` or `θ₀` marks of our turn) and selects it; a click on an obstacle selects
  it and keeps the shooter. A drag selects but does not change the shooter. A player placed while
  there is no shooter becomes it. "On the board" (`#test-items`) lists one button per player and obstacle
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
  `#place-player`, `#place-obstacle`, `#test-team` (values `0` to `7`), `#obstacle-size`, `#test-x`,
  `#test-y`, `#test-move`, `#random-obstacles`, `#clear-obstacles`, `#clear-paths`,
  `#remove-selected`, `#test-items` (one `li` per item), `#test-error`, and the game's `#arena`,
  `#fire`, `#input-a`, `#input-b`, `#error`, `#last-shot`. Scenario AI also requires that no lobby
  event, game-room subscription or WebRTC connection is made, and that the lobby's own
  subscription was seen.

## Consequences

- ADR 17, section 9 rejected a preview because trial and error within the turn would replace
  turning a picture into a formula. The arena previews nothing, but it is trial and error: during a
  live game a player can open it in a second tab, set up the board and try shots before firing for
  real. The user asked for the arena knowing this; ADR 17 section 9 already noted that a
  determined player could compute outcomes, so it was never a security measure.
- The `Game` surface grows by four methods, five `GameError` variants and one `FireError` variant
  that only the arena uses. `Arena::from_parts` and `Team::from_positions` are no longer test-only.
- A setup is not saved and lasts until the arena is left.
- A player exactly at the disc centre has no direction toward the centre. In the player frame the
  engine then faces it along `+x` (`trace` in `src/game/shot.rs`), which is how the board already
  draws it (`ahead` in `js/render.ts`). Only the arena can put a player there: a game places disc
  players at `r >= R/2` (ADR 11), so no game shot changes.
