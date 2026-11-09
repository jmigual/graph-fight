// Saved formulas and templates (ADR 17, section 8): slider letters, substitution, the stored data
// shape and localStorage. Pure logic with no DOM, so it also runs under the node test runner.
import type { Field } from "./net";
import starters from "./starters.json" with { type: "json" };

/** `localStorage` key holding `{ v: 1, items }`. */
export const STORAGE_KEY = "graph-fight.formulas";
/** Longest formula the Rust parser accepts. */
export const MAX_EXPR = 256;
/** Longest saved name. */
export const MAX_NAME = 64;
/** Largest |value| a slider limit or value may have, so `toFixed` never yields an exponent. */
export const LIMIT = 1e6;

export type Mode = "explicit" | "parametric";
/** `step` is null when empty (continuous). */
export type Slider = { min: number; max: number; step: number | null; value: number };
/** A saved formula; it is a template when `sliders` is not empty. `exprs` has 1 or 2 entries to match `mode`. */
export type Item = { name: string; field: Field; mode: Mode; exprs: [string] | [string, string]; sliders: Record<string, Slider> };

/** `glued`: a slider right after a digit or `.` (`2a`); `too-long`: `length` exceeds `max`. */
export type LibraryError = { kind: "glued"; slider: string } | { kind: "too-long"; length: number; max: number };
export type Result<T> = { ok: true; value: T } | { ok: false; error: LibraryError };

// Mirrors the parser's identifiers: a letter followed by letters or digits, so `atan`, `pi` and
// `theta` are single tokens. A slider is one ASCII letter plus optional digits, other than x, t, e.
const IDENT = /\p{L}[\p{L}\p{N}]*/gu;
const SLIDER = /^(?![xte]\d*$)[A-Za-z]\d*$/;

function sliderTokens(exprs: readonly string[]): { name: string; glued: boolean }[] {
    const out: { name: string; glued: boolean }[] = [];
    for (const text of exprs) {
        for (const m of text.matchAll(IDENT)) {
            if (!SLIDER.test(m[0])) continue;
            const at = m.index ?? 0;
            const end = at + m[0].length;
            out.push({ name: m[0], glued: (at > 0 && /[\d.]/.test(text[at - 1])) || text[end] === "." });
        }
    }
    return out;
}

/** The slider letters in the formulas, in order of first appearance. */
export function sliderLetters(exprs: readonly string[]): string[] {
    return [...new Set(sliderTokens(exprs).map((t) => t.name))];
}

/** Like `sliderLetters`, but fails with `glued` on forms like `2a`, `a.5` or `a.` that substitution would silently change. */
export function findSliders(exprs: readonly string[]): Result<string[]> {
    const glued = sliderTokens(exprs).find((t) => t.glued);
    return glued ? { ok: false, error: { kind: "glued", slider: glued.name } } : { ok: true, value: sliderLetters(exprs) };
}

/** What a new slider letter starts as. */
export function defaultSlider(): Slider {
    return { min: -10, max: 10, step: null, value: 1 };
}

/** Builds an item to save from the editor text; no sliders for a plain formula. Does not parse the formula. */
export function newItem(name: string, field: Field, mode: Mode, exprs: Item["exprs"]): Result<Item> {
    const found = findSliders(exprs);
    if (!found.ok) return found;
    const length = Math.max(...exprs.map((e) => e.length));
    if (length > MAX_EXPR) return { ok: false, error: { kind: "too-long", length, max: MAX_EXPR } };
    const sliders = Object.fromEntries(found.value.map((l) => [l, defaultSlider()]));
    return { ok: true, value: { name: name.slice(0, MAX_NAME), field, mode, exprs, sliders } };
}

/** Decimals a slider's value is shown and inserted with: the step's, or by the span when there is no step. */
export function decimals(s: Slider): number {
    if (s.step === null) return Math.min(6, Math.max(0, Math.ceil(-Math.log10((s.max - s.min) / 1000))));
    for (let d = 0; d < 6; d++) {
        const k = s.step * 10 ** d;
        if (Math.abs(k - Math.round(k)) < 1e-9) return d;
    }
    return 6;
}

/**
 * The value moved onto the slider's step grid, which starts at `min` (where a range input puts its
 * thumb), and kept inside the limits. Unchanged when there is no step.
 */
export function snapValue(s: Slider): number {
    if (s.step === null) return s.value;
    let k = Math.round((s.value - s.min) / s.step);
    if (s.min + k * s.step > s.max) k--;
    return Math.max(s.min, Number((s.min + k * s.step).toFixed(9)));
}

