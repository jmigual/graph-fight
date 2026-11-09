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
- The host validates what it relays: an invalid or over-cap message throws instead of being
  sent (peers would drop it and be stranded). `start` may be relayed once per room, since a
  second one would split host and peers; a rematch needs a new room. `start.peers` must only
  list peers already connected to the host, because a later joiner never gets seq 0.
- Send failures are surfaced through `onSendError` instead of being swallowed. Trystero only
  warns when sending to a peer that is not connected, so `shoot` checks the host link itself
  and reports `onSendError` otherwise.

Lobby (replaces the lobby part of ADR 6; Trystero stays for game rooms only). A Trystero lobby
room builds a WebRTC mesh between every pair of visitors, O(n^2), so the lobby is plain Nostr:
- Announcements are Nostr events over WebSocket to four hard-coded relays (relay.primal.net,
  relay.snort.social, offchain.pub, nostr-pub.wellorder.net) that were checked to accept and
  forward ephemeral events. Trystero's own default relay list is alphabetical, mostly hobby
  relays, and changes between releases, so it is not used. nos.lol and relay.damus.io did not
  forward the probe event.
- The event is built and signed with Trystero's exported `createEvent(topic, content)` and the
  filter comes from its exported `subscribe(subId, topic)`: topic `graph-fight:lobby`, an
  ephemeral kind in 20000-29999 (NIP-01), so relays forward it to live subscribers and store
  nothing. No new dependency is needed (`@noble/secp256k1` was considered and not required).
  A trystero minor bump must re-check that these two exports keep this behaviour and that the
  relays still forward.
- A host republishes every 3 s, on every `announce` call, and when a relay socket opens (to
  that socket only). `announce(null)` and `leave()` publish `{withdraw: true}`. A visitor sees
  games within 3 s; there is no direct send to new visitors, because there is no mesh.
- Entries are keyed by event pubkey (a sender can only overwrite its own), expire 10 s after
  the last refresh by local arrival time, and the list is capped at 100 entries (new keys are
  refused when full, existing ones still refresh). There is no lobby `onPeerLeave`, since the
  lobby is not a room. Relay frames over 4 KB are dropped; names and ids are capped at 64.
- Signatures are not re-verified on receipt; content is shape-checked and untrusted.
- Dead relays are retried with a doubling delay (5 s up to 60 s); `leave()` stops reconnecting.

Version check (peers on different builds would desync silently):
- webpack's DefinePlugin sets `__BUILD_VERSION__` to the short commit hash, or a hash of `js/`
  and `src/` when the repository is unavailable. `net.ts` exports it as `BUILD_VERSION`.
- Listings and `start` carry it. Lobby entries get `compatible: false` on a mismatch, kept in
  the list so the UI can grey them out ("different version - reload"). A peer receiving a
  `start` from another build leaves the room and gets `onVersionMismatch` instead of the
  message.
- The commit hash does not change between uncommitted edits, so two dev builds of the same
  commit count as compatible.

## Consequences

- A hung shooter stalls only until the host's 60 s clock relays `timeout`; a host leaving
  still ends the match (no host migration).
- A peer whose link drops mid-game cannot rejoin; it desyncs and leaves.
- Peer ids are announced by the peers themselves during signalling, so a modified client can
  claim any id. Accepted under ADR 7's trusted-peers model (no anti-cheat).
