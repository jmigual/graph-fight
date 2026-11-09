# 6. Serverless lobby and N-peer mesh via Trystero over Nostr

Status: Accepted (2026-11-09). Replaces the earlier PeerJS-broker idea, which was never
implemented.
Superseded in part by 0012: the lobby is plain Nostr, not a Trystero room.

## Context

The site is static (GitHub Pages, ADR 10) and we run no server. The user wants a lobby that
lists open games, plus N-player matches. PeerJS needs its broker for every handshake and has
no room or discovery concept. Trystero (`trystero` 0.26, actively maintained) does WebRTC
signalling over public relays and gives full-mesh rooms with `onPeerJoin`/`onPeerLeave` and
`makeAction` messaging.

## Decision

- Use `trystero` with its default Nostr strategy (`import {joinRoom, selfId} from 'trystero'`).
  Nostr has many independent public relays, and Trystero connects to several redundantly. It is
  the package's default and its only bundled dependency. BitTorrent trackers were rejected
  because the public WebTorrent tracker pool is small and historically flaky.
- `appId: 'graph-fight'`. Every client joins room `lobby`. A host also joins room
  `game-<selfId>` and announces the game in the lobby (ADR 7). Joining a game means joining
  that room and leaving the lobby. A Trystero room is already a full WebRTC mesh, so the game
  room is the match mesh.
- All game traffic goes over the room's data channels. Relays carry only signalling.

## Consequences

- No server, no room codes, and discovery works out of the box.
- The lobby room is itself a mesh: O(n²) connections among idle browsers. That is fine at
  hobby scale; it would need a sharded or relay-only lobby if it grows.
- There is no TURN server: peers behind symmetric NAT may fail to connect. Adding a TURN
  service later is a config change (`rtcConfig`).
- Availability depends on public Nostr relays and Google STUN, which also makes the e2e test
  network-dependent.
