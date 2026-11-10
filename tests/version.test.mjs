// Run: node --experimental-strip-types --no-warnings tests/version.test.mjs
// Peers compare the exact build id; the footer shows the plain release version (ADR 28).
import assert from "node:assert/strict";
import { buildId, buildVersion, nextMinor } from "../scripts/version.mjs";

assert.equal(nextMinor("0.3.0"), "0.4.0");
assert.equal(nextMinor("0.3.7"), "0.4.0", "a patch release resets the patch");
assert.equal(nextMinor("0.9.0"), "0.10.0", "numeric, not text");

const entries = [{ version: "0.3.1" }, { version: "0.3.0" }];
const live = { GRAPH_FIGHT_LOBBY: "live" };
assert.equal(buildVersion(entries, "1a2b3c4", live), "0.3.1");
assert.equal(buildId(entries, "1a2b3c4", live), "0.3.1+1a2b3c4");
assert.equal(buildVersion(entries, "1a2b3c4", {}), "0.4.0-dev+1a2b3c4");
assert.equal(buildId(entries, "1a2b3c4", {}), "0.4.0-dev+1a2b3c4", "a dev build shows its whole id");
// Only the exact opt-in makes a release; anything else is a dev build.
for (const v of ["", "Live", "true", "1", "dev"]) {
    const env = { GRAPH_FIGHT_LOBBY: v };
    assert.equal(buildId(entries, "1a2b3c4", env), "0.4.0-dev+1a2b3c4", `"${v}" is dev`);
    assert.equal(buildVersion(entries, "1a2b3c4", env), "0.4.0-dev+1a2b3c4", `"${v}" is dev`);
}
// Two deploys of one release, or two dev builds, with different sources never share an id, so the
// compatibility check stays exact; the footer still shows the same release version.
for (const env of [live, {}]) assert.notEqual(buildId(entries, "aaaaaaa", env), buildId(entries, "bbbbbbb", env));
assert.equal(buildVersion(entries, "aaaaaaa", live), buildVersion(entries, "bbbbbbb", live));
console.log("version tests passed");
