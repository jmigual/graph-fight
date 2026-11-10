// Run: node --experimental-strip-types --no-warnings tests/build.test.mjs
// A build announces on the live lobby topic only when GRAPH_FIGHT_LOBBY=live (ADR 12).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { DEV_TOPIC, LIVE_TOPIC, lobbyTopic } from "../scripts/lobby-topic.mjs";
import { VERSIONED_MEDIA, contentHash, versionMedia } from "../scripts/versioned-media.mjs";

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

// Compatibility uses the exact build id, never the display version (ADR 28): the invite link carries
// `__BUILD_ID__` even when `__BUILD_VERSION__` is the same for two builds.
const net = await import(`data:text/javascript;base64,${Buffer.from(await bundled({ __BUILD_ID__: quoted("0.4.0+abc1234"), __BUILD_VERSION__: quoted("0.4.0") })).toString("base64")}`);
assert.equal(net.BUILD_ID, "0.4.0+abc1234");
assert.equal(net.BUILD_VERSION, "0.4.0");
assert.equal(new URLSearchParams(net.inviteFragment("h", "k").slice(1)).get("v"), "0.4.0+abc1234");
// The built page names the demo video and poster with a hash of their content, so a re-recording is a new URL (ADR 29).
const built = versionMedia(readFileSync("static/index.html", "utf8"), "static");
for (const file of VERSIONED_MEDIA) {
    const hash = contentHash("static", file);
    assert.match(hash, /^[0-9a-f]{8}$/);
    assert.ok(built.includes(`"./${file}?v=${hash}"`), `${file} is versioned`);
    assert.ok(!built.includes(`"./${file}"`), `no bare ${file} left`);
}
// An e2e page may add a suffix to the lobby topic (ADR 33), but only on a dev build; the live build ignores it.
let loaded = 0;
async function topicWith(define, suffix) {
    globalThis.__lobbySuffix = suffix;
    // The comment makes each source a new module, so the data URL is not served from the import cache.
    const js = `${await bundled(define)}\n// ${loaded++}`;
    return (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).LOBBY_TOPIC;
}
const dev = { __LOBBY_TOPIC__: quoted(DEV_TOPIC) };
const live = { __LOBBY_TOPIC__: quoted(LIVE_TOPIC) };
assert.equal(await topicWith(dev, undefined), DEV_TOPIC, "no suffix: the build topic");
assert.equal(await topicWith({}, "run1-A"), `${DEV_TOPIC}:run1-A`, "dev topic, also without a define, takes the suffix");
assert.equal(await topicWith(dev, "run1-A"), `${DEV_TOPIC}:run1-A`, "dev build takes the suffix");
assert.equal(await topicWith(dev, ""), DEV_TOPIC, "an empty suffix is ignored");
assert.equal(await topicWith(dev, 5), DEV_TOPIC, "a suffix that is not a string is ignored");
assert.equal(await topicWith(live, "run1-A"), LIVE_TOPIC, "the live build ignores the suffix");
delete globalThis.__lobbySuffix;
console.log("build tests passed");
