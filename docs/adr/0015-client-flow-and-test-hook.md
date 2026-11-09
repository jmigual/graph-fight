# 15. Client constants, room flow, turn clock and test hook

Status: Accepted (2026-11-09)
Superseded in part by 0016: "host left" now comes from the host's relayed `leave`; seated peers keep their seat when a link drops.

## Context

ADRs 7, 8 and 12 leave open the arena constants (ADR 8 keeps them in TypeScript), what the
lobby and waiting room do, and who runs which timer. The end-to-end test also needs a way to
read game state.

## Decision

- **Arena constants** live in `js/index.ts` and are compiled into the bundle (same build, same
  constants, ADR 12 version check). Every team has 3 players of radius 0.3.
  - `xy`: 20 x 10 (x and y extents), 30 obstacles of size 0.2 to 2, canvas 800 x 400.
  - `disc`: radius 10, 20 obstacles of size 0.2 to 1.5, canvas 600 x 600.
  - Construction was checked natively for 2 to 8 teams on the disc over 300 seeds.
- **Lobby.** One `joinLobby` for the page's lifetime. Hosting joins the game room `selfId` and
  announces `{name, field, players, seats}`; `players` is re-announced whenever a peer joins or
  leaves. `xy` fixes seats at 2. A full game shows a disabled Join button; a game on another
  build shows "different version — reload" instead.
- **Start.** The host enables Start with 2 or more players, takes `[host, ...connected]` cut to
  `seats`, relays `start` (seed from `crypto.getRandomValues`, as a decimal string) and then
  withdraws its listing. A connected peer that did not get a seat sees "game full".
- **End screen.** Winner, draw (nobody left), "host left", "desynced", "version mismatch".
  The board stays visible below the message. Back to lobby leaves the room.
- **Turn clock.** Every peer counts `turn` (applied shots and timeouts). The host alone arms a
  60 s `setTimeout` that relays `timeout {turn}`, and re-arms it after every applied shot or
  timeout and after a `leave` that passes the turn on, so a new shooter always gets a full
  minute. A `leave` of a peer without a seat is ignored and one that keeps the same current team leaves
  the clock alone, so joining and leaving cannot stall the shooter. The timeout carries the turn that
  was current when the clock was armed. Other peers only show a
  countdown from the same events; it is cosmetic. If the engine throws while applying a
  message (even `skip_turn`), the peer ends the game with an engine error.
- **Shooting.** The shooter validates with `check`/`check_param` and does not send on error. After
  sending, Fire stays disabled until the host's broadcast is applied or a send error is reported.
  The host's `onShotRequest` accepts a request only from the current team's peer with the
  current `turn`.
- **Test hook.** `window.__state()` returns `{turn, current, me, arena}` (the arena from
  `game.arena()`, `me` our team) or `null` before the game starts. It is read-only. The e2e test
  (`npm run e2e`) serves `dist/`, drives pages through the real Nostr lobby and Trystero WebRTC,
  and after every turn requires `{turn, current, arena}` to be identical on all pages.

## Consequences

- Arena sizes cannot be tuned per game without a new build; that is intended.
- The e2e test depends on the public Nostr relays and on WebRTC between pages on one machine,
  so it can fail when a relay is down. It is not part of `npm test`.
