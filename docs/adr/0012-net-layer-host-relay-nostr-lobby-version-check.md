# 12. Net layer: host relay, Nostr lobby, version check

Status: Accepted (2026-11-09)

## Context

ADR 7 had the current shooter broadcast `shot`/`timeout` itself. A shooter that hangs while
connected stalls the game, and one that disconnects mid-broadcast can leave peers split. Peers
are untrusted and the Trystero room is a mesh, so `js/net.ts` must also own validation and
ordering while knowing nothing about game rules.

## Decision

Turn authority (replaces the shooter-broadcast rule of ADR 7):
- The shooter sends a bare `shot {turn, exprs}` to the host only. The host checks that the
  sender is the current shooter and `turn` is current (game state, so the UI does this in
  `onShotRequest`), then `relay`s it to everyone and applies it through the same path. The
  shooter applies its own shot only when the host's broadcast arrives.
- The host owns the 60 s turn clock and relays `timeout {turn}` itself.
- Peers accept messages only from the host, as an envelope `{seq, msg}`. `start` is seq 0 and
  each later message is the previous seq + 1. The host drops everything from peers except
  bare `shot` requests.
- A peer drops everything until `start` (seq 0) arrives, so a late joiner never applies a
  game it missed the beginning of, and `leave` cannot overtake `start`. A repeated seq is
  dropped. A gap means a broadcast was lost (for example the link blipped while the host
  relayed `leave` for it), so the peer's state can no longer match: it leaves the room and
  `onDesync` fires.
- The host relays `leave {peer}` when a peer's `onPeerLeave` fires, but only after `start`;
  before that, departures need no message because there is no game. The host's own
  `onMessage` receives the relayed message too, so there is one code path. Local deliveries
  are queued and drained in order, so a `relay` made from inside `onMessage` cannot nest.
- Because one host sends everything over one ordered channel and `seq` detects loss, there is
  no turn buffer (the earlier `turnGate` idea is dropped); `turn` stays in `shot`/`timeout`
  for the host's check.
- Messages are JSON, shape-checked at the boundary and dropped when malformed. Size caps keep
  every payload far below Trystero's 16 KB switch to its chunked path, which could reorder
  messages: formulas at most 256 characters (the Rust parser limit), ids, seeds and names at
  most 64, `start.peers` at most `MAX_PLAYERS` (8).
- Send failures are surfaced through `onSendError` instead of being swallowed.

## Consequences

- A hung shooter stalls only until the host's 60 s clock relays `timeout`; a host leaving
  still ends the match (no host migration).
- A peer whose link drops mid-game cannot rejoin; it desyncs and leaves.
- Peer ids are announced by the peers themselves during signalling, so a modified client can
  claim any id. Accepted under ADR 7's trusted-peers model (no anti-cheat).
