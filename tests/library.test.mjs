// Run: node --experimental-strip-types --no-warnings tests/library.test.mjs
import assert from "node:assert/strict";
import {
    decimals, defaultSlider, findSliders, formatValue, loadItems, newItem, parseItem, saveItems, sliderLetters, STORAGE_KEY, substitute,
} from "../js/library.ts";
import starters from "../js/starters.json" with { type: "json" };

// Slider letters: one ASCII letter plus optional digits, never x, t, e, in order of first appearance.
assert.deepEqual(sliderLetters(["a*sin(b*x)"]), ["a", "b"]);
assert.deepEqual(sliderLetters(["k2*x + a + k2"]), ["k2", "a"], "digits allowed, repeats once");
assert.deepEqual(sliderLetters(["t - a*sin(t)", "b*(1 - cos(t))"]), ["a", "b"], "parametric formulas share sliders");
assert.deepEqual(sliderLetters(["A*x"]), ["A"], "uppercase is a slider");
assert.deepEqual(sliderLetters(["x*t*e*x2*t1*e5"]), [], "x, t, e are reserved, with or without digits");
assert.deepEqual(sliderLetters(["pi*e + theta*θ"]), [], "constants and the angle variable");
// Function and constant names are single tokens: their letters are never sliders.
for (const f of ["atan(x)", "asin(x)", "acos(x)", "sinh(x)", "cosh(x)", "tanh(x)", "sqrt(x)", "abs(x)", "exp(x)", "ln(x)", "log10(x)", "floor(x)", "ceil(x)", "tan(x)", "amp*x", "a1b"]) {
    assert.deepEqual(sliderLetters([f]), [], f);
}
assert.deepEqual(sliderLetters(["a*atan(b)"]), ["a", "b"], "atan beside real sliders");
assert.deepEqual(findSliders(["a*x"]), { ok: true, value: ["a"] });

// `2a` would silently change meaning on substitution (a = 1.5 gives 21.5), so it is rejected.
for (const bad of ["2a", "2.5a", ".5a", "x+3k2", "x^2b"]) {
    const r = findSliders([bad]);
    assert.equal(r.ok, false, bad);
    assert.equal(r.error.kind, "glued", bad);
}
assert.equal(findSliders(["t", "2a*t"]).ok, false, "second formula too");
assert.equal(findSliders(["2*a"]).ok, true);
assert.equal(findSliders(["2 a"]).ok, true, "space is not glue; the parser rejects it anyway");
assert.equal(findSliders(["2x"]).ok, true, "x is not a slider");
assert.equal(findSliders(["a2"]).ok, true, "a2 is one slider named a2");

// Values are plain decimal literals.
const sl = (min, max, step, value) => ({ min, max, step, value });
const sub = (exprs, sliders) => substitute(exprs, sliders).value;
assert.deepEqual(sub(["a*x"], { a: sl(-10, 10, null, 1.5) }), ["1.5*x"]);
assert.deepEqual(sub(["x^a"], { a: sl(-10, 10, null, -2) }), ["x^(-2)"], "negatives in parentheses");
assert.deepEqual(sub(["-a"], { a: sl(-10, 10, null, -2) }), ["-(-2)"]);
assert.deepEqual(sub(["a+a"], { a: sl(-10, 10, null, 3) }), ["3+3"], "every occurrence");
assert.deepEqual(sub(["t", "a*t"], { a: sl(-3, 3, 0.05, 0.5) }), ["t", "0.5*t"]);
assert.deepEqual(sub(["a*atan(a)"], { a: sl(0, 5, 1, 2) }), ["2*atan(2)"], "atan is not split");
assert.deepEqual(sub(["a*x+b"], { a: sl(0, 1, 1, 1) }), ["1*x+b"], "letters without an entry stay");
assert.deepEqual(sub(["a"], { a: sl(0, 100, 1, 10) }), ["10"], "trailing zeros of integers stay");
assert.deepEqual(sub(["a"], { a: sl(-10, 10, null, 1.234) }), ["1.23"], "span 20 gives 2 decimals");
assert.deepEqual(sub(["a"], { a: sl(-3, 3, 0.05, 1.25) }), ["1.25"], "the step's decimals");
assert.deepEqual(sub(["a"], { a: sl(-10, 10, null, 2) }), ["2"], "trailing zeros removed");
assert.deepEqual(sub(["a"], { a: sl(-10, 10, null, -0.001) }), ["0"], "-0 becomes 0");
// No exponent notation, however large or small.
assert.deepEqual(sub(["a"], { a: sl(-1e6, 1e6, null, 1e6) }), ["1000000"]);
assert.deepEqual(sub(["a"], { a: sl(-1e6, 1e6, null, -1e6) }), ["(-1000000)"]);
assert.deepEqual(sub(["a"], { a: sl(0, 1e-6, null, 1e-7) }), ["0"], "tiny values");
for (const v of [1e-7, 1e-9, 123456.789, 1e6, -1e-7, 5e-324]) assert.doesNotMatch(formatValue(v, 6), /e/i, String(v));

