// Run: node --experimental-strip-types --no-warnings tests/render.test.mjs
import assert from "node:assert/strict";
import { lookAfterShot, shotLabel } from "../js/render.ts";

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
const long = shotLabel("xy", ["1+".repeat(40) + "x"]);
assert.equal(Array.from(long).length, 33);
assert.ok(long.endsWith("…"));

console.log("render tests ok");
