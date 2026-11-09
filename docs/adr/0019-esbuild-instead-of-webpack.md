# 19. esbuild instead of webpack

Status: Accepted (2026-11-10); supersedes 0013 and the bundling part of 0009

## Context

The webpack setup (ADR 9, 13) needed seven npm packages and a config that patched
`crypto.createHash`. The latest TypeScript, 7.0, is a native compiler with no JavaScript API, so
`ts-loader` cannot load it. The wasm was a webpack-managed async module, which is what broke on
externref wasm in ADR 13.

## Decision

- `npm run build:wasm`: `wasm-pack build --target web --out-name index` writes `pkg/`
  (`pkg/index.js` is the glue, `pkg/index_bg.wasm` the module).
- `scripts/build.mjs` (esbuild JS API): empties `dist/`, copies `static/`, copies
  `index_bg.wasm` into `dist/`, and bundles `js/index.ts` and `trystero` into `dist/index.js` as
  ESM (target es2022, minified). `define` sets `__BUILD_VERSION__` as `DefinePlugin` did: the
  short commit hash, or a hash of `js/` and `src/` outside a git checkout (ADR 12).
- `js/index.ts` runs `await init()`. The web-target glue fetches `index_bg.wasm` relative to
  `import.meta.url`, so it works from the domain root (ADR 10) and from the e2e static server.
  `static/index.html` loads the bundle with `<script type="module">`.
- `npm run build` = `build:wasm`, then `tsc --noEmit -p .`, then `scripts/build.mjs`. esbuild
  strips types without checking them, so the separate `tsc` step is what makes type errors fail
  the build and CI. `tsconfig.json` sets `verbatimModuleSyntax` (esbuild compiles each file alone)
  and target/lib ES2022.
- `npm start` builds the wasm once, then runs `scripts/build.mjs --serve`: esbuild watches the
  TypeScript and serves `dist/` on port 8080. After a Rust change run `npm run build:wasm`
  again; `static/` is copied once per start.
- TypeScript 7 is used only for `tsc`. Removed: webpack, webpack-cli, webpack-dev-server,
  `@wasm-tool/wasm-pack-plugin`, `copy-webpack-plugin`, `html-minimizer-webpack-plugin`,
  `ts-loader`, `rimraf`, and `webpack.config.js`.

## Consequences

- Bundling drops from seconds to tens of milliseconds, with one dev dependency instead of
  eight and no webpack parsing of wasm, so the toolchain-vs-parser problem of ADR 13 goes away.
- HTML and CSS are no longer minified (`dist/` is about 2 KB larger).
- No hot module replacement and no automatic Rust rebuild in `npm start`.
- The `.wasm` must stay next to `index.js` in `dist/`.
- `.github/workflows/pages.yml` is unchanged: it already runs `npm ci`, `npm test`,
  `npm run build` and uploads `dist/`.