/** A plain decimal literal: no exponent, no trailing zeros, no `-0`, negatives in parentheses. */
export function formatValue(v: number, digits: number): string {
    let text = v.toFixed(digits);
    if (text.includes(".")) text = text.replace(/\.?0+$/, "");
    if (text === "-0") text = "0";
    return text.startsWith("-") ? `(${text})` : text;
}

/**
 * Replaces each slider letter with its value (letters without an entry stay). Fails with `too-long`
 * when a result exceeds the parser's limit, reporting the longest.
 */
export function substitute(exprs: Item["exprs"], sliders: Record<string, Slider>): Result<Item["exprs"]> {
    const out = exprs.map((e) =>
        e.replace(IDENT, (tok) => (SLIDER.test(tok) && Object.prototype.hasOwnProperty.call(sliders, tok) ? formatValue(sliders[tok].value, decimals(sliders[tok])) : tok)),
    ) as Item["exprs"];
    const length = Math.max(...out.map((e) => e.length));
    return length > MAX_EXPR ? { ok: false, error: { kind: "too-long", length, max: MAX_EXPR } } : { ok: true, value: out };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Math.abs(v) <= LIMIT;

function parseSlider(v: unknown): Slider | undefined {
    if (!isObj(v) || !isNum(v.min) || !isNum(v.max) || !isNum(v.value) || !(v.min < v.max) || v.value < v.min || v.value > v.max) return undefined;
    const step = v.step === null ? null : isNum(v.step) && v.step > 0 ? v.step : undefined;
    return step === undefined ? undefined : { min: v.min, max: v.max, step, value: v.value };
}

/** Returns the item if `v` has the right shape and sizes and its sliders match its formulas, otherwise undefined. */
export function parseItem(v: unknown): Item | undefined {
    if (!isObj(v) || !isText(v.name, MAX_NAME) || (v.field !== "xy" && v.field !== "disc") || !isObj(v.sliders)) return undefined;
    if (v.mode !== "explicit" && v.mode !== "parametric") return undefined;
    if (!Array.isArray(v.exprs) || v.exprs.length !== (v.mode === "explicit" ? 1 : 2) || !v.exprs.every((e) => isText(e, MAX_EXPR))) return undefined;
    const exprs = [...v.exprs] as Item["exprs"];
    const found = findSliders(exprs);
    const names = Object.keys(v.sliders);
    if (!found.ok || names.length !== found.value.length || !found.value.every((l) => names.includes(l))) return undefined;
    const sliders: Record<string, Slider> = {};
    for (const l of names) {
        const s = parseSlider(v.sliders[l]);
        if (!s) return undefined;
        sliders[l] = s;
    }
    return { name: v.name, field: v.field, mode: v.mode, exprs, sliders };
}

/** The part of `Storage` used here. */
export type Store = Pick<Storage, "getItem" | "setItem">;

/** `items` are the valid ones; `complete` is false when anything in the text failed validation. */
function parseStored(text: string): { items: Item[]; complete: boolean } {
    try {
        const data: unknown = JSON.parse(text);
        if (!isObj(data) || data.v !== 1 || !Array.isArray(data.items)) return { items: [], complete: false };
        const items = data.items.flatMap((i) => parseItem(i) ?? []);
        return { items, complete: items.length === data.items.length };
    } catch {
        return { items: [], complete: false };
    }
}

/**
 * Writes the list; false when storage is blocked or full, so the caller can show the in-memory
 * notice. It also refuses to write an item `parseItem` rejects, which would make the next load
 * unavailable, and to overwrite stored text that does not fully validate (corrupt, another
 * version, or with invalid items), so a bad read never destroys the original.
 */
export function saveItems(items: readonly Item[], storage?: Store): boolean {
    if (!items.every((i) => parseItem(i))) return false;
    try {
        const store = storage ?? localStorage;
        const current = store.getItem(STORAGE_KEY);
        if (current !== null && !parseStored(current).complete) return false;
        store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, items }));
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads the saved list. A missing key (first visit) seeds and writes the starter templates; a
 * deleted starter stays deleted because the key then exists. `available` is false, and the stored
 * text is never overwritten, when it does not fully validate (the list then holds only its valid
 * items), when storage cannot be read (the list is then empty) or when the first write failed.
 * The list still works in memory.
 */
export function loadItems(storage?: Store): { items: Item[]; available: boolean } {
    let store: Store;
    let text: string | null;
    try {
        store = storage ?? localStorage;
        text = store.getItem(STORAGE_KEY);
    } catch {
        return { items: [], available: false };
    }
    if (text !== null) {
        const { items, complete } = parseStored(text);
        return { items, available: complete };
    }
    const items = starters.flatMap((s) => parseItem(s) ?? []);
    return { items, available: saveItems(items, store) };
}
