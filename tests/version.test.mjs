// Run: node --experimental-strip-types --no-warnings tests/version.test.mjs
// Release builds carry the newest CHANGELOG version; every other build is the next minor plus dev (ADR 28).
import assert from "node:assert/strict";
import { buildVersion, nextMinor } from "../scripts/version.mjs";

assert.equal(nextMinor("0.3.0"), "0.4.0");
assert.equal(nextMinor("0.3.7"), "0.4.0", "a patch release resets the patch");
assert.equal(nextMinor("0.9.0"), "0.10.0", "numeric, not text");

const entries = [{ version: "0.3.1" }, { version: "0.3.0" }];
assert.equal(buildVersion(entries, "1a2b3c4", { GRAPH_FIGHT_LOBBY: "live" }), "0.3.1");
assert.equal(buildVersion(entries, "1a2b3c4", {}), "0.4.0-dev+1a2b3c4");
// Only the exact opt-in makes a release; anything else is a dev build.
for (const v of ["", "Live", "true", "1", "dev"]) {
    assert.equal(buildVersion(entries, "1a2b3c4", { GRAPH_FIGHT_LOBBY: v }), "0.4.0-dev+1a2b3c4", `"${v}" is dev`);
}
// Different sources never share a dev version, so the compatibility check stays exact.
assert.notEqual(buildVersion(entries, "aaaaaaa", {}), buildVersion(entries, "bbbbbbb", {}));
console.log("version tests passed");
