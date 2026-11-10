// Run: node --experimental-strip-types --no-warnings tests/release.test.mjs
// The release checks of ADR 31: a new release needs a new CHANGELOG version, and a tag matches it.
import assert from "node:assert/strict";
import { ChangelogError } from "../scripts/changelog.mjs";
import { ReleaseCheckError, checkTagFree, checkTagVersion } from "../scripts/release-check.mjs";

const fails = (code, fn) => assert.throws(fn, (e) => e instanceof ReleaseCheckError && e.code === code);

// checkTagFree: a top version already tagged on another commit means the entry was forgotten.
const tags = { "v0.6.0": "aaa", "v0.7.0": "bbb" };
fails("tag-taken", () => checkTagFree("0.7.0", tags, "ccc"));
checkTagFree("0.7.0", tags, "bbb"); // a re-run of the tagged commit
checkTagFree("0.8.0", tags, "ccc"); // a new, untagged version
checkTagFree("0.7.0", {}, "ccc");

// checkTagVersion: the tag is v plus the CHANGELOG top entry.
const log = "# Changelog\n\n## 0.7.0 — 2026-11-10\n- b\n\n## 0.6.0 — 2026-11-01\n- a\n";
checkTagVersion("v0.7.0", log);
fails("tag-version", () => checkTagVersion("v0.6.0", log)); // an older entry is not the top
fails("tag-version", () => checkTagVersion("v0.8.0", log));
fails("tag-version", () => checkTagVersion("0.7.0", log)); // missing the v
fails("tag-version", () => checkTagVersion("v0.7.0-rc1", log));
assert.throws(() => checkTagVersion("v0.7.0", "# Changelog\n"), ChangelogError);
console.log("release tests passed");
