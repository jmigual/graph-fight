// Run: node --experimental-strip-types --no-warnings tests/net.test.mjs
import assert from "node:assert/strict";
import { lobbyBook, MAX_PLAYERS, parseGameMsg, parseListing, parseRelayEvent, routeIncoming, sequencer, versionGate } from "../js/net.ts";

// Valid game messages round-trip.
const start = { type: "start", seed: "s", field: "disc", peers: ["h", "p"], version: "v1" };
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
    { ...start, version: undefined },
    { ...start, version: "v".repeat(65) },
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

// Version gate: a start from another build is not delivered; other messages pass.
const seen = [];
const gated = versionGate("v1", (m) => seen.push(m.type), (v) => seen.push(`mismatch:${v}`));
gated(start);
gated({ ...start, version: "v0" });
gated(shot);
assert.deepEqual(seen, ["start", "mismatch:v0", "shot"]);

// Lobby listings: shape and size caps.
const listing = { id: "h", version: "v1", name: "n", field: "xy", players: 1, seats: 2 };
assert.deepEqual(parseListing(listing), listing);
assert.ok(parseListing({ ...listing, name: "n".repeat(64), players: MAX_PLAYERS, seats: MAX_PLAYERS }), "at the caps");
for (const bad of [
    null, {}, { ...listing, id: 1 }, { ...listing, field: "q" }, { ...listing, players: "1" }, { ...listing, seats: -1 },
    { ...listing, name: "n".repeat(65) },
    { ...listing, id: "i".repeat(65) },
    { ...listing, version: undefined },
    { ...listing, version: "v".repeat(65) },
    { ...listing, players: MAX_PLAYERS + 1 },
    { ...listing, seats: MAX_PLAYERS + 1 },
]) assert.equal(parseListing(bad), undefined, JSON.stringify(bad));

// Lobby book: refresh, own game, malformed, expiry, withdraw, size bound.
const book = lobbyBook("me", "v1", 10_000);
assert.equal(book.apply("k1", listing, 0), true);
assert.equal(book.apply("k1", listing, 3000), false, "refresh without change");
assert.equal(book.apply("k1", { ...listing, players: 2 }, 4000), true, "changed");
assert.equal(book.apply("k2", { ...listing, id: "g", version: "v0" }, 4000), true);
assert.deepEqual(book.list().map((g) => [g.id, g.compatible]), [["h", true], ["g", false]], "version filter");
assert.equal(book.apply("k3", { ...listing, id: "me" }, 4000), false, "own game ignored");
assert.equal(book.apply("k3", { nope: 1 }, 4000), false, "malformed ignored");
assert.equal(book.expire(13_999), false);
assert.equal(book.expire(14_000), true, "both entries last refreshed at 4000");
assert.deepEqual(book.list(), []);
book.apply("k1", listing, 20_000);
assert.equal(book.apply("k1", { withdraw: true }, 21_000), true);
assert.equal(book.apply("k1", { withdraw: true }, 21_000), false, "already gone");
assert.deepEqual(book.list(), []);

const full = lobbyBook("me", "v1");
for (let i = 0; i < 100; i++) assert.equal(full.apply(`k${i}`, { ...listing, id: `g${i}` }, 0), true);
assert.equal(full.apply("extra", listing, 0), false, "new key refused at the bound");
assert.equal(full.apply("k5", { ...listing, id: "g5", players: 2 }, 1), true, "existing key still refreshes");
assert.equal(full.list().length, 100);
assert.equal(full.apply("k5", { withdraw: true }, 2), true);
assert.equal(full.apply("extra", listing, 2), true, "room again after a withdraw");

// Relay frames.
const frame = (event) => JSON.stringify(["EVENT", "lobby", event]);
const pubkey = "a".repeat(64);
assert.deepEqual(parseRelayEvent(frame({ pubkey, content: JSON.stringify(listing) })), { pubkey, content: listing });
for (const bad of [
    "not json", "[]", JSON.stringify(["EOSE", "lobby"]),
    frame({ pubkey, content: "not json" }), frame({ content: "{}" }), frame(null),
    frame({ pubkey: "a".repeat(65), content: "{}" }),
    frame({ pubkey, content: JSON.stringify({ name: "n".repeat(5000) }) }),
]) assert.equal(parseRelayEvent(bad), undefined, bad.slice(0, 60));

console.log("net tests ok");