// Decimals: step's own, or by span when there is no step, clamped to 0..6.
assert.equal(decimals(sl(-10, 10, null, 0)), 2);
assert.equal(decimals(sl(-10, 10, 0.005, 0)), 3);
assert.equal(decimals(sl(-10, 10, 1, 0)), 0);
assert.equal(decimals(sl(0, 20000, null, 0)), 0);
assert.equal(decimals(sl(0, 1e-9, null, 0)), 6);
assert.equal(decimals(sl(0, 1, 1e-9, 0)), 6, "step finer than 6 decimals");
assert.deepEqual(defaultSlider(), { min: -10, max: 10, step: null, value: 1 });

// The 256-character limit applies to the substituted text.
const cap = (n) => "1".repeat(n - 2) + "+a";
assert.deepEqual(substitute([cap(256)], { a: sl(0, 9, 1, 1) }), { ok: true, value: [cap(256).replace("a", "1")] }, "at the cap");
assert.deepEqual(substitute([cap(256)], { a: sl(0, 99, 1, 12) }), { ok: false, error: { kind: "too-long", length: 257, max: 256 } });
assert.equal(substitute(["t", cap(256)], { a: sl(0, 99, 1, 12) }).error.length, 257, "the longest formula is reported");

// Saving: sliders get the defaults; `2a`, a too-long formula and a long name are handled.
assert.deepEqual(newItem("n", "xy", "explicit", ["a*sin(b*x)"]).value, {
    name: "n", field: "xy", mode: "explicit", exprs: ["a*sin(b*x)"], sliders: { a: defaultSlider(), b: defaultSlider() },
});
assert.deepEqual(newItem("n", "xy", "explicit", ["x^2"]).value.sliders, {}, "a plain formula has no sliders");
assert.equal(newItem("n", "xy", "explicit", ["2a"]).error.kind, "glued");
assert.equal(newItem("n", "xy", "explicit", [cap(257)]).error.kind, "too-long");
assert.equal(newItem("n", "xy", "explicit", [cap(256)]).ok, true);
assert.equal(newItem("n".repeat(70), "xy", "explicit", ["x"]).value.name.length, 64);

// Storage helpers.
const memory = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const withItems = (items, v = 1) => memory({ [STORAGE_KEY]: JSON.stringify({ v, items }) });
const good = newItem("good", "xy", "explicit", ["a*x"]).value;

// Starters: every one at min, default and max has no slider letters left and fits in 256 characters.
const seeded = loadItems(memory());
assert.equal(seeded.items.length, starters.length, "every starter is valid");
assert.equal(seeded.items.length, 11);
const expected = {
    Line: ["(-2)*x", "0.5*x", "2*x"],
    Parabola: ["(-0.5)*x^2 + (-3)*x", "(-0.05)*x^2 + 1*x", "0.5*x^2 + 3*x"],
};
for (const item of seeded.items) {
    const at = (pick) => Object.fromEntries(Object.entries(item.sliders).map(([l, s]) => [l, { ...s, value: s[pick] }]));
    const out = ["min", "value", "max"].map((pick) => sub(item.exprs, at(pick)));
    for (const exprs of out) {
        for (const e of exprs) {
            assert.deepEqual(sliderLetters([e]), [], `${item.name}: ${e}`);
            assert.ok(e.length <= 256, item.name);
        }
    }
    if (expected[item.name]) assert.deepEqual(out.map((o) => o[0]), expected[item.name], item.name);
}

