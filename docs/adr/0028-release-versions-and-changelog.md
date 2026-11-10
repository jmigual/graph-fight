# 28. Release versions and the changelog

Status: Accepted (2026-11-10). Amends 0012 (the build version), 0017 (the footer) and 0010 (the
deploy guard).

## Context

The build version was the commit hash (ADR 12), which tells players nothing: they cannot tell a
newer build from an older one or see what changed. Peers still need an exact-match version for the
compatibility check.

## Decision

- Releases are numbered `0.minor.patch`: a feature bumps the minor version, a fix the patch. 0.1.0
  is the first deploy (master at 96c7f8d), 0.2.0 added bots (a6e072c), 0.3.0 is the first with this
  scheme.
- `CHANGELOG.md` at the repo root is the only source of versions and their notes. Format: a
  `# Changelog` title, then `## 0.3.0 — 2026-11-10` headings, newest first, each with `- ` bullets
  and nothing else; `code` spans are the only inline markup. The top entry is the current release.
  `package.json` has no `version` field (nothing reads it; `Cargo.toml`'s is unused too), so there
  is no second copy to keep in sync.
- `scripts/changelog.mjs` parses that format (no Markdown dependency) and throws on anything else,
  on versions that do not strictly descend and on an entry without notes. `scripts/build.mjs` runs
  it and writes `dist/changelog.html`: one `<section>` per version under a `Changelog` heading,
  with a "Back to the game" link, styled by `static/style.css` and its ADR 17 tokens in light and
  dark.
- `scripts/version.mjs` computes the build version, the esbuild `__BUILD_VERSION__` define:
  - the release build is the top CHANGELOG version, e.g. `0.3.0`;
  - every other build is the next minor plus `-dev+` and the source hash (ADR 12's commit hash or
    content hash), e.g. `0.4.0-dev+1a2b3c4`.
  
  A release build is the one with `GRAPH_FIGHT_LOBBY=live`, the same opt-in as the live lobby
  topic (ADR 12), decided by `lobbyTopic()`. A forgotten flag gives a dev version and the dev
  topic together, so a dev build never looks like a release. The version stays an exact-match
  string, so the compatibility check is unchanged.
- The footer (`<footer><a id="build">`) shows `v 0.3.0` as a link to `changelog.html`, opened in
  a new tab so a game in progress keeps its connections. Its accessible name is "Version 0.3.0,
  view changelog, opens in a new tab".
- `pages.yml` keeps the live-topic check and adds one: the deploy fails unless `dist/index.js`
  holds the top CHANGELOG version as a quoted string and no `-dev+`, and `dist/changelog.html`
  has its heading.

Release process:
1. A release PR adds the CHANGELOG entry (short, player-facing) with the new version and date.
2. After it merges to `master`, the deploy runs; tag the merge commit `v<version>`.
3. Work in between needs no CHANGELOG edit: local builds already show the next minor as dev.

## Consequences

- Two peers on different releases, or a release and a dev build, are incompatible; two dev builds
  of the same commit stay compatible, as before (ADR 12).
- Forgetting the CHANGELOG entry in a release PR deploys the previous version again; nothing
  detects a code change without an entry.
- `GRAPH_FIGHT_LOBBY=live` now means "release build", which is why one flag decides topic and
  version.
- e2e runs against a dev build, so it checks `x.y.z-dev+hash`, and the changelog link and page.
