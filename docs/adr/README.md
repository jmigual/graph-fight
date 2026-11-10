# ADR index

Read this instead of opening every ADR. Each new ADR adds a row here (and a line in "Where to look" if it opens a topic).

| # | Title | Status | Decision |
|---|-------|--------|----------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted | Short Nygard-format ADRs in `docs/adr/`; replaced ones are marked superseded, never deleted. |
| [0002](0002-deterministic-lockstep-in-wasm.md) | Deterministic lockstep in Rust/WASM | Accepted | Peers exchange seed and formulas only; all outcome logic runs in WASM with libm floats; `Cargo.lock` committed. |
| [0003](0003-hand-written-formula-parser.md) | Hand-written formula parser | Accepted | `src/formula.rs` recursive-descent parser replaces `meval`; no implicit multiplication, typed `ParseError`; `theta`/`th` alias `θ`, `π` aliases `pi`. |
| [0004](0004-shot-model.md) | Shot model (XY) | Superseded in part by 0020 | Curve anchored at the shooter, sampled at ≤0.05 spacing; ends at obstacle (crater), field edge or non-finite; players die on hit. |
| [0005](0005-disc-field-and-polar-shots.md) | Disc field and polar shots | Superseded in part by 0014, 0020 | Host picks `Xy` (2 teams) or `Disc` (≥2); polar `r=f(θ)` / `r(t),θ(t)`; frame and direction now per 0020. |
| [0006](0006-trystero-nostr-lobby-and-mesh.md) | Trystero over Nostr: lobby and mesh | Superseded in part by 0012 | Game rooms are Trystero (WebRTC mesh, Nostr signalling), room `game-<selfId>`; lobby part replaced by 0012. |
| [0007](0007-wire-protocol-and-turn-authority.md) | Wire protocol and turn authority | Superseded in part by 0012 | JSON messages `start`/`shot`/`timeout`/`leave` with turn counter; shooter-broadcast replaced by host relay (0012). |
| [0008](0008-rust-ts-api-surface.md) | Rust/TypeScript API surface | Superseded in part by 0014, 0020; amended by 0021 | One `Game` wasm-bindgen surface (`fire`, `fire_param`, `skip_turn`, `eliminate_team`, `winner`, `arena`); errors/direction per 0014; `frame` constructor argument per 0020. |
| [0009](0009-build-and-test-tooling.md) | Build and test tooling | Accepted; bundling superseded in part by 0019 | Keep webpack + wasm-pack (now esbuild, 0019); `npm test` = `cargo test` + Node tests in `tests/*.test.mjs`; `npm run e2e` = Playwright multi-page P2P matches; Rust edition 2024. |
| [0010](0010-hosting-github-pages-custom-domain.md) | GitHub Pages hosting | Accepted | Actions workflow tests, builds and deploys `dist/` to graph-fight.marceigual.eu on push to `master`; e2e not in CI. |
| [0011](0011-game-construction-errors-and-disc-placement.md) | Construction errors and disc placement | Accepted | `Game::new` returns `Result<_, GameError>`; direct sector sampling for disc players; obstacles fully inside disc. |
| [0012](0012-net-layer-host-relay-nostr-lobby-version-check.md) | Net layer: host relay, Nostr lobby, version check | Superseded in part by 0016, 0020; amended by 0021, 0022, 0023, 0024 | Host sequences and relays all messages (`{seq,msg}`), owns the turn clock; plain-Nostr lobby (live topic only in the deploy build, other builds use `:dev`); build-version gate. |
| [0013](0013-bump-webpack-for-externref-wasm.md) | Bump webpack for externref wasm | Superseded by 0019 | Upgrade webpack to 5.112 so it parses externref/multivalue wasm; no config change. |
| [0014](0014-shot-engine-details.md) | Shot engine and turn details | Superseded in part by 0020 | `FireError`, `check`/`check_param`, turn rotation, elimination, `clockwise` flag (θ→−θ) on disc, `winner()` semantics. |
| [0015](0015-client-flow-and-test-hook.md) | Client flow and test hook | Superseded in part by 0016, 0020; amended by 0017, 0021, 0022, 0024 | Arena constants in `js/index.ts`; lobby/start/end flow (the announce and `start` carry `frame`, 0020); host 60 s turn clock; read-only `window.__state()` for e2e. |
| [0016](0016-reconnection-and-log-replay.md) | Reconnection and log replay | Accepted; amended by 0018, 0021, 0022, 0023, 0024 | Seat tokens in `sessionStorage`; `rejoin` replays host's full log; dropped link keeps seat; explicit `quit` eliminates. |
| [0017](0017-ui-ux-design.md) | UI and UX design | Accepted; amends 0015; amended by 0021, 0022, 0023, 0024 | Graph paper on the map's axes with the shooter's start (`x` or `θ₀`) and sweep (per 0020), CSS tokens, emoji-face players, formula editor, saved formulas/templates with sliders, e2e selectors; each character's last shot stays on the board (faint) and refills the editor on its next turn; a footer shows the build version; typing `theta`/`pi` in a formula input gives `θ`/`π`. |
| [0018](0018-reconnect-watchdog.md) | Reconnect watchdog | Accepted; amends 0016; amended by 0024 | A seated guest whose host link stays down 25 s leaves and rejoins the game room (wait doubling: 25, 50, 100 s), and ends the game "Host unreachable." after 3 min; works around a Trystero 0.26.0 stale-offer stall; guests leave the room when the game ends. |
| [0019](0019-esbuild-instead-of-webpack.md) | esbuild instead of webpack | Accepted; supersedes 0013 and bundling in 0009 | `wasm-pack --target web` + `scripts/build.mjs` (esbuild ESM bundle, `await init()`); `tsc --noEmit` (TypeScript 7) inside `npm run build`. |
| [0020](0020-shot-frame-map-or-player.md) | Shot frame: map- or player-centred | Accepted; supersedes in part 0004, 0005, 0008, 0012, 0014, 0015 | Host option `frame` (`Frame { Map, Player }`, in `start` and the lobby listing), default map-centred; player-centred is the ADR 4/5 shooter frame. Map-centred: formulas in map coordinates offset to pass through the shooter (Graphwar): `y = f(x) − f(x_p) + y_p` with `x` sweeping toward the other half, no mirror; disc `θ₀` in `[0, 2π]`, `r = f(θ) − f(θ₀) + r_p` over one turn, clockwise sweeps θ down; parametric modes offset by their value at `t = 0`; negative `r` crosses the centre. |
| [0021](0021-bots.md) | Bot players, run by the host | Accepted; amends 0008, 0012, 0015, 0016, 0017; amended by 0022 | The host adds Easy/Medium/Hard bots to seats (`bot:<level>:<n>` in `start.peers`, never bound by the seat book) and relays their shots like a human's; the search over the starters runs in Rust (`Bot`, chunked `think`) on a copy of the game with its own RNG, seeded from `rand`'s thread generator, never from the game. |
| [0022](0022-local-players.md) | Local players (hot seat) | Accepted; amends 0012, 0015, 0016, 0017, 0021 | The host adds local players to seats (`local:<n>` in `start.peers`, never bound by the seat book); on the host their turns use the host's editor ("Local 2's turn" in the status bar and title, and "Host's turn" for the host's own) and their shots go through `acceptShot` with the local seat id. Only the host can add them. |
| [0023](0023-kick.md) | Kick | Accepted; amends 0012, 0016, 0017 | The host removes a guest: Remove in the waiting room, Kick in the roster. The peer gets `{type: "kick"}` (host only) and its id is ignored for this hosting (not after a rehost); in a game the seat token is revoked and `leave {peer: seat}` is relayed, as for a quit. A reload brings a new peer id, so keeping someone out needs a private game hosted again with a new secret. |
| [0024](0024-private-games.md) | Private games: password or private link | Accepted; amends 0012, 0015, 0016, 0017, 0018 | Visibility Public/Password/Private link. Both join the game room with Trystero's `password` (a wrong one never connects); any guest that has not reached the host joins the room again after 25 s and ends 50 s later; a password game is listed with `locked`, a private-link game (128-bit random key) is not listed. Invite link `#join=<hostId>&key=<key>&v=<build>`, read then removed from the address bar; the stored seat keeps the key. |

## Where to look

- Determinism, lockstep, seeds, float behaviour: 0002
- Formula syntax and parser: 0003
- Shot model, sampling, collisions, turn rotation, elimination: 0004, 0014; frame option and anchoring 0020
- Disc field, polar shots, shot direction (clockwise): 0020, then 0005, 0014; 0011 (placement)
- Rust/TS API (`Game`, `fire`, errors): 0008, 0014, 0011, 0020 (`Frame`), 0021 (`Bot`)
- Network: lobby 0012 (0006 for rooms); wire messages 0007 then 0012; turn authority and clock 0012, 0015; reconnection/rejoin/leave 0016, 0018
- Client flow, arena constants, `window.__state()` test hook: 0015
- UI/UX, theme, board drawing, formula editor, saved formulas, selectors for e2e: 0017
- Bots (seat ids, search, levels, solo play): 0021
- Local players (hot seat): 0022
- Kicking a guest: 0023
- Private games (password, invite link): 0024
- Build (esbuild, wasm-pack web target, TypeScript type check), test, CI, deploy, hosting: 0019, 0009, 0010 (0013 is superseded)

When the text of an ADR says "Superseded in part", read the superseding ADR for the current rule.
