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
  does not connect either is retried after another 25 s, never sooner. The host and peers without a
  seat never run it.
- A guest leaves the room when its game ends, so a gone host is not rejoined forever. The host
  stays, so its last broadcast is not cut off.
- Events from a room the page has left or replaced are dropped.

## Consequences

- After the race, a dropped peer is back in about 25 s instead of about 67 s, before the turn clock
  skips its turn.
- A peer whose host is gone for good rejoins every 25 s until it leaves. Trystero backs off relays
  that rate-limit it.
- The 25 s is tied to Trystero 0.26.0 internals (`answeringTtlMs`, the 60 s steady announce).
  Re-check it on a Trystero bump.
- This is a workaround until Trystero ignores copies of an offer it has already answered; remove it
  then.
- The e2e scenario G bounds the reconnect at 35 s.
