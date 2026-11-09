// Formula editor helpers (ADR 17, section 7). DOM only.
import type { Field } from "./net";

/** The variable button's text per field and mode (the parser accepts t in every parametric mode). */
const VARIABLE = { xy: { explicit: "x", parametric: "t" }, disc: { explicit: "θ", parametric: "t" } };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inputs = () => [$<HTMLInputElement>("input-a"), $<HTMLInputElement>("input-b")];

/** What a helper button inserts: `[text]`, or `[open, close]` for the buttons that wrap a selection. */
function snippet(label: string): [string] | [string, string] {
    if (label === "π") return ["pi"];
    if (label === "( )") return ["(", ")"];
    if (label === "√") return ["sqrt(", ")"];
    // The remaining multi-letter labels are functions; the single characters are plain text.
    return /^[a-z]{2,}\d*$/.test(label) ? [`${label}(`, ")"] : [label];
}

function initHelpers() {
    let target = inputs()[0];
    for (const input of inputs()) input.addEventListener("focus", () => (target = input));
    const helpers = $("helpers");
    // Keeps the focus and the selection in the input while the button is pressed.
    helpers.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });
    helpers.addEventListener("click", (e) => {
        const button = (e.target as HTMLElement).closest("button");
        if (!button) return;
        const [open, close = ""] = snippet(button.textContent ?? "");
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        const selected = target.value.slice(start, end);
        const text = open + selected + close;
        // setRangeText does not enforce maxlength, and the parser rejects longer formulas.
        if (target.value.length - (end - start) + text.length > target.maxLength) return;
        target.setRangeText(text, start, end, "end");
        if (!selected && close) target.setSelectionRange(start + open.length, start + open.length);
        target.focus();
        target.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

/** Sets up the helper buttons. `refresh` relabels the variable button for the field and mode. */
export function initEditor(): { refresh(field: Field, parametric: boolean): void } {
    initHelpers();
    return {
        refresh(field, parametric) {
            $("insert-var").textContent = VARIABLE[field][parametric ? "parametric" : "explicit"];
        },
    };
}
