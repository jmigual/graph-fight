# 7. Wire protocol and turn authority

Status: Accepted (2026-11-09)
Superseded in part by 0012: the host relays shots and timeouts; the shooter no longer broadcasts.

## Context

Only formulas and small control messages travel (ADR 2). In a full mesh, peers receive
messages from different senders in no guaranteed order, so authority must be arranged so that
every peer applies the same sequence.

## Decision

JSON payloads over Trystero actions. The sender is the action's peer id.

Lobby room (action `announce`): `{name, field: 'xy'|'disc', players, seats}`, sent by a host
every 3 s and directly to each new lobby peer. Entries not refreshed within 10 s disappear.
The game id is the sender's peer id.

Game room (action `msg`):
- `start {seed: string, field, peers: string[]}`: host to all. `peers[i]` plays team `i`, and
  the host is `peers[0]`. A room peer not in `peers` shows "game full" and leaves.
- `shot {turn, exprs: [f] | [a, b]}`: the current shooter to all. Arity selects explicit or
  parametric mode.
- `timeout {turn}`: the current shooter to all, sent when its own 60 s turn clock expires.
- `leave {peer}`: host to all, sent when the host's `onPeerLeave` fires for a player.

Rules:
- Exactly one sender owns each turn's outcome: the shooter sends either `shot` or `timeout`.
  This removes the shot-versus-timeout race.
- `turn` counts applied shots and timeouts. Receivers apply a message only if its sender is
  `peers[current team]` and `turn` equals the local counter. A higher `turn` is buffered until
  it becomes current, and a lower one is dropped.
- A remote shot whose formula fails to parse is applied as a skip on every peer, since all
  peers parse identically.
- `leave` calls `eliminate_team`, which does not consume a turn number. If the leaver is
  current, the turn passes on. Elimination commutes with shots, so arrival order does not
  matter.
- There is no `gameover` message. Every peer derives it from `winner()`. If the host leaves,
  the game ends for everyone.
- A shooter only enables input once it is connected to every other peer in `peers`.

## Consequences

- No clocks or leader election to synchronise. Game over cannot disagree.
- Known ceilings: a shooter that disconnects mid-broadcast can leave peers split. A hung but
  connected shooter stalls the game. Host leaving ends the match (no host migration). Peers
  are trusted (no anti-cheat).
