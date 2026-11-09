// Run: node --experimental-strip-types --no-warnings tests/net.test.mjs
import assert from "node:assert/strict";
import { MAX_PLAYERS, parseGameMsg, routeIncoming, sequencer } from "../js/net.ts";

// Valid game messages round-trip.
const start = { type: "start", seed: "s", field: "disc", peers: ["h", "p"] };
assert.deepEqual(parseGameMsg({ type: "shot", turn: 3, exprs: ["x"] }), { type: "shot", turn: 3, exprs: ["x"] });
assert.deepEqual(parseGameMsg({ type: "shot", turn: 0, exprs: ["a", "b"] }), { type: "shot", turn: 0, exprs: ["a", "b"] });
assert.deepEqual(parseGameMsg({ type: "timeout", turn: 1 }), { type: "timeout", turn: 1 });
assert.deepEqual(parseGameMsg({ type: "leave", peer: "p" }), { type: "leave", peer: "p" });
assert.deepEqual(parseGameMsg(start), start);
assert.ok(parseGameMsg({ type: "shot", turn: 0, exprs: ["x".repeat(256)] }), "formula at the cap");
assert.ok(parseGameMsg({ ...start, peers: Array(MAX_PLAYERS).fill("p") }), "peers at the cap");

// Malformed or oversized input is dropped, one row per cap.
for (const bad of [
    null, 7, "shot", [], {}, { type: "nope" },
    { type: "shot", turn: -1, exprs: ["x"] },
    { type: "shot", turn: 1.5, exprs: ["x"] },
    { type: "shot", turn: 1, exprs: [] },
    { type: "shot", turn: 1, exprs: ["a", "b", "c"] },
    { type: "shot", turn: 1, exprs: [1] },
    { type: "shot", exprs: ["x"] },
    { type: "shot", turn: 0, exprs: ["x".repeat(257)] },
    { type: "shot", turn: 0, exprs: ["x", "x".repeat(257)] },
    { type: "timeout", turn: "1" },
    { type: "leave" },
    { type: "leave", peer: "p".repeat(65) },
    { ...start, field: "hex" },
    { ...start, peers: [] },
    { ...start, peers: [1] },
    { ...start, peers: Array(MAX_PLAYERS + 1).fill("p") },
    { ...start, peers: ["p".repeat(65)] },
    { ...start, seed: "s".repeat(65) },
]) assert.equal(parseGameMsg(bad), undefined, JSON.stringify(bad));

// Routing: only the host's sequenced broadcasts are delivered; the host also takes bare shot
// requests from others; nothing else gets through.
const shot = { type: "shot", turn: 0, exprs: ["x"] };
const timeout = { type: "timeout", turn: 0 };
const leave = { type: "leave", peer: "p" };
for (const m of [shot, timeout, leave, start]) {
    assert.deepEqual(routeIncoming("h", "p", "h", { seq: 4, msg: m }), { kind: "relayed", seq: 4, msg: m }, "host to peer");
    assert.equal(routeIncoming("h", "p", "h", m), undefined, "host message without seq");
    assert.equal(routeIncoming("h", "p", "q", { seq: 4, msg: m }), undefined, "peer to peer");
    assert.equal(routeIncoming("h", "h", "q", { seq: 4, msg: m }), undefined, "relayed envelope from a non-host");
}
assert.equal(routeIncoming("h", "p", "h", { seq: -1, msg: shot }), undefined);
assert.equal(routeIncoming("h", "p", "h", { seq: 1, msg: { type: "nope" } }), undefined);
assert.deepEqual(routeIncoming("h", "h", "p", shot), { kind: "request", shot });
for (const m of [timeout, leave, start]) assert.equal(routeIncoming("h", "h", "p", m), undefined, m.type);
assert.equal(routeIncoming("h", "p", "q", shot), undefined, "a shot request at a non-host");

// Sequencer: drops everything before start, delivers in order, drops repeats, flags gaps.
function run() {
    const log = { got: [], desync: 0 };
    return { log, accept: sequencer((m) => log.got.push(m.type), () => log.desync++) };
}
let t = run();
t.accept(5, shot);
t.accept(0, timeout);
t.accept(1, leave);
assert.deepEqual(t.log, { got: [], desync: 0 }, "late joiner: nothing before start");
t.accept(0, start);
t.accept(1, shot);
t.accept(1, shot);
t.accept(0, start);
t.accept(2, leave);
assert.deepEqual(t.log, { got: ["start", "shot", "leave"], desync: 0 }, "in order, repeats dropped");
t.accept(4, shot);
assert.deepEqual(t.log, { got: ["start", "shot", "leave"], desync: 1 }, "gap flags desync");

t = run();
t.accept(0, start);
t.accept(2, leave);
assert.deepEqual(t.log, { got: ["start"], desync: 1 }, "missed message right after start");

console.log("net tests ok");
