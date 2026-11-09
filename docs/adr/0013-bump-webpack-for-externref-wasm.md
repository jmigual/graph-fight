# 13. Bump webpack to parse externref wasm

Status: Accepted (2026-11-09)

## Context

With the current Rust toolchain (1.99) and wasm-bindgen, the generated wasm uses `externref`
and multivalue types. The `@webassemblyjs` parser bundled with webpack 5.91 cannot read them,
so `npm run build` failed with `parseVec could not cast the value`.

## Decision

Bump `webpack` to 5.112 (latest 5.x). Its parser handles the module, so `webpack.config.js`,
`experiments.asyncWebAssembly` and the wasm-pack plugin stay unchanged. The alternative,
`wasm-pack --target web` with the `.wasm` loaded as an asset, was not needed. Pinning an older
Rust toolchain was rejected.

## Consequences

- Build output now has a separate `.module.wasm` asset and a small async chunk.
- If a later toolchain emits features webpack cannot parse, the `--target web` route is the
  fallback.
