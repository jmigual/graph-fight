// Run: node --experimental-strip-types --no-warnings tests/teams.test.mjs
import assert from "node:assert/strict";
import { DEFAULT_K } from "../js/net.ts";
import { charactersPerSide, join, leave, move, newLineup, owner, seatsOf, sideOf, sidesOf } from "../js/teams.ts";

const none = new Set();
// As the game reads a start: an absent `k` is the default.
const perSide = (start) => charactersPerSide(start, start.k ?? DEFAULT_K);
const owners = (start, t, left = none) => Array.from({ length: perSide(start)[t] }, (_, j) => owner(start, left, t, j));

// Free-for-all (no `teams`, no `k`) is today's mapping: seat i is team i with 3 characters, all its own.
const ffa = { peers: ["h", "p", "bot:easy:1"] };
assert.deepEqual(sidesOf(ffa), [0, 1, 2]);
assert.deepEqual(perSide(ffa), [3, 3, 3]);
for (const [t, seat] of ffa.peers.entries()) {
    assert.deepEqual(owners(ffa, t), [seat, seat, seat]);
    assert.deepEqual(seatsOf(ffa, t), [seat]);
    assert.equal(sideOf(ffa, seat), t);
}
assert.equal(sideOf(ffa, "x"), undefined);
assert.deepEqual(owners(ffa, 1, new Set(["p"])), [undefined, undefined, undefined], "a free-for-all seat that leaves takes its team out");
assert.deepEqual(perSide({ ...ffa, k: 1 }), [1, 1, 1], "k applies to free-for-all too");

// Two sides of two: c = k × S, and the seats of a side take its characters in turn.
const duo = { peers: ["h", "p", "q", "local:1"], teams: [0, 1, 0, 1] };
assert.deepEqual(seatsOf(duo, 0), ["h", "q"]);
assert.deepEqual(sideOf(duo, "local:1"), 1);
assert.deepEqual(perSide(duo), [6, 6]);
assert.deepEqual(owners(duo, 0), ["h", "q", "h", "q", "h", "q"]);
assert.deepEqual(owners(duo, 1), ["p", "local:1", "p", "local:1", "p", "local:1"]);
assert.deepEqual(perSide({ ...duo, k: 1 }), [2, 2]);
assert.deepEqual(owners({ ...duo, k: 2 }, 0), ["h", "q", "h", "q"]);

// Uneven sides get the same count, S being the largest side; the lone seat plays them all.
const uneven = { peers: ["h", "p", "q"], teams: [1, 1, 0], k: 2 };
assert.deepEqual(perSide(uneven), [4, 4]);
assert.deepEqual(owners(uneven, 0), ["q", "q", "q", "q"]);
assert.deepEqual(owners(uneven, 1), ["h", "p", "h", "p"]);
assert.deepEqual(perSide({ peers: ["a", "b", "c", "d", "e"], teams: [0, 1, 2, 0, 0], k: 1 }), [3, 3, 3]);

// Hand-over: a leaver's characters go to the next seat of its side that has not left, cyclically.
const trio = { peers: ["h", "p", "q", "r", "s", "t"], teams: [0, 1, 0, 1, 0, 1], k: 1 };
assert.deepEqual(owners(trio, 0), ["h", "q", "s"]);
assert.deepEqual(owners(trio, 0, new Set(["q"])), ["h", "s", "s"]);
assert.deepEqual(owners(trio, 0, new Set(["s"])), ["h", "q", "h"], "wraps to the side's first seat");
assert.deepEqual(owners(trio, 0, new Set(["h", "s"])), ["q", "q", "q"]);
assert.deepEqual(owners(trio, 1, new Set(["h", "s"])), ["p", "r", "t"], "the other side is untouched");
assert.deepEqual(owners(trio, 0, new Set(["h", "q", "s"])), [undefined, undefined, undefined], "the last seat leaving takes the side out");

// Seating: a joiner takes the side with the most open seats, the lowest on a tie; a full room queues.
let room = newLineup(2, 2);
assert.deepEqual(room, { size: 2, teams: [[], []], waiting: [] });
for (const id of ["h", "a", "b", "c", "d", "e"]) room = join(room, id);
assert.deepEqual(room, { size: 2, teams: [["h", "b"], ["a", "c"]], waiting: ["d", "e"] });
assert.deepEqual(join(join(newLineup(3, 2), "h"), "a").teams, [["h"], ["a"], []]);
assert.deepEqual(join({ size: 3, teams: [["h", "a"], ["b"]], waiting: [] }, "c").teams, [["h", "a"], ["b", "c"]], "the side with more room");

// Leaving: the first waiting joiner, in join order, takes the seat that opens.
room = leave(room, "a");
assert.deepEqual(room, { size: 2, teams: [["h", "b"], ["c", "d"]], waiting: ["e"] });
room = leave(room, "e");
assert.deepEqual(room, { size: 2, teams: [["h", "b"], ["c", "d"]], waiting: [] }, "a waiting joiner leaves the queue");
room = leave(room, "x");
assert.deepEqual(room.teams, [["h", "b"], ["c", "d"]], "an unknown id changes nothing");

// Moving: only a seated id, only to another side with an open seat.
room = leave(room, "d");
assert.deepEqual(move(room, "b", 1), { size: 2, teams: [["h"], ["c", "b"]], waiting: [] });
assert.equal(move(room, "b", 0), undefined, "already on that side");
assert.equal(move(move(room, "b", 1), "h", 1), undefined, "a full side");
assert.equal(move(room, "b", 2), undefined, "no such side");
assert.equal(move(room, "b", -1), undefined);
assert.equal(move(room, "b", 0.5), undefined);
assert.equal(move(room, "x", 1), undefined, "not seated");
assert.equal(move({ ...room, waiting: ["w"] }, "w", 1), undefined, "a waiting joiner is not seated");
const before = JSON.stringify(room);
join(room, "z");
leave(room, "h");
move(room, "b", 1);
assert.equal(JSON.stringify(room), before, "the rules return a new seating and leave the old one as it was");

console.log("teams tests ok");
