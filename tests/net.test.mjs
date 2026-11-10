// Run: node --experimental-strip-types --no-warnings tests/net.test.mjs
import assert from "node:assert/strict";
import { isBot, isHostRun, isLocal, lobbyBook, MAX_PLAYERS, outbox, parseBot, parseGameMsg, parseListing, parseLocal, parseRelayEvent, routeIncoming, seatBook, sequencer, versionGate } from "../js/net.ts";

// Valid game messages round-trip.
const start = { type: "start", seed: "s", field: "disc", frame: "map", peers: ["h", "p"], version: "v1" };
assert.deepEqual(parseGameMsg({ type: "shot", turn: 3, exprs: ["x"], cw: true }), { type: "shot", turn: 3, exprs: ["x"], cw: true });
assert.deepEqual(parseGameMsg({ type: "shot", turn: 0, exprs: ["a", "b"], cw: false }), { type: "shot", turn: 0, exprs: ["a", "b"], cw: false });
assert.deepEqual(parseGameMsg({ type: "timeout", turn: 1 }), { type: "timeout", turn: 1 });
assert.deepEqual(parseGameMsg({ type: "leave", peer: "p" }), { type: "leave", peer: "p" });
assert.deepEqual(parseGameMsg(start), start);
assert.deepEqual(parseGameMsg({ ...start, frame: "player" }), { ...start, frame: "player" });
assert.ok(parseGameMsg({ type: "shot", turn: 0, exprs: ["x".repeat(256)], cw: false }), "formula at the cap");
assert.ok(parseGameMsg({ ...start, peers: Array(MAX_PLAYERS).fill("p") }), "peers at the cap");

