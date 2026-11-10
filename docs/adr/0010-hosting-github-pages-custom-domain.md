# 10. Hosting on GitHub Pages at graph-fight.marceigual.eu

Status: Accepted (2026-11-09)
Amended by 0028: after the build, a step fails the deploy unless `dist/` holds the version at the top of
`CHANGELOG.md` and no `-dev+` version.

## Context

The game must be free to host and serverless. The user owns `marceigual.eu` and wants the
game at `https://graph-fight.marceigual.eu`.

## Decision

- Deploy `dist/` to GitHub Pages from `.github/workflows/pages.yml` on pushes to `master`.
  Steps: checkout, Rust stable with the `wasm32-unknown-unknown` target (cached with
  `Swatinem/rust-cache`), `wasm-pack` via `taiki-e/install-action`, Node 22, `npm ci`,
  `npm test`, `npm run build`, and `actions/upload-pages-artifact` (path `dist`); then
  `actions/deploy-pages` in a separate job. The build job has only `contents: read`; the
  deploy job adds `pages: write` and `id-token: write`, under the `github-pages` environment.
  `actions/configure-pages` is omitted: it only yields a base path, which is not needed.
- The site is served at the domain root, so the current root-relative build works unchanged.
  No base-path config.
- The custom domain is set in repo Settings, Pages, Custom domain. With Actions-based
  deployment a `CNAME` file in the artifact is ignored, so none is added. DNS needs a CNAME
  record `graph-fight` pointing to `jmigual.github.io`. Enable "Enforce HTTPS" once the
  certificate is issued. Pages "Source" must be set to "GitHub Actions".
- The e2e test is not run in CI (public relay dependency, ADR 9).

## Consequences

- Zero hosting cost, and HTTPS is provided. HTTPS is a requirement for WebRTC and
  `crypto.getRandomValues` in a secure context.
- Every peer loads the same deployed bundle, which ADR 2 relies on. A stale cached tab across a
  deploy is the accepted residual risk.
