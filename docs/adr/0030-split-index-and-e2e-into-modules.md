# 30. Split index.ts and the e2e suite into modules

Status: Accepted (2026-11-10). Moves code described in 0009, 0015, 0017 and 0025; no behaviour or
earlier decision changes.
Amended by 0033: the runner starts each scenario in its own process, `E2E_JOBS` at a time, and
`ORDER` lives in `tests/e2e/order.mjs`, slowest first.

## Context

`js/index.ts` (about 740 lines) held the lobby, host form, password and invite handling, the
waiting room and the whole game loop, and `tests/e2e.mjs` (about 1600 lines) held the harness and
every scenario. Each feature landed in the same two files, and the team-mode UI (0027) needs the
lobby, waiting room and game apart.

## Decision

Code moved as it was; only the seams are new.

- **Client modules.** `js/dom.ts` has `$` and `show`. `js/lobby.ts` has the game list, the lobby
  connection (`lobby`), `games`, the host form and the join-password dialog. `js/room.ts` has the
  room session and waiting room. `js/game.ts` has the turn loop, shots, bots, restore, the shot
  memory, the end screen, the arena constants, the editor and test arena wiring, and `__state`.
  `js/wasm.ts` runs `await init()`. `js/index.ts` only boots: it imports `./wasm` first, then sets
  the footer version and handles the invite link, `hashchange` and the stored-seat rejoin.
- **State has one owner, read elsewhere through live `export let` bindings.** `room.ts` owns
  `room`, `hostId`, `me`, `offer`, `unlisted`, `shareInvite`, `roomKey`, `connected`, `bots`,
  `locals`, `roomInfo` and the seat key. `game.ts` owns `play`, `ended` and `restored`. `lobby.ts`
  owns `games`. A module changes another's state only by calling the owner:
  - `room.ts`: `dropSeat()` (forget the stored seat, `me = selfId`, for a seat from an earlier
    game), `hostRoom(offer, hidden, share, password)` (set the offer, visibility and share flag,
    then enter our own room; the host form calls it) and `toLobby()` (leave everything, show the
    lobby).
  - `game.ts`: `dropGame()` (stop the clock, `play = null`) and `clearEnded()` (`ended = false`,
    for a room about to be entered).
- **Import cycles are allowed, but only at call time.** `room` imports `game` and `lobby`, and both
  import `room` back (`room`, `hostId`, `me`, `enterRoom`, `hostRoom`, `dropSeat`); a lobby or
  game callback needs the room and a room callback needs the game. Passing the functions in
  instead would add an `init` registration for each. This is safe because a module's top level
  only declares functions and constants, registers DOM handlers, or opens the lobby connection
  (whose first callback is asynchronous); nothing there reads a binding of a module that has not
  run yet. A new module must keep it so: no top-level read of an imported `let`.
- **Wasm init comes first.** Imported modules run before the importer's own body, so an `await
  init()` left in `index.ts` ran after every handler and the lobby connection had gone live; a
  click on Test arena then opened it with no engine. `js/wasm.ts` (`await init()`) is the first
  import of `index.ts`, and the bundle runs the modules in import order, so none of the others
  runs, and no handler is live, before the wasm has loaded. Keep it the first import. e2e AN holds
  `index_bg.wasm` back, checks that Test arena does nothing and the footer stays empty, then
  releases it and checks the arena opens.
- **e2e.** `tests/e2e/helpers.mjs` has the static server, the browser and the helpers
  (`startGame`, `assertBuild`, `watchFrames`, ...); `tests/e2e/{core,net,bots,local,editor,ui,arena,build}.mjs`
  each export a `scenarios` object by feature; `tests/e2e.mjs` is the runner and `npm run e2e`
  stays the entry. Scenario names and the output (`ok X (n s)`, `N/M scenarios passed`) are
  unchanged. The run order is the `ORDER` array in the runner, not the file order, and an assert
  fails when `ORDER` and the files disagree, so a new scenario must be added to both.
  `npm run e2e -- AI AK` runs only the named scenarios, in the order given; an unknown name
  exits 1.

## Consequences

- A change to the lobby, the room or the game touches one file; the same holds for e2e scenarios.
- The cycles are a cost: moving a top-level statement that reads another module's binding can
  break at load, which the e2e run would show at once.
- References in older ADRs to `js/index.ts` for arena constants, the gaze, the shot memory and the
  Fire handler now name `js/game.ts`; the e2e MIME map is in `tests/e2e/helpers.mjs`.
