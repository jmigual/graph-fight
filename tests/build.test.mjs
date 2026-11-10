// Run: node --experimental-strip-types --no-warnings tests/build.test.mjs
// A build announces on the live lobby topic only when GRAPH_FIGHT_LOBBY=live (ADR 12).
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DEV_TOPIC, LIVE_TOPIC, lobbyTopic } from "../scripts/lobby-topic.mjs";

assert.notEqual(DEV_TOPIC, LIVE_TOPIC);
assert.equal(lobbyTopic({}), DEV_TOPIC, "default is dev");
for (const v of ["", "Live", "true", "1", "dev"]) assert.equal(lobbyTopic({ GRAPH_FIGHT_LOBBY: v }), DEV_TOPIC, `"${v}" is dev`);
assert.equal(lobbyTopic({ GRAPH_FIGHT_LOBBY: "live" }), LIVE_TOPIC);

// The bundled net layer carries the topic the define sets, and the dev one without a define.
async function bundled(define) {
    const { outputFiles } = await build({ entryPoints: ["js/net.ts"], bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent", define });
    return outputFiles[0].text;
}
const quoted = (t) => JSON.stringify(t);
// The live topic is in the bundle only with the opt-in (the fallback in net.ts stays as dead code).
for (const [define, live] of [
    [{}, false],
    [{ __LOBBY_TOPIC__: quoted(lobbyTopic({})) }, false],
    [{ __LOBBY_TOPIC__: quoted(lobbyTopic({ GRAPH_FIGHT_LOBBY: "live" })) }, true],
]) {
    const js = await bundled(define);
    assert.equal(js.includes(quoted(LIVE_TOPIC)), live, `live topic present: ${live}`);
    assert.equal(js.includes(quoted(DEV_TOPIC)), true, "dev topic is the net.ts fallback");
}
console.log("build tests passed");
