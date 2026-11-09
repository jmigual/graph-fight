# ADR index

Read this instead of opening every ADR. Each new ADR adds a row here (and a line in "Where to look" if it opens a topic).

| # | Title | Status | Decision |
|---|-------|--------|----------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted | Short Nygard-format ADRs in `docs/adr/`; replaced ones are marked superseded, never deleted. |
| [0002](0002-deterministic-lockstep-in-wasm.md) | Deterministic lockstep in Rust/WASM | Accepted | Peers exchange seed and formulas only; all outcome logic runs in WASM with libm floats; `Cargo.lock` committed. |
| [0003](0003-hand-written-formula-parser.md) | Hand-written formula parser | Accepted | `src/formula.rs` recursive-descent parser replaces `meval`; no implicit multiplication, typed `ParseError`. |
| [0004](0004-shot-model.md) | Shot model (XY) | Accepted | Curve anchored at the shooter, sampled at ≤0.05 spacing; ends at obstacle (crater), field edge or non-finite; players die on hit. |
| [0005](0005-disc-field-and-polar-shots.md) | Disc field and polar shots | Superseded in part by 0014 | Host picks `Xy` (2 teams) or `Disc` (≥2); polar `r=f(θ)` / `r(t),θ(t)` in shooter frame; direction now per 0014. |
| [0006](0006-trystero-nostr-lobby-and-mesh.md) | Trystero over Nostr: lobby and mesh | Superseded in part by 0012 | Game rooms are Trystero (WebRTC mesh, Nostr signalling), room `game-<selfId>`; lobby part replaced by 0012. |
| [0007](0007-wire-protocol-and-turn-authority.md) | Wire protocol and turn authority | Superseded in part by 0012 | JSON messages `start`/`shot`/`timeout`/`leave` with turn counter; shooter-broadcast replaced by host relay (0012). |
| [0008](0008-rust-ts-api-surface.md) | Rust/TypeScript API surface | Superseded in part by 0014 | One `Game` wasm-bindgen surface (`fire`, `fire_param`, `skip_turn`, `eliminate_team`, `winner`, `arena`); errors/direction per 0014. |
| [0009](0009-build-and-test-tooling.md) | Build and test tooling | Accepted; bundling superseded in part by 0019 | Keep webpack + wasm-pack (now esbuild, 0019); `npm test` = `cargo test` + Node tests in `tests/*.test.mjs`; `npm run e2e` = Playwright multi-page P2P matches; Rust edition 2024. |
| [0010](0010-hosting-github-pages-custom-domain.md) | GitHub Pages hosting | Accepted | Actions workflow tests, builds and deploys `dist/` to graph-fight.marceigual.eu on push to `master`; e2e not in CI. |
| [0011](0011-game-construction-errors-and-disc-placement.md) | Construction errors and disc placement | Accepted | `Game::new` returns `Result<_, GameError>`; direct sector sampling for disc players; obstacles fully inside disc. |
| [0012](0012-net-layer-host-relay-nostr-lobby-version-check.md) | Net layer: host relay, Nostr lobby, version check | Superseded in part by 0016 | Host sequences and relays all messages (`{seq,msg}`), owns the turn clock; plain-Nostr lobby; build-version gate. |
| [0013](0013-bump-webpack-for-externref-wasm.md) | Bump webpack for externref wasm | Superseded by 0019 | Upgrade webpack to 5.112 so it parses externref/multivalue wasm; no config change. |
| [0014](0014-shot-engine-details.md) | Shot engine and turn details | Accepted | `FireError`, `check`/`check_param`, turn rotation, elimination, `clockwise` flag (θ→−θ) on disc, `winner()` semantics. |
| [0015](0015-client-flow-and-test-hook.md) | Client flow and test hook | Superseded in part by 0016; amended by 0017 | Arena constants in `js/index.ts`; lobby/start/end flow; host 60 s turn clock; read-only `window.__state()` for e2e. |
| [0016](0016-reconnection-and-log-replay.md) | Reconnection and log replay | Accepted | Seat tokens in `sessionStorage`; `rejoin` replays host's full log; dropped link keeps seat; explicit `quit` eliminates. |
| [0017](0017-ui-ux-design.md) | UI and UX design | Accepted; amends 0015 | Graph paper in shooter's frame, CSS tokens, emoji-face players, formula editor, saved formulas/templates with sliders, e2e selectors. |
| [0019](0019-esbuild-instead-of-webpack.md) | esbuild instead of webpack | Accepted; supersedes 0013 and bundling in 0009 | `wasm-pack --target web` + `scripts/build.mjs` (esbuild ESM bundle, `await init()`); `tsc --noEmit` (TypeScript 7) inside `npm run build`. |

## Where to look

- Determinism, lockstep, seeds, float behaviour: 0002
- Formula syntax and parser: 0003
- Shot model, sampling, collisions, turn rotation, elimination: 0004, 0014
- Disc field, polar shots, shot direction (clockwise): 0005, 0014, 0011 (placement)
- Rust/TS API (`Game`, `fire`, errors): 0008, 0014, 0011
- Network: lobby 0012 (0006 for rooms); wire messages 0007 then 0012; turn authority and clock 0012, 0015; reconnection/rejoin/leave 0016
- Client flow, arena constants, `window.__state()` test hook: 0015
- UI/UX, theme, board drawing, formula editor, saved formulas, selectors for e2e: 0017
- Build (esbuild, wasm-pack web target, TypeScript type check), test, CI, deploy, hosting: 0019, 0009, 0010 (0013 is superseded)

When the text of an ADR says "Superseded in part", read the superseding ADR for the current rule.