// Malformed or oversized input is dropped, one row per cap.
for (const bad of [
    null, 7, "shot", [], {}, { type: "nope" },
    { type: "shot", turn: -1, exprs: ["x"], cw: false },
    { type: "shot", turn: 1.5, exprs: ["x"], cw: false },
    { type: "shot", turn: 1, exprs: [], cw: false },
    { type: "shot", turn: 1, exprs: ["a", "b", "c"], cw: false },
    { type: "shot", turn: 1, exprs: [1], cw: false },
    { type: "shot", exprs: ["x"], cw: false },
    { type: "shot", turn: 0, exprs: ["x"] },
    { type: "shot", turn: 0, exprs: ["x"], cw: "true" },
    { type: "shot", turn: 0, exprs: ["x"], cw: 1 },
    { type: "shot", turn: 0, exprs: ["x".repeat(257)], cw: false },
    { type: "shot", turn: 0, exprs: ["x", "x".repeat(257)], cw: false },
    { type: "timeout", turn: "1" },
    { type: "leave" },
    { type: "leave", peer: "p".repeat(65) },
    { ...start, field: "hex" },
    { ...start, frame: "world" },
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
const shot = { type: "shot", turn: 0, exprs: ["x"], cw: false };
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

// Seat tokens come only from the host; rejoin and quit are requests only the host takes.
const token = "t".repeat(32);
assert.deepEqual(routeIncoming("h", "p", "h", { seat: token }), { kind: "seat", token });
assert.equal(routeIncoming("h", "p", "q", { seat: token }), undefined, "a seat token from a non-host");
assert.equal(routeIncoming("h", "p", "h", { seat: "t".repeat(65) }), undefined, "oversized token");
assert.deepEqual(routeIncoming("h", "h", "p", { type: "rejoin", token }), { kind: "rejoin", token });
assert.deepEqual(routeIncoming("h", "h", "p", { type: "quit" }), { kind: "quit" });
assert.equal(routeIncoming("h", "p", "q", { type: "rejoin", token }), undefined, "a rejoin at a non-host");
assert.equal(routeIncoming("h", "p", "q", { type: "quit" }), undefined, "a quit at a non-host");
for (const bad of [{ type: "rejoin" }, { type: "rejoin", token: 7 }, { type: "rejoin", token: "t".repeat(65) }]) {
    assert.equal(routeIncoming("h", "h", "p", bad), undefined, JSON.stringify(bad));
}

// A kick (ADR 23) only counts from the host; nobody else can remove a peer, and the host takes no kick request.
assert.deepEqual(routeIncoming("h", "p", "h", { type: "kick" }), { kind: "kicked" });
assert.equal(routeIncoming("h", "p", "q", { type: "kick" }), undefined, "a kick from a non-host");
assert.equal(routeIncoming("h", "h", "p", { type: "kick" }), undefined, "a kick sent to the host");
assert.equal(routeIncoming("h", "p", "h", { seq: 1, msg: { type: "kick" } }), undefined, "a kick is not a relayed game message");
for (const bad of [{ kick: true }, { type: "Kick" }, "kick"]) assert.equal(routeIncoming("h", "p", "h", bad), undefined, JSON.stringify(bad));

// Outbox: start once and first, invalid messages refused without consuming a number.
const box = outbox();
assert.throws(() => box.stamp(shot), /before start/, "nothing before start");
assert.equal(box.started(), false);
assert.throws(() => box.stamp({ ...start, seed: "s".repeat(65) }), /invalid/, "over-cap start refused");
assert.equal(box.started(), false, "a refused start does not start the game");
assert.deepEqual(box.stamp(start), { seq: 0, msg: start });
assert.equal(box.started(), true);
assert.throws(() => box.stamp(start), /already relayed/, "no second start");
assert.throws(() => box.stamp({ type: "shot", turn: 0, exprs: ["x".repeat(257)], cw: false }), /invalid/);
assert.deepEqual(box.stamp(shot), { seq: 1, msg: shot }, "refused messages consume no number");
assert.deepEqual(box.stamp(leave), { seq: 2, msg: leave });
assert.deepEqual(box.log, [{ seq: 0, msg: start }, { seq: 1, msg: shot }, { seq: 2, msg: leave }], "the log holds every stamped message, in order");

// Sequencer: drops everything before start, delivers in order, drops repeats, flags gaps and
// accepts a fresh run from seq 0 (a replay).
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
t.accept(2, leave);
assert.deepEqual(t.log, { got: ["start", "shot", "leave"], desync: 0 }, "in order, repeats dropped");
t.accept(4, shot);
assert.deepEqual(t.log, { got: ["start", "shot", "leave"], desync: 1 }, "gap flags desync");
t.accept(5, shot);
t.accept(3, timeout);
assert.deepEqual(t.log, { got: ["start", "shot", "leave"], desync: 1 }, "after a gap, everything waits for the replay");
for (const [seq, m] of [[0, start], [1, shot], [2, leave], [3, timeout], [4, shot]]) t.accept(seq, m);
t.accept(5, shot);
assert.deepEqual(t.log.got.slice(3), ["start", "shot", "leave", "timeout", "shot", "shot"], "the replay restarts from seq 0, then live messages follow");
assert.equal(t.log.desync, 1);

t = run();
t.accept(0, start);
t.accept(2, leave);
assert.deepEqual(t.log, { got: ["start"], desync: 1 }, "missed message right after start");

// Seat book: one 128-bit token per seat; a known token moves its seat to the new peer.
const seats = seatBook(["h", "p", "q"]);
assert.equal(seats.tokens[0], "", "the host gets no token");
assert.equal(new Set(seats.tokens).size, 3);
for (const tk of seats.tokens.slice(1)) assert.match(tk, /^[0-9a-f]{32}$/);
assert.equal(seats.rejoin("", "x"), false, "an empty token cannot claim the host's seat");
assert.equal(seats.seatOf("p"), "p");
assert.equal(seats.seatOf("x"), undefined);
assert.equal(seats.rejoin("nope", "x"), false, "unknown token");
assert.equal(seats.rejoin(seats.tokens[1].toUpperCase(), "x"), false, "tokens compare exactly");
assert.equal(seats.seatOf("x"), undefined, "an unknown token binds nothing");
assert.deepEqual(seats.absent((id) => id !== "q"), ["q"]);
assert.equal(seats.rejoin(seats.tokens[1], "p2"), true);
assert.equal(seats.seatOf("p2"), "p", "the new peer holds the seat");
assert.equal(seats.seatOf("p"), undefined, "the old peer id no longer does");
assert.deepEqual(seats.absent((id) => id === "h" || id === "p"), ["p", "q"], "absence follows the holder, not the seat id");
assert.deepEqual(seats.absent(() => false), ["p", "q"], "the host's own seat is never absent");

// Bot seats (ADR 21): no token, no holder, never absent; a peer calling itself a bot gets nothing.
const withBots = seatBook(["h", "p", "bot:hard:1", "bot:easy:2"]);
assert.deepEqual(withBots.tokens.map((t) => t !== ""), [false, true, false, false], "only the human guest gets a token");
assert.equal(withBots.seatOf("bot:hard:1"), undefined, "a peer announcing a bot id holds no seat");
assert.equal(withBots.rejoin("", "bot:hard:1"), false);
assert.equal(withBots.seatOf("bot:hard:1"), undefined, "the empty token claims no bot seat");
assert.deepEqual(withBots.absent(() => false), ["p"], "bots are never absent");
assert.equal(withBots.rejoin(withBots.tokens[1], "p2"), true);
assert.equal(withBots.seatOf("p2"), "p");

// Revoking a seat (ADR 23): the token stops working, the seat has no holder and is never absent.
const kicked = seatBook(["h", "p", "q", "bot:hard:1"]);
const kickedToken = kicked.tokens[1];
assert.equal(kicked.rejoin(kickedToken, "p2"), true);
assert.equal(kicked.revoke("p"), "p2", "returns the peer holding the seat now");
assert.equal(kicked.seatOf("p2"), undefined);
assert.equal(kicked.revoked(kickedToken), true);
assert.equal(kicked.rejoin(kickedToken, "p3"), false, "a revoked token claims nothing");
assert.equal(kicked.seatOf("p3"), undefined);
assert.deepEqual(kicked.absent(() => false), ["q"], "a revoked seat is not absent");
assert.equal(kicked.revoke("p"), undefined, "a seat is revoked once");
for (const seat of ["h", "bot:hard:1", "x"]) assert.equal(kicked.revoke(seat), undefined, `${seat} cannot be revoked`);
assert.equal(kicked.revoked(""), false, "the empty token is never revoked");
assert.equal(kicked.revoked(kicked.tokens[2]), false);
assert.equal(kicked.seatOf("q"), "q", "other seats are untouched");

// Bot ids: `bot:<level>:<n>`, n from 1 to 7, in `start.peers`; any other `bot:` entry drops the start.
assert.deepEqual(parseBot("bot:hard:1"), { level: "hard", n: 1 });
assert.deepEqual(parseBot("bot:easy:7"), { level: "easy", n: 7 });
assert.equal(parseBot("p"), undefined);
assert.equal(isBot("p"), false);
assert.equal(isBot("bot:x"), true);
assert.deepEqual(parseGameMsg({ ...start, peers: ["h", "bot:medium:1", "bot:hard:2"] }), { ...start, peers: ["h", "bot:medium:1", "bot:hard:2"] });
for (const bad of ["bot:", "bot:hard:0", "bot:hard:8", "bot:expert:1", "bot:Hard:1", "bot:hard:1 ", "bot:hard:12"]) {
    assert.equal(parseBot(bad), undefined, bad);
    assert.equal(parseGameMsg({ ...start, peers: ["h", bad] }), undefined, bad);
}

// Local players (ADR 22): `local:<n>`, n from 1 to 7, in `start.peers`; any other `local:` entry drops the start.
assert.equal(parseLocal("local:1"), 1);
assert.equal(parseLocal("local:7"), 7);
assert.equal(parseLocal("p"), undefined);
assert.equal(parseLocal("bot:hard:1"), undefined);
assert.equal(isLocal("p"), false);
assert.equal(isLocal("local:x"), true);
assert.deepEqual([isHostRun("bot:hard:1"), isHostRun("local:2"), isHostRun("p")], [true, true, false]);
const mixed = { ...start, peers: ["h", "p", "local:1", "local:2", "bot:easy:1"] };
assert.deepEqual(parseGameMsg(mixed), mixed);
for (const bad of ["local:", "local:0", "local:8", "local:12", "local:1 ", "Local:1", "local:one", "local:1:1"]) {
    assert.equal(parseLocal(bad), undefined, bad);
    if (bad.startsWith("local:")) assert.equal(parseGameMsg({ ...start, peers: ["h", bad] }), undefined, bad);
}

// Local seats, like bot seats: no token, no holder, never absent; a peer calling itself a local player gets nothing.
const withLocals = seatBook(["h", "p", "local:1", "bot:hard:1"]);
assert.deepEqual(withLocals.tokens.map((t) => t !== ""), [false, true, false, false], "only the human guest gets a token");
assert.equal(withLocals.seatOf("local:1"), undefined, "a peer announcing a local id holds no seat");
assert.equal(withLocals.rejoin("", "local:1"), false);
assert.equal(withLocals.seatOf("local:1"), undefined, "the empty token claims no local seat");
assert.deepEqual(withLocals.absent(() => false), ["p"], "local players are never absent");

// Version gate: a start from another build is not delivered; other messages pass.
const seen = [];
const gated = versionGate("v1", (m) => seen.push(m.type), (v) => seen.push(`mismatch:${v}`));
gated(start);
gated({ ...start, version: "v0" });
gated(shot);
// A start from a build before ADR 20 has no frame: it still reaches the gate, which turns it away.
const { frame: _, ...oldStart } = { ...start, version: "v0" };
gated(parseGameMsg(oldStart));
assert.deepEqual(seen, ["start", "mismatch:v0", "shot", "mismatch:v0"]);

// Lobby listings: shape and size caps.
const listing = { id: "h", version: "v1", name: "n", field: "xy", frame: "map", players: 1, seats: 2 };
assert.deepEqual(parseListing(listing, "v1"), listing);
assert.deepEqual(parseListing({ ...listing, frame: "player" }, "v1"), { ...listing, frame: "player" });
assert.ok(parseListing({ ...listing, name: "n".repeat(64), players: MAX_PLAYERS, seats: MAX_PLAYERS }, "v1"), "at the caps");
for (const bad of [
    null, {}, { ...listing, id: 1 }, { ...listing, field: "q" }, { ...listing, frame: "q" }, { ...listing, frame: undefined }, { ...listing, players: "1" }, { ...listing, seats: -1 },
    { ...listing, name: "n".repeat(65) },
    { ...listing, id: "i".repeat(65) },
    { ...listing, version: undefined },
    { ...listing, version: "v".repeat(65) },
    { ...listing, players: MAX_PLAYERS + 1 },
    { ...listing, seats: MAX_PLAYERS + 1 },
]) assert.equal(parseListing(bad, "v1"), undefined, JSON.stringify(bad));
assert.equal(parseListing({ ...listing, version: "v0", frame: "q" }, "v1"), undefined, "a frame that is there must be valid");

// Lobby book: refresh, own game, malformed, expiry, withdraw, size bound.
const book = lobbyBook("me", "v1", 10_000);
assert.equal(book.apply("k1", listing, 0), true);
assert.equal(book.apply("k1", listing, 3000), false, "refresh without change");
assert.equal(book.apply("k1", { ...listing, players: 2 }, 4000), true, "changed");
assert.equal(book.apply("k2", { ...listing, id: "g", version: "v0" }, 4000), true);
assert.deepEqual(book.list().map((g) => [g.id, g.compatible]), [["h", true], ["g", false]], "version filter");
// A build before ADR 20 announces no frame: it is listed as another version, not dropped.
const { frame: __, ...oldListing } = listing;
assert.equal(book.apply("k4", { ...oldListing, id: "old", version: "v0" }, 4000), true);
assert.deepEqual(book.list().find((g) => g.id === "old")?.compatible, false);
assert.equal(book.apply("k5", { ...oldListing, id: "bad" }, 4000), false, "our own version must send a frame");
book.apply("k4", { withdraw: true }, 4000);
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
