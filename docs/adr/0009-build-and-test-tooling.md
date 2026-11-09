# 9. Build and test tooling

Status: Accepted (2026-11-09)

## Context

The build already uses webpack 5, `@wasm-tool/wasm-pack-plugin` 1.7.0 (2023, still the
latest release), and `ts-loader`. `npm test` runs `wasm-pack test --headless`, which needs a
WebDriver and has no wasm tests to run. `trystero` is ESM-only (`exports` only, no `main`).

## Decision

- Keep webpack and the wasm-pack plugin. They work, and replacing them buys nothing.
- `tsconfig.json`: set `"module": "ESNext"` and `"moduleResolution": "bundler"` so TS resolves
  the ESM-only `trystero`.
- `npm test` runs `cargo test`, covering the engine, parser, and determinism.
  `npm run e2e` runs `npm run build && node tests/e2e.js`: a Node `http` static server
  (stdlib, with the `application/wasm` MIME type) plus Playwright Chromium. It opens several
  pages that play real P2P matches through Trystero and compares `canvas.toDataURL()` across
  pages after each turn. That works because trajectories are drawn without animation.
- Add `playwright` as a devDependency pinned to the version that matches the installed
  Chromium (revision 1252 in `~/.cache/ms-playwright`). It does not currently resolve from
  the repo.
- No hot-seat or local mode. Several Playwright pages in one browser are the cheaper test
  path.

## Consequences

- E2E depends on public Nostr relays and STUN, so it is not a CI gate (ADR 10). It runs
  locally before merging networking changes.
- `tests/offline.rs` (an empty pre-existing test) is left untouched.
