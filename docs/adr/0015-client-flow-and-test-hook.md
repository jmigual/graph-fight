# 15. Client constants, room flow, turn clock and test hook

Status: Accepted (2026-11-09)

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
  leaves. `xy` fixes seats at 2. Games that are full or on another build get no Join button.
- **Start.** The host enables Start with 2 or more players, takes `[host, ...connected]` cut to
  `seats`, relays `start` (seed from `crypto.getRandomValues`, as a decimal string) and then
  withdraws its listing. A connected peer that did not get a seat sees "game full".
- **End screen.** Winner, draw (nobody left), "host left", "desynced", "version mismatch".
  The board stays visible below the message. Back to lobby leaves the room.
