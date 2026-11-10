# 27. Team mode: several seats share one engine team

Status: Accepted (2026-11-10). Amends 0012 (`start`, lobby listing, two out-of-sequence messages),
0015 (the announce carries `teams` and `k`; the 3 characters per team are `DEFAULT_K`), 0016
(`leave` of a seat), 0017 (roster, status bar, out note, Leave game, end copy), 0021 (bots are seated
on a team) and 0023 (a kick in a team hands the seat's characters over).

Amendments still to come: the protocol and the pure rules land first; each later commit that changes
a behaviour adds its "Amended by 0027" line to that ADR and 0027 to its index row. Those are 0015
(host form, seating, Start rule, characters per player), 0017 (host form and waiting room, added to
its 0027 line) and 0022 (local players are seated on a team).

## Context

The user: "it'd be nice to have a 'team' mode where multiple players can join one team or the other
instead of being a free for all. This would allow more players to play on a XY map."

Today each seat (`start.peers[i]`) is engine team `i` with 3 characters (ADR 15). The engine already
takes any `players_per_team` vector; XY needs exactly 2 teams (`XyNeedsTwoTeams`), the disc 2 or
more. Within a team, characters rotate by index and skip the dead (`Team::next_player`); teams
alternate and skip the eliminated (`next_team`); `winner()` is the last team with a living
character. Shots kill every character they touch except the shooter, teammates included (ADR 4, 14).
The bot scores −150 per own-team kill (ADR 21).

The user settled four questions: uneven sides are allowed; a leaving player's characters go to a
teammate; friendly fire stays on; and the host chooses how many characters each player gets.

## Decision

- **Model: a side is one engine team; seats own characters inside it (no engine change).**
  `Game::new` gets `players_per_team = [c, c, …]`, one entry per side, so the XY rule (2 teams), the
  turn order, the winner, friendly fire and the bot's friend/foe split all apply unchanged. Which seat
  controls a character is a pure client mapping, recomputed identically on every peer from `start`
  and the applied `leave` messages, so lockstep (ADR 2) is untouched.
- **Characters per player `k`**, the host's choice: 1, 2 or 3, default 3. It applies to free-for-all
  too, where it replaces ADR 15's fixed 3: a free-for-all side is one seat, so the same rule gives
  `c = k`. The default keeps today's games as they are (below).
- **Characters per side** `c = k × S`, where `S` is the largest number of seats any side has in
  `start`. Every side gets the same `c`, so a 2-against-1 is allowed and the lone seat plays twice as
  many characters. The total `T × S × k` is at most 24 characters, today's 8-team disc maximum,
  which ADR 15 already checked for placement (and ADR 17's 24 faint paths).
- **Ownership (option A).** Side `t`'s seats in `start.peers` order are `s_0 … s_{n−1}`; character
  `j` belongs to `s_{j mod n}`. Because the engine rotates characters by index, the seats of a side
  take turns: Team 1 seat 1, Team 2 seat 1, Team 1 seat 2, Team 2 seat 2, … A seat whose characters
  are all dead watches; its side plays on. When the engine skips a dead character the same seat can
  play twice in a row; that is the existing per-character rotation.
- **A seat that leaves** (quit, kick) hands its characters over: `owner(t, j)` is the first seat from
  `s_{j mod n}` onward, cyclically, that has not left. Only when the last seat of a side leaves does
  the client call `eliminate_team`. The per-character formula memory (ADR 17 §7, `lookKey`) follows
  the character, so the new owner gets that character's last formula.
- **Turn clock.** A `leave` restarts the host's clock and starts a turn (`Play.starts`, ADR 22) when
  the current *seat* changes, not only the current team, so an heir of the current character gets a
  full minute and a bot heir searches.
- **Lose and win.** A side is out when all its characters are dead or all its seats have left. The end
  screen reads "Your team wins." for every seat of the winning side (host, guests, and on the host's
  page in a game with local players per ADR 22, "Team 1 wins."), otherwise "Team 2 wins." followed by
  its seat names.
- **Friendly fire stays on**, as the engine does today for a shooter's own team.
- **Fields.** XY: 2 sides of 1 to 4 seats. Disc: 2 to 4 sides (`T × S ≤ 8` with `S ≥ 2`), same code.
  Placement is unchanged: a side's `c` characters are placed in its half or sector by the existing
  sampler, so seats' characters are mixed over the side's area. Frames (ADR 20) are about the shooter
  character and do not change.
- **`start`.** An optional `teams: number[]`, parallel to `peers`: `teams[i]` is the side of
  `peers[i]`. Absent means free-for-all (`teams[i] = i`). An optional `k`; absent means 3, and the
  host leaves it out when it is 3. So a free-for-all `start` with the default, and its log, are
  byte-identical to today. `parseGameMsg` drops a `start` whose `k` is not an integer from 1 to 3, or
  whose `teams` is not an array of integers of the same length as `peers`, with values `0 … T−1` each
  used at least once, `T ≥ 2`, `T = 2` on XY, and `T × S ≤ 8` (the seat cap, `MAX_PLAYERS`). The
  host's `relay` throws on the same checks (ADR 12). With `k ≤ 3` the seat cap keeps the total
  within 24, which is only reached at `k = 3`.
- **Lobby listing** gains a required `teams: number[]`: `[]` for free-for-all, else the players
  (humans, locals, bots) on each side, length `T`, with `seats` = `T × S`. `parseListing` requires
  `T ≥ 2` (`T = 2` on XY, as for `start`), `seats` a multiple of `T`, each entry `≤ seats / T`, and
  their sum `= players`. It also gains a required `k` (1 to 3). A listing from another build may lack them and reads as `[]` and 3
  (only shown as another version). The Players cell keeps "3 of 4"; the Field cell adds "2 teams of
  2" and, per side with room, "Team 2: 1 open", and "1 character each" or "2 characters each" when
  `k` is not 3.
- **Waiting room messages** (targeted, outside the sequence, like `share` and `kick`, ADR 23/24):
  - host to guests `{type: "lineup", size: S, teams: string[][], waiting: string[]}`, sent on join
    and on every change; accepted only from the host and only before `start`; `S` from 1 to 8,
    `teams.length` = `T` with `T ≥ 2` and `T × S ≤ 8`, each list at most `S` long, `waiting` the
    joiners without a seat in join order, at most 32 of them (`MAX_WAITING`; the host sends the first
    32 when more wait, and the rest still take seats in turn), each id a seat id as in `start.peers`
    (at most 64 characters, well-formed bot and local ids). Guests show `waiting` as it is rather than
    working it out from their own connections. Team mode only.
  - guest to host `{type: "team", team: t}`: "put me on side t", with `t` an integer below 8. The
    host's page gets it only before `start`, from a room peer that is not kicked, and honours it for
    a seated peer and a `t < T` with an open seat; otherwise it ignores it, and the next `lineup` shows
    the truth.
- **Seating.** A joiner goes to the side with the most open seats (lowest index on a tie); when every
  side is full it waits unseated and takes the first seat that opens, in join order. Bots and local
  players are added the same way. Start needs every side to have a player. `start.peers` keeps the
  ADR 22 order (host, humans, locals, bots); `teams` carries the sides. Seat book, tokens, rejoin and
  absence stay per seat (ADR 16); an absent seat's characters are skipped by the clock as before.
- **Version.** No protocol version: peers in one room run one build (ADR 12 gate on `start`, the
  listing's `compatible`, the invite link's `v`).
- **UI.**
  - Host form: "Mode" `#host-mode` (Free-for-all, the default / Teams). In Teams, "Teams"
    `#host-teams` (2 on XY, disabled; 2 to 4 on the disc) and "Players per team" `#host-team-size`
    (1 to `⌊8 / teams⌋`) replace `#host-seats`, hidden like the password field. In both modes,
    "Characters per player" `#host-characters` (1 to 3, default 3).
  - Waiting room: `#room-players` becomes one list per side ("Team 1, 2 of 2"), with the waiting
    joiners below. A guest sees a **Join Team N** button on each other side with room. The host has a
    **Move to Team N** button on every row (guests, locals, bots), and Add bot / Add local player put
    the new seat by the joiner rule.
  - Roster: one entry per side with its pips (of `c`), then its seats, each with "you", "aiming" on
    the current seat, "disconnected" or "left". Status bar and `#turn-cue`: "Your turn", else
    "Team 2: abc123 is aiming" (ADR 22 names for local seats). The last-shot line: "abc123 left the
    game. Team 2 plays on." A seat with no living character sees "Your players are out. Team 1 plays
    on." in place of the editor. Leave confirm: "Leave the game? Your teammates take over your
    players." (the side's last seat keeps ADR 17's text). Kick (ADR 23) is per guest seat
    (`aria-label="Kick abc123"`).
  - `window.__state()` gains `shooter`, the seat id of the current character; `me` stays our side.
- **Code.** `js/teams.ts` (pure, Node-tested): the sides of `start` (`sidesOf`, `seatsOf`,
  `sideOf`), the engine's `players_per_team` (`charactersPerSide`), `owner` with hand-over, and the
  waiting room's `join`, `leave` and `move` rules over `Lineup`, the `lineup` message's own type.
  `js/teams-view.ts`: the waiting-room side lists and the grouped roster. `js/net.ts` gains only the boundary checks and the
  two messages: `Game.lineup` (host) and `Game.askTeam` (guest) send them, `onLineup` and
  `onTeamRequest` receive them. The game and room modules call `owner` wherever they read
  `peers[current team]` or `peers.indexOf(id)` today. The default `k` is one constant,
  `DEFAULT_K` in `js/net.ts`, which replaces ADR 15's `PLAYERS_PER_TEAM`; `charactersPerSide` takes
  `k` from its caller (`start.k ?? DEFAULT_K`), because `js/teams.ts` imports no values: the Node
  test runner cannot load a `js/` module that imports another without its `.ts` extension.

Rejected:
- A fixed `c = 3 × S`: a 4v4 XY game always has 24 characters and up to 24 min per round of turns;
  the host could not make it shorter. The user chose a host setting.
- `k` for team mode only: free-for-all gets it from the same rule with `S = 1`, and the default 3 is
  left out of `start`, so its games and logs do not change.
- Even sides only: the user allows uneven sides; the same `c` for every side keeps them balanced in
  characters.
- Option B, a side's characters rotate and the controlling seat rotates separately: needs a per-side
  seat counter on every peer, and a seat would aim characters it never aimed before, which breaks the
  per-character formula memory.
- Engine-level seats (seat = engine team, sides group engine teams): touches turn order, `winner`,
  elimination and the bot's score, and lifts `XyNeedsTwoTeams`; more surface in the lockstep path for
  the same game.
- A leaver's characters die: needs an engine per-seat kill and punishes the side for a dropped
  teammate. Hand-over needs no engine change, and the user chose it.
- Friendly fire off: a new `Game::new` flag for a rule the engine already applies to one's own team.
- `start.peers` as nested arrays: changes every existing parser and log; the parallel `teams` is
  additive.
- Carrying `S` or `c` in `start`: derivable from `teams` and `k`.
- Host-only assignment (guests cannot pick): the request asks for players to "join one team or the
  other".
- Raising the 8-seat cap (`MAX_PLAYERS`) for team mode: a game room is a WebRTC full mesh (ADR 6), so
  every seat adds a link to every other peer; the same reason bounds `MAX_WAITING`.

## Consequences

- No engine, bot, replay or seat-book change; the frame, placement and determinism rules are as before.
- A 4v4 XY game has up to 24 characters, the same as an 8-player disc: up to 24 min per round of
  turns at `k = 3`, 8 min at `k = 1`.
- Uneven sides are playable but the smaller side's seats play more often.
- Tests: `tests/teams.test.mjs` (ownership interleave, `c` with `k`, hand-over, last seat leaving,
  seating and move rules, free-for-all mapping equal to today's); `tests/net.test.mjs` (`start.teams`,
  `start.k` and the listing's `teams` and `k` accepted and each malformed case dropped; `lineup` only
  from the host and `team` only at the host, both only before `start`); e2e scenarios for a 2v2 XY
  game and for hand-over (letters fixed at merge time). `joinGame`'s wiring runs on Trystero and has
  no unit test: whether the game has started (`applied || out.started()`, passed to
  `routeIncoming`), `Game.lineup` cutting `waiting` to `MAX_WAITING`, and `Game.askTeam`; the e2e
  commit covers them.