// First visit seeds and writes once; a deleted starter stays deleted.
const first = memory();
assert.equal(loadItems(first).available, true);
assert.equal(first.m.size, 1, "starters written on first visit");
assert.deepEqual(loadItems(first).items, seeded.items, "round trip through storage");
assert.equal(saveItems(seeded.items.slice(1), first), true);
assert.equal(loadItems(first).items.length, 10, "deleted starter stays deleted");
assert.equal(saveItems([], first), true);
assert.deepEqual(loadItems(first).items, [], "an empty list is not reseeded");

// Corrupt storage gives an empty list and does not reseed.
for (const raw of ["not json", "null", "[]", "7", '"s"', "{}", '{"v":2,"items":[]}', '{"v":1}', '{"v":1,"items":5}']) {
    const store = memory({ [STORAGE_KEY]: raw });
    assert.deepEqual(loadItems(store), { items: [], available: true }, raw);
    assert.equal(store.m.get(STORAGE_KEY), raw, "left alone");
}

// Invalid items are dropped one by one; valid ones stay.
const slider = { min: 0, max: 1, step: null, value: 0.5 };
const base = { name: "n", field: "xy", mode: "explicit", exprs: ["a*x"], sliders: { a: slider } };
const dropped = [
    null, 7, "x", [],
    { ...base, name: "n".repeat(65) },
    { ...base, name: 1 },
    { ...base, field: "hex" },
    { ...base, mode: "implicit" },
    { ...base, exprs: [] },
    { ...base, exprs: ["a*x", "a"] },
    { ...base, mode: "parametric" },
    { ...base, exprs: [1] },
    { ...base, exprs: [cap(257)] },
    { ...base, exprs: ["2a"] },
    { ...base, sliders: {} },
    { ...base, sliders: { a: slider, b: slider } },
    { ...base, sliders: undefined },
    { ...base, sliders: { a: { ...slider, min: 1 } } },
    { ...base, sliders: { a: { ...slider, min: 2, max: 1 } } },
    { ...base, sliders: { a: { ...slider, value: 2 } } },
    { ...base, sliders: { a: { ...slider, value: null } } },
    { ...base, sliders: { a: { ...slider, max: "1" } } },
    { ...base, sliders: { a: { ...slider, max: 1e7 } } },
    { ...base, sliders: { a: { ...slider, step: 0 } } },
    { ...base, sliders: { a: { ...slider, step: -1 } } },
    { ...base, sliders: { a: { ...slider, step: undefined } } },
    { ...base, sliders: { a: null } },
];
for (const bad of dropped) assert.equal(parseItem(bad), undefined, JSON.stringify(bad));
const kept = [good, { ...base, sliders: { a: { ...slider, step: 0.1 } } }, { ...base, mode: "parametric", exprs: ["t", "a*t"] }];
assert.deepEqual(loadItems(withItems([...dropped, ...kept])).items, kept);
assert.deepEqual(loadItems(withItems({ not: "a list" })).items, []);

// Blocked or full storage: nothing throws, the list works in memory.
const blocked = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
assert.deepEqual(loadItems(blocked), { items: [], available: false });
assert.equal(saveItems([good], blocked), false);
const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
const inMemory = loadItems(full);
assert.equal(inMemory.items.length, 11, "starters still shown when the first write fails");
assert.equal(inMemory.available, false);
// Without a store argument the global `localStorage` is used; reading it may itself throw.
Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("SecurityError"); }, configurable: true });
assert.deepEqual(loadItems(), { items: [], available: false });
assert.equal(saveItems([good]), false);
Object.defineProperty(globalThis, "localStorage", { value: memory(), configurable: true });
assert.equal(saveItems([good]), true);
assert.deepEqual(loadItems().items, [good]);

console.log("library tests ok");
