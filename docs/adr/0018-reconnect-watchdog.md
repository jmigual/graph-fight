# 18. Reconnect watchdog: a seated peer rejoins the room

Status: Accepted (2026-11-09). Amends ADR 16 (reconnection).

## Context

ADR 16 relies on Trystero to reconnect a dropped link. Trystero 0.26.0 can stall that for about
67 s. Each offer goes out on every relay, and relays deliver at different speeds. If a link drops
within a few hundred milliseconds of coming up, a slower relay can still be delivering the offer
that set it up. With the link gone, the answering side treats that copy as a new offer and answers
it, and the dead offer's peer goes nowhere. While that answer is pending, Trystero ignores every
other offer from the same peer, including the real new one and its resends. The pending answer
ends when its ICE fails (about 15 s in Chromium) or at Trystero's `answeringTtlMs` (23.3 s), but
nothing new is sent until the next steady announce, 60 s later. Meanwhile the host's 60 s turn
clock skips the player's turn. The e2e scenario G hit this in about 3% of runs.

## Decision

- A seated peer (one holding a seat token) whose host link stays down for 25 s leaves the game
  room and joins it again, with the same host id and seat token. The new room has fresh signalling
  state and announces at once, and the existing rejoin and replay path (ADR 16) restores the game.
- 25 s is past the 23.3 s after which Trystero drops a pending answer on either side, whatever the
  browser's ICE timeout, so the fresh exchange cannot hit the stale one. It is well before the 60 s
  re-announce and the 60 s turn clock. A normal reconnect takes well under a second, or about 5 s
  for a link that goes quiet before closing, so the watchdog never fires then.
- One timer per game. It starts when the host link drops, and after a reload, while the link is not
  up yet. It stops when the host link comes back and when the page leaves the room. A rejoin that
  does not bring the host back is retried after twice the previous wait: 25, 50, 100 s. The host
  and peers without a seat never run it.
- Once the host link has been down for 3 minutes in a row, the peer leaves the room and the game
  ends with "Host unreachable.". The host keeps its log in memory only, so a host that vanished
  without quitting (tab killed, machine asleep) cannot resume the game; ADR 16 already ends the
  game when the host leaves. Three minutes covers the first three rejoins.
- A guest leaves the room when its game ends, so a gone host is not rejoined forever. The host
  stays, so its last broadcast is not cut off.
- Events from a room the page has left or replaced are dropped. A rejoined room reports the peers
  already connected again, so the waiting-room list ignores a peer it already has.

## Consequences

- After the race, a dropped peer is back in about 25 s instead of about 67 s, before the turn clock
  skips its turn.
- A peer whose host is gone for good rejoins three times, then ends the game. Relay rate limits
  are shared by every room in the page, so the doubling wait keeps the extra traffic small.
- The 25 s is tied to Trystero 0.26.0 internals (`answeringTtlMs`, the 60 s steady announce).
  Re-check it on a Trystero bump.
- This is a workaround until Trystero ignores copies of an offer it has already answered; remove it
  then.
- The e2e scenario G bounds the reconnect at 35 s. Q checks, with the guest's clock faked, that
  a guest whose host vanished ends with "Host unreachable." and then stops.
