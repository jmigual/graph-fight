# 31. Release checks in CI

Status: Accepted (2026-11-10). Amends 0028 (release process) and 0010 (the deploy guard).

## Context

ADR 28 left two gaps: a release PR that forgets its CHANGELOG entry deploys the previous version
again under a new id, and nothing checks that the tag `v<version>` is on the deployed commit. Tags
are made locally and GPG-signed (CI cannot sign them), so CI cannot create them, only check them.

## Decision

- `scripts/release-check.mjs` holds the rules as pure functions that throw a `ReleaseCheckError`
  with a `code`, plus a small CLI the workflows call:
  - `checkTagFree(version, tags, headSha)` (`tag-taken`): fails if `v<top version>` is already
    tagged on a commit other than the one checked. `release-check.mjs free [sha]` also fails
    (`no-tags`) when the checkout has no tags at all, so a checkout that did not fetch them cannot
    pass for nothing;
  - `checkTagVersion(tag, changelogText)` (`tag-version`): the tag is `v` plus the top entry.
    `release-check.mjs tag <tag>` runs it on the CHANGELOG at the tagged commit, then fails
    (`not-on-master`) if that commit is not in `origin/master`.
- Gap 1, one rule in two places: `.github/workflows/release-check.yml` runs `free` on every pull
  request to `master`. The merge ref is never a tagged commit, so a release PR whose top version
  is already tagged fails before it merges. `pages.yml` runs `free` in the build job before the
  upload: a re-run or `workflow_dispatch` of the tagged commit passes, a later `master` push
  without a new entry fails and does not deploy. Both checkouts use `fetch-depth: 0`, which
  fetches tags. The error says to add a CHANGELOG entry.
- Gap 2: `.github/workflows/release-tag.yml` runs on every push of a tag `v*`. It runs `tag`, then
  asks `gh api` (the built-in token, `deployments: read`) for the `github-pages` deployments of the
  tagged commit and requires that some status of one of them is `success`. The newest status is
  not enough: a later deploy adds `inactive` to an older deployment (0.5.0 and 0.6.0 show
  `inactive,success,...`), which would fail a late tag or a re-run for a release that was fine.
- A pushed tag cannot be blocked, so a failed run is only a signal: after `git push origin
  v<version>`, watch it with `gh run watch`. A tag pushed before the deploy ends fails the
  deployment check; re-run it once the deploy is green.

Release process (0028 step 2, extended): after the deploy succeeds, tag the merge commit
`v<version>` with `git tag -s`, push it and watch the "Release tag" run.

## Consequences

- A forgotten CHANGELOG entry is caught at the PR, and again at deploy if it gets past.
- The workflows only run on GitHub: the pure rules are tested in `tests/release.test.mjs`, the
  fetched tags, the `gh api` calls and the tag-push trigger are not.
- Any PR to `master` with an already-tagged top version fails, not only release PRs; `master`
  takes releases only.
