# 2. Deterministic lockstep simulation in Rust/WASM

Status: Accepted (2026-11-09)

## Context

Peers exchange only formulas and a few control messages, never state. Every peer must
therefore compute an identical arena and identical shot outcomes from identical inputs.

## Decision

- The host picks a random `u64` seed (`crypto.getRandomValues`) and sends it in `start`
  (as a decimal string, since JSON has no BigInt). The arena is generated from it with the
  existing seeded `SmallRng` path in `Game::init`.
- Everything that affects an outcome (formula parsing, trajectory sampling, collisions,
  craters, eliminations, turn order) runs in Rust inside the WASM module. TypeScript only
  renders the results and forwards messages; no JS `Math` touches game state.
- f64 on wasm32 is deterministic: basic operations and `sqrt` are IEEE-754 exact, and
  transcendental functions (`sin`, `exp`, `powf`, ...) are compiled into the module from
  Rust's libm rather than calling the browser's `Math`, so every browser gets the same bits.
  Non-finite values end a shot, so NaN payload differences never matter.
- Same inputs need the same binary. `Cargo.lock` is committed (it is gitignored today) so
  rebuilds cannot silently change `rand`'s algorithms, and all peers load the same deployed
  bundle (ADR 10).

## Consequences

- No state sync or hashing protocol is needed; this is lockstep by construction.
- `SmallRng` is Xoshiro256++ on 64-bit native and Xoshiro128++ on wasm32, so native
  `cargo test` arenas differ from in-browser arenas. Tests assert same-seed reproducibility
  within one target, never hardcoded positions.
- Peers running different deployed versions (a stale cached tab) would silently diverge.
  We accept this rather than add a version handshake; add one if it shows up in practice.
