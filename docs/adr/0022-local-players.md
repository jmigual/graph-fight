# 22. Local players: hot seat on the host's page

Status: Accepted (2026-11-10). Amends 0012 (`start.peers`), 0015 (seating, lobby `players`), 0016
(seat book), 0017 (waiting room, status bar, roster, editor memory) and 0021 (the seats bots share).

## Context

Players sitting at one screen want to play each other, alone or together with bots and remote
guests. ADR 21 already seats players that no peer holds: the host's page plays its bots, the seat
book never binds them, and their shots go through the host's shooter check before the host relays
them. A person at the host's screen needs the same seat, with the host's editor instead of a search.

## Decision

- **Seat ids.** A local player's entry in `start.peers` is `local:<n>`, `n` the lowest free number
  from 1 to 7. Trystero peer ids are alphanumeric, so no peer has one. `parseGameMsg` drops a `start`
  with an entry that starts with `local:` but does not match `^local:[1-7]$`. Every peer derives the
  name from the id: "Local 1". `start` and the lobby listing gain no field.
- **Trust boundary.** As for bots (ADR 21): `seatBook` gives a local seat no token and no holder
  (`isHostRun` covers both kinds), so `seatOf` never returns one, `rejoin` cannot claim one, `absent`
  never lists one and `relay(start)` sends no token to one. The host ignores a joining peer whose id
  starts with `local:`. A forged peer id therefore cannot claim or shoot for a local seat.
- **Seating and lobby.** `start.peers` is the host, then connected humans up to
  `seats − 1 − bots − locals`, then the local players, then the bots. The listing's `players` counts
  them. Add bot and Add local player are disabled once bots and local players fill `seats − 1`.
- **Turns.** The host's page treats a local seat like its own: when the current team is the host's
  or a local player's, the editor, Fire, the turn cue, the formula focus and the restored formula all
  apply. Fire sends a local player's shot through `acceptShot` with the local seat id, the same check
  as a remote request and a bot's shot, so the log and the replay hold an ordinary `shot`. The editor
  is replaced by "Your team is out" only when every team played on the page is out.
- **Whose turn.** People share the screen, so the status bar, the tab title and `#turn-cue` say
  "Local 2's turn" on a local player's turn and, in a game with local players, "Host's turn" on the
  host's own. Without local players the host's turn stays "Your turn". A win reads "Local 2 wins." or
  "Host wins." the same way. Guests see a local team like any other: "Team 3 is aiming".
- **Editor memory.** ADR 17, section 7 keys each character's last shot by team and player, so each
  local player gets its own characters' formulas back. The `restored` guard counted turns, which a
  quit or a kick of the current shooter does not change (`leave` uses no turn number), so the next
  team's formula was not restored then. It now counts turn starts (`Play.starts`: the start, each shot
  and timeout, and each `leave` that passes the turn on), which a replay counts again in the same
  order, and is keyed by the game's `start.seed` rather than the host, so the host's next game
  starts afresh (ADR 17, section 7). On a local player's first round its characters have not
  fired, so the editor keeps the previous player's formula, as for any character that has not fired.
- **UI.** The host's waiting room has **Add local player** `#add-local` (secondary) next to the bot
  controls. Each local player is one `li` in `#room-players`, "Local 1", listed before the bots, with
  a **Remove** button (`aria-label="Remove Local 1"`). After any Remove the focus goes to the next
  Remove in the list, or to the Add button of that kind. The roster shows "Local 1" where a human's
  short id goes.
- **Guests cannot add local players.** A guest's local players would need the guest to send shots for
  extra seats, and the host to book those seats to that guest: new protocol and a new seat-book rule.
  Out of scope; only the host adds them.

Rejected:
- One hot-seat mode separate from hosting: hosting a room with no guests already works offline
  (ADR 21), so a local seat is just another kind of seat.
- Keeping "Your turn" for the host's own seat in a game with local players: at a shared screen it
  does not say which person should play.

## Consequences

- No wire, replay or engine change. The new protocol rule is the local seat id format.
- A local player's shot is as trusted as the host's own: only the host's page can send it.
- Tests: `tests/net.test.mjs` (local ids, seat book), e2e X (host and a local player, played to the
  end) and Y (a local player, a bot and a guest in one game), and AD (a guest quits on its turn and
  the next local player's formula comes back).
