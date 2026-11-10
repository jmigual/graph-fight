# 28. Release versions and the changelog

Status: Accepted (2026-11-10). Amends 0012 (the build id), 0017 (the footer) and 0010 (the
deploy guard). Amended by 0031 (release checks in CI).

## Context

The build version was the commit hash (ADR 12), which tells players nothing: they cannot tell a
newer build from an older one or see what changed. Peers still need an exact-match id for the
compatibility check.

## Decision

- Releases are numbered `0.minor.patch`: a feature bumps the minor version, a fix the patch. 0.1.0
  is the first deploy (master at 96c7f8d), 0.2.0 added bots (a6e072c), 0.3.0 is tagged at ff6e91a
  (it still showed the commit hash). 0.4.0 is the first release with this scheme.
- `CHANGELOG.md` at the repo root is the only source of versions and their notes. Format: a
  `# Changelog` title, then `## 0.3.0 — 2026-11-10` headings, newest first, each with `- ` bullets
  and nothing else; `code` spans are the only inline markup. The top entry is the current release.
  `package.json` has no `version` field (nothing reads it; `Cargo.toml`'s is unused too), so there
  is no second copy to keep in sync.
- `scripts/changelog.mjs` parses that format (no Markdown dependency) and throws a `ChangelogError` on anything
  else, on versions that do not strictly descend, on invalid dates, on versions with
  leading zeros and on an entry without notes; it accepts CRLF and a BOM. `scripts/build.mjs` runs
  it and writes `dist/changelog.html`: one `<section>` per version under a `Changelog` heading
  (without `aria-labelledby`, so a long history is not a long list of region landmarks; the `h2`
  headings give the structure), with a "Back to the game" link, styled by `static/style.css` and its ADR 17 tokens in light and
  dark.
- `scripts/version.mjs` computes two esbuild defines:
  - `__BUILD_ID__`, the exact id peers compare (lobby listings, `start`, invite links, the stored
    seat; ADR 12): `<top CHANGELOG version>+<hash>` for a release, e.g. `0.4.0+1a2b3c4`, and the next
    minor plus `-dev+` and the hash for any other build, e.g. `0.5.0-dev+1a2b3c4`. The hash is ADR
    12's commit hash or content hash, so two deploys of one release (master moves between releases)
    are incompatible and never desync silently;
  - `__BUILD_VERSION__`, for display only and never compared: the plain version for a release
    (`0.4.0`), the whole id for a dev build.

  A release build is the one with `GRAPH_FIGHT_LOBBY=live`, the same opt-in as the live lobby
  topic (ADR 12), decided by `lobbyTopic()`. A forgotten flag gives a dev id and the dev topic
  together, so a dev build never looks like a release.
- The footer (`<footer><a id="build">`) shows `v 0.4.0` as a link to `changelog.html`, opened in
  a new tab so a game in progress keeps its connections. Its accessible name is "v 0.4.0,
  changelog, opens in a new tab", which contains the visible text (WCAG 2.5.3).
- `pages.yml` keeps the live-topic check and adds one: the deploy fails unless `dist/index.js`
  holds `"<top CHANGELOG version>+` (read through the parser) and no `-dev+`, and
  `dist/changelog.html` has the version's heading. Checks that must fail use
  `if grep …; then exit 1; fi`, since a `!` command does not stop a `bash -e` script.

Release process:
1. A release PR adds the CHANGELOG entry (short, player-facing) with the new version and date.
2. After it merges to `master`, the deploy runs; tag the merge commit `v<version>`.
3. Work in between needs no CHANGELOG edit: local builds already show the next minor as dev.

## Consequences

- Two peers on different builds are incompatible, including two deploys of one release and a
  release against a dev build; two dev builds of the same commit stay compatible, as before (ADR 12).
- Forgetting the CHANGELOG entry in a release PR deploys the previous version again, under a new
  id, and the tag `v<version>` was not checked against the deployed commit; both are now checked
  in CI (0031).
- `GRAPH_FIGHT_LOBBY=live` now means "release build", which is why one flag decides topic and
  version.
- e2e runs against a dev build, so e2e AK and `assertBuild` check `x.y.z-dev+hash` in the footer and
  the announced id, and that the footer link opens the changelog page listing 0.1.0 to 0.3.0.
