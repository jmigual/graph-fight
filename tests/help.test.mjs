// Run: node --experimental-strip-types --no-warnings tests/help.test.mjs
// The help (ADR 26) lists the parser's functions, constants and length limit; this keeps them in step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rust = readFileSync(new URL("../src/formula.rs", import.meta.url), "utf8");
const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");

/** The `<code>` words inside the element with this id. */
function codes(id) {
    const m = html.match(new RegExp(`<(p|span) id="${id}">(.*?)</\\1>`, "s"));
    assert.ok(m, `#${id} is in the help`);
    return [...m[2].matchAll(/<code>(.*?)<\/code>/g)].map((c) => c[1]);
}

const functions = [...rust.matchAll(/^\s*"(\w+)" => f64::\w+,/gm)].map((m) => m[1]);
assert.ok(functions.length >= 16, "found the parser's function table");
assert.deepEqual(codes("help-functions"), functions, "functions in the help match the parser");

const constants = [...rust.matchAll(/"(\w+)" => return Ok\(Node::Num/g)].map((m) => m[1]);
assert.deepEqual(constants, ["pi", "e"], "found the parser's constants");
assert.deepEqual(codes("help-constants-list"), constants, "constants in the help match the parser");

const limit = rust.match(/const MAX_LEN: usize = (\d+);/)[1];
assert.equal(html.match(/<strong id="help-max-len">(\d+)<\/strong>/)[1], limit, "length limit in the help matches the parser");

// Every help link has a target, and the sections other pages link to exist.
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const [, id] of html.matchAll(/href="#(help-[^"]+)"/g)) assert.ok(ids.has(id), `#${id} exists`);
for (const id of ["help-play", "help-formulas", "help-reconnect"]) {
    assert.ok(ids.has(id), `section #${id} exists`);
}
console.log("help tests passed");
