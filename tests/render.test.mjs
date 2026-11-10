// Run: node --experimental-strip-types --no-warnings tests/render.test.mjs
import assert from "node:assert/strict";
import { describeTrial, lookAfterShot, lookKey, olderPaths, pickAt, playerName, shotLabel, shotText, toWorld } from "../js/render.ts";

const line = (from, dx, dy, n = 40) => Array.from({ length: n }, (_, i) => ({ x: from.x + dx * i * 0.05, y: from.y + dy * i * 0.05 }));

// The gaze follows the shot's start: first point to the first one at least 0.5 away.
const left = lookAfterShot("xy", undefined, line({ x: -10, y: 0 }, -1, 0));
assert.deepEqual(left, { dir: { x: -1, y: 0 }, side: -1 }, "a backwards shot turns the face left");
const bent = [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 5 }];
assert.deepEqual(lookAfterShot("xy", undefined, bent).dir, { x: 1, y: 0 }, "later points do not count");
const short = [{ x: 0, y: 0 }, { x: 0, y: 0.1 }, { x: 0.2, y: 0.1 }];
const s = lookAfterShot("xy", undefined, short).dir;
assert.ok(Math.abs(Math.hypot(s.x, s.y) - 1) < 1e-12 && s.x > 0 && s.y > 0, "the last point when none is 0.5 away");

// Empty shots, and shots that never leave the shooter, keep the gaze.
assert.equal(lookAfterShot("xy", undefined, []), undefined);
assert.equal(lookAfterShot("xy", undefined, [{ x: 1, y: 1 }]), undefined);
assert.equal(lookAfterShot("xy", undefined, [{ x: 1, y: 1 }, { x: 1, y: 1 }]), undefined);

// Looking nearly straight up keeps the brim's side: the previous one, or the default's.
const up = line({ x: 0, y: 0 }, 0.1, 1);
assert.equal(lookAfterShot("xy", { dir: { x: -1, y: 0 }, side: -1 }, up).side, -1);
assert.equal(lookAfterShot("xy", undefined, line({ x: 5, y: 0 }, 0.1, 1)).side, -1, "a right-hand XY shooter faces left");
assert.equal(lookAfterShot("disc", undefined, line({ x: 0, y: 8 }, 0.1, -1)).side, 1, "facing the centre straight down: initially right");

// Labels name the mode's variables and are cut to 32 characters.
assert.equal(shotLabel("xy", ["x/2"]), "y = x/2");
assert.equal(shotLabel("xy", ["t", "2*t"]), "x = t, y = 2*t");
assert.equal(shotLabel("disc", ["θ/2"]), "r = θ/2");
assert.equal(shotLabel("disc", ["t", "0.5"]), "r = t, θ = 0.5");
assert.equal(shotText("xy", ["1+".repeat(40) + "x"]).length, 4 + 81, "the text is never cut");
const long = shotLabel("xy", ["1+".repeat(40) + "x"]);
assert.equal(Array.from(long).length, 33);
assert.ok(long.endsWith("…"));

// Older paths: each living player's last shot but the newest; a dead player's path is dropped.
const arena = { teams: [{ players: [{ alive: true }, { alive: false }] }, { players: [{ alive: true }] }] };
const shot = (team) => ({ team, exprs: ["x"], cw: false, points: [] });
const [a, b, c] = [shot(0), shot(0), shot(1)];
const shots = new Map([[lookKey(0, 0), a], [lookKey(0, 1), b], [lookKey(1, 0), c]]);
assert.deepEqual(olderPaths(shots, arena, c), [a], "the newest and the dead player's are left out");
assert.deepEqual(olderPaths(shots, arena, null), [a, c], "with no newest shot every living player's path stays");
assert.deepEqual(olderPaths(new Map(), arena, null), []);

// The test arena (ADR 25).
// A 800 px board of the XY field (x_max 20, y_max 10): 20 px per unit, y up.
assert.deepEqual(toWorld(400, 200, 800, 20, 10), { x: 0, y: 0 });
assert.deepEqual(toWorld(0, 0, 800, 20, 10), { x: -20, y: 10 });
assert.deepEqual(toWorld(600, 300, 800, 20, 10), { x: 10, y: -5 });

// Picking: the nearest player within its radius plus the slack, then obstacles; players win.
const teams = [[{ x: -8, y: 0 }], [{ x: 5, y: 0 }, { x: 5, y: 0.8 }]];
const obstacles = [{ x: 0, y: 0, r: 2 }, { x: 0.5, y: 0, r: 0.5 }, { x: 5, y: 0, r: 1 }];
assert.deepEqual(pickAt(teams, obstacles, { x: -8.2, y: 0.1 }, 0.3, 0), { player: [0, 0] });
assert.deepEqual(pickAt(teams, obstacles, { x: 5, y: 0.3 }, 0.3, 0), { player: [1, 0] }, "the nearer of two players");
assert.deepEqual(pickAt(teams, obstacles, { x: 5, y: 0.6 }, 0.3, 0), { player: [1, 1] });
assert.deepEqual(pickAt(teams, obstacles, { x: 5.5, y: 0 }, 0.3, 0), { obstacle: 2 }, "an obstacle under no player");
assert.deepEqual(pickAt(teams, obstacles, { x: -8.5, y: 0 }, 0.3, 0.25), { player: [0, 0] }, "the slack reaches past the edge");
assert.equal(pickAt(teams, obstacles, { x: -8.5, y: 0 }, 0.3, 0.1), null);
assert.deepEqual(pickAt(teams, obstacles, { x: 0.6, y: 0 }, 0.3, 0), { obstacle: 1 }, "the obstacle with the nearest centre");
assert.deepEqual(pickAt(teams, obstacles, { x: -1, y: 1 }, 0.3, 0), { obstacle: 0 });
assert.equal(pickAt([[], []], [], { x: 0, y: 0 }, 0.3, 1), null);

// Words: who fired what, whom it hit and the obstacles it stopped in.
assert.equal(playerName(1, 0), "Team 2 player 1");
assert.equal(describeTrial("xy", [0, 0], ["0"], false, [[1, 0]], []), "Team 1 player 1 fired y = 0. It hit Team 2 player 1.");
assert.equal(describeTrial("xy", [1, 2], ["t", "2*t"], true, [], [0]), "Team 2 player 3 fired x = t, y = 2*t. It hit no player. It stopped in obstacle 1.");
assert.equal(
    describeTrial("disc", [0, 0], ["θ"], true, [[1, 0], [0, 1], [1, 2]], [2, 4]),
    "Team 1 player 1 fired r = θ, clockwise. It hit Team 2 player 1, Team 1 player 2 and Team 2 player 3. It stopped in obstacles 3 and 5.",
);
assert.match(describeTrial("disc", [0, 0], ["-t", "0"], false, [], []), /r = -t, θ = 0, counterclockwise\. It hit no player\.$/);

console.log("render tests ok");
