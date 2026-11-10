# 16. Reconnection by seat token and log replay

Status: Accepted (2026-11-09)
Amended by 0021: bot seats get no token and no holder, so no peer can claim one, and they are
never absent.
Amended by 0022: so do local players' seats (`local:<n>`).
Amended by 0023: the host can revoke a guest's seat; its token then claims nothing, and a rejoin
with it is answered with a kick.
Amended by 0018: a seated peer whose host link stays down for 25 s rejoins the game room, and
gives the game up after 3 minutes.

## Context

Under ADR 12 a seated peer whose link to the host drops is eliminated (the host relays `leave`),
and one that misses a broadcast desyncs and leaves. A brief network drop or a page reload ends
that player's game. Every relayed message is small (formulas at most 256 characters) and the
engine is deterministic (ADR 2), so the host can keep the whole sequence and let a peer rebuild
the game from it.

## Decision

- **Log.** The host's `outbox` keeps every stamped `{seq, msg}`. Recovery always replays the
  whole log from seq 0: the peer discards its game and applies the replay. There is no partial
  catch-up, since rebuilding is cheap and needs no extra state.
- **Seat tokens.** When the host relays `start`, it sends each seated peer, with a targeted
  send and never a broadcast, `{seat: token}`: 128 random bits from `crypto.getRandomValues` as
  hex. The host's own token is never sent. The peer stores `{hostId, token, version, me}` in
  `sessionStorage`, where `me` is its seat id (its `start.peers` entry). It clears that entry
  when the game ends or on Back/Leave.
- **Rejoin.** The peer sends `rejoin {token}` to the host when it sees a gap in `seq`, when its
  host link comes back, and, after a reload, when it first connects (it joins room
  `game-<hostId>` from the stored seat). The host compares the token exactly against its seat
  book, rebinds that seat to the sender's current peer id, and sends the log to that peer only,
  entry by entry with the original seqs. Each entry stays far below Trystero's 16 KB inline
  frame limit. The entries go out in one synchronous loop, but Trystero sends a frame at once
  only while the channel's buffer is below its threshold (64 KB). Beyond that, frames wait for
  `bufferedamountlow` (10 s timeout), and a newer broadcast can overtake a long replay. State
  stays correct: the peer sees a gap and asks again. While a replay to a peer is in flight,
  the host does not start another one. It remembers that one was asked for and sends it once
  the current one has drained, so a slow link cannot pile up replays. A failed replay send is
  only logged with `console.warn`, since the peer will ask again; it never touches the host's
  UI. An unknown token is ignored. While waiting for the replay, the page shows "Rejoining…".
- **Host-side replay.** The host also replays, unasked, to a seated peer that rejoins the room
  under the same peer id (a dropped link coming back). Otherwise a broadcast lost at the end
  of the stream would only show up as a gap at the next broadcast, up to one turn clock later,
  and meanwhile the peer's shot would be rejected for its stale turn number. With the peer's
  own rejoin, this can send two replays, which is harmless. The limit that remains: a broadcast
  lost on a link that never drops (a send failure) is still noticed only at the next broadcast.
- **Stale seat.** The host's room is `game-<selfId>` for the page's lifetime, so a tab
  restored with a seat from the host's previous game can join its next one. Its token is
  unknown there and is ignored. If its stored seat id is not in the new `start.peers`, it drops
  the stored seat and plays under its own id, if the host seated it.
- **Sequencer.** A `start` at seq 0 always begins a fresh run. After a gap, the sequencer asks
  for one replay and drops everything until the next seq 0. A peer without a token (the token
  had not arrived yet) still desyncs and leaves as in ADR 12.
- **Seat binding.** Requests (`shot`, `quit`) count only from the peer holding a seat now, and
  the host acts for that seat's id. A shot request's `from` is that seat id, so the host's
  shooter check is unchanged. A peer id that lost its seat to a rejoin is ignored.
- **Leaving.** A dropped link no longer relays `leave`. The seat is held until the game ends:
  the host's 60 s clock skips the missing player's turns (ADR 15), and the player can come back
  at any time. Closing a tab cannot be told apart from a drop, so the in-game "Leave game"
  button sends `quit` to the host, which relays `leave {peer: seat}` and eliminates the team.
  A quit made while the host link is down is dropped, and the seat stays held. "Back to
  lobby" only appears on the end screen and sends no quit.
- **Host.** The host never rejoins. When it quits (the Leave game button or `beforeunload`),
  it relays `leave` for itself, and every peer ends with "Host left". The
  `beforeunload` handler is registered before any room is joined, so it runs before Trystero's
  own handler closes the links. A host page that dies without `beforeunload` leaves the peers
  waiting, showing the host as disconnected, until they leave. A page with no game yet (the
  waiting room, or a stored seat whose replay has not arrived) ends with "Host left" when the
  host link drops. That includes a stale seat in the host's next waiting room; the price is
  that a link blip during the short rejoin wait also ends the game for that page. A page that
  ends without a game leaves the room, so the host's next game there does not seat it.
- **Presence.** `Game.absent()` reports only what the page itself knows. On the host, it lists
  seats whose holder is not connected. On a peer, it lists the host while the host link is down.
  The UI shows these as "Disconnected". Peers do not see other peers' absence, because after a
  rejoin they cannot map the new peer id to its seat. That would take a host presence
  broadcast, which was skipped.
- **Version.** A stored seat from another build shows the version mismatch message without
  rejoining. A replayed `start` from another build hits the existing version gate (ADR 12).

## Consequences

- A drop or a reload costs at most a few turns skipped by timeout, and the game state still
  cannot diverge, since recovery replays the same sequence.
- The host keeps the log in memory for the room's lifetime; a game is at most a few hundred
  small messages.
- `sessionStorage` is per tab, so a duplicated tab copies the seat; the tab that rejoins last
  holds it, and the other one's requests are ignored.
- The e2e test covers these cases on real WebRTC. A reload rejoins with a full replay (F). A
  dropped link keeps the seat: the test closes the guest's peer connections, and either
  Trystero opens a new one (O) or the guest's watchdog rejoins the room, within the bound set
  by ADR 18 (G). A timeout relayed while the link is down reaches the guest in the replay (O).
  A restored tab with a stale seat plays in the host's next game (H). Keeping a page offline
  in real time for longer was tried, but Trystero's reannounce loop then hit the Nostr relays'
  rate limits and stalled for minutes.
- Peers are still trusted (ADR 7). The token only stops a stale tab or another visitor from
  taking a seat by accident; it is not an authentication scheme.
