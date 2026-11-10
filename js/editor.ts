// Formula editor helpers and the saved formulas panel (ADR 17, sections 7 and 8). DOM only; the
// logic (slider letters, substitution, storage) lives in library.ts.
import type { Field } from "./net";
import { autoSymbols, decimals, formatValue, LIMIT, loadItems, MAX_NAME, newItem, saveItems, sliderLetters, snapValue, substitute } from "./library";
import type { Item, LibraryError, Mode, Slider } from "./library";

/** The variable button's text per field and mode (the parser accepts t in every parametric mode). */
const VARIABLE = { xy: { explicit: "x", parametric: "t" }, disc: { explicit: "θ", parametric: "t" } };
const NOTATION = {
    xy: { explicit: "y = f(x)", parametric: "x(t), y(t)" },
    disc: { explicit: "r = f(θ)", parametric: "r(t), θ(t)" },
};
/** The formula inputs' labels per field and mode. */
const LABELS = {
    xy: { explicit: ["y ="], parametric: ["x(t) =", "y(t) ="] },
    disc: { explicit: ["r ="], parametric: ["r(t) =", "θ(t) ="] },
};
const OUT_OF_RANGE = `Use a number between -${LIMIT} and ${LIMIT}.`;
const NOTICE = "Can't save in this browser; saved formulas last until you close the tab.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inputs = () => [$<HTMLInputElement>("input-a"), $<HTMLInputElement>("input-b")];
const mode = (): Mode => ($<HTMLInputElement>("mode-parametric").checked ? "parametric" : "explicit");
/** The formulas in the editor for the current mode. */
const exprs = (): Item["exprs"] => (mode() === "parametric" ? [inputs()[0].value, inputs()[1].value] : [inputs()[0].value]);

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
}

/** The ADR's wording for a library error. */
function describe(error: LibraryError): string {
    return error.kind === "glued"
        ? `Put * between a number and a slider: 2*${error.slider}.`
        : `Too long with these values (${error.length} of ${error.max} characters).`;
}

/** The message for Fire when the formulas still hold slider letters, or undefined when they do not. */
export function sliderError(formulas: readonly string[]): string | undefined {
    const letters = sliderLetters(formulas);
    if (!letters.length) return undefined;
    const one = letters.length === 1;
    const list = one ? letters[0] : `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;
    return `${list} ${one ? "is a slider letter" : "are slider letters"}. Insert the formula from its template, or type ${one ? "a number" : "numbers"}.`;
}

/** Puts `values` in the editor, switching to `to` first, and leaves the caret at the end of the first input. */
function fill(to: Mode, values: Item["exprs"]) {
    const radio = $<HTMLInputElement>(to === "parametric" ? "mode-parametric" : "mode-explicit");
    if (!radio.checked) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
    }
    values.forEach((v, i) => {
        inputs()[i].value = v;
        inputs()[i].dispatchEvent(new Event("input", { bubbles: true }));
    });
    $("error").textContent = "";
    const first = inputs()[0];
    first.focus();
    first.setSelectionRange(first.value.length, first.value.length);
}

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
        // The second input is hidden outside parametric mode.
        if (!$<HTMLInputElement>("mode-parametric").checked) target = inputs()[0];
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

/** Types `theta` as `θ` and `pi` as `π` in the formula inputs, keeping the caret where it was. */
function initAutoSymbols() {
    for (const input of inputs()) {
        input.addEventListener("input", (e) => {
            if ((e as InputEvent).isComposing) return;
            const { text, caret } = autoSymbols(input.value, input.selectionStart ?? input.value.length);
            if (text === input.value) return;
            input.value = text;
            input.setSelectionRange(caret, caret);
        });
    }
}

/** A number input; `step="any"` so the browser never flags a fractional entry. */
function numberInput(label: string): HTMLInputElement {
    const input = make("input", "math");
    input.type = "number";
    input.step = "any";
    input.setAttribute("aria-label", label);
    return input;
}

/** A value as the plain decimal shown in the inputs (formatValue without the parentheses of a negative). */
const plain = (v: number, digits: number) => formatValue(v, digits).replace(/^\((.*)\)$/, "$1");

/**
 * The Desmos-like row for one slider letter: value, then lowest, range and highest, then step. Edits
 * change `s` in place; `changed(commit)` runs on every edit, with `commit` true once it is final
 * (the `change` event), and `report` gets the reason an edit was refused, or "" when it was accepted.
 */
function sliderRow(letter: string, s: Slider, changed: (commit: boolean) => void, report: (msg: string) => void): HTMLElement {
    const value = numberInput(`Value of ${letter}`);
    const min = numberInput(`Lowest ${letter}`);
    const max = numberInput(`Highest ${letter}`);
    const step = numberInput(`Step of ${letter}`);
    const range = make("input");
    range.type = "range";
    range.setAttribute("aria-label", letter);
    const sync = () => {
        range.min = String(s.min);
        range.max = String(s.max);
        range.step = s.step === null ? "any" : String(s.step);
        range.value = String(s.value);
        value.value = plain(s.value, decimals(s));
        range.setAttribute("aria-valuetext", value.value);
        min.value = String(s.min);
        max.value = String(s.max);
        step.value = s.step === null ? "" : String(s.step);
        for (const field of [min, max, step]) field.setCustomValidity("");
    };
    // Refuses an edit that leaves the limits or the step invalid, keeping the old ones.
    const refuse = (field: HTMLInputElement, msg: string) => {
        field.setCustomValidity(msg);
        report(msg);
    };
    const accept = () => {
        sync();
        report("");
        changed(true);
    };
    value.oninput = () => {
        const v = value.valueAsNumber;
        if (!(v >= s.min && v <= s.max)) return;
        s.value = v;
        range.value = String(v);
        changed(false);
    };
    value.onchange = () => {
        const v = value.valueAsNumber;
        if (!(Math.abs(v) <= LIMIT)) {
            sync();
            return report(OUT_OF_RANGE);
        }
        // A value outside the limits widens them.
        s.min = Math.min(s.min, v);
        s.max = Math.max(s.max, v);
        s.value = v;
        accept();
    };
    range.oninput = () => {
        s.value = Number(range.value);
        value.value = plain(s.value, decimals(s));
        range.setAttribute("aria-valuetext", value.value);
        changed(false);
    };
    range.onchange = () => changed(true);
    min.onchange = () => {
        const v = min.valueAsNumber;
        if (!(Math.abs(v) <= LIMIT)) return refuse(min, OUT_OF_RANGE);
        if (v >= s.max) return refuse(min, "Lowest must be below highest.");
        s.min = v;
        s.value = Math.max(s.value, v);
        s.value = snapValue(s);
        accept();
    };
    max.onchange = () => {
        const v = max.valueAsNumber;
        if (!(Math.abs(v) <= LIMIT)) return refuse(max, OUT_OF_RANGE);
        if (v <= s.min) return refuse(max, "Highest must be above lowest.");
        s.max = v;
        s.value = Math.min(s.value, v);
        s.value = snapValue(s);
        accept();
    };
    step.onchange = () => {
        const v = step.valueAsNumber;
        if (step.value === "") s.step = null;
        else if (!(v > 0)) return refuse(step, "Step must be above 0.");
        else if (v > LIMIT) return refuse(step, OUT_OF_RANGE);
        else s.step = v;
        s.value = snapValue(s);
        accept();
    };
    sync();
    const row = make("div", "slider");
    const head = make("div", "slider-value");
    head.append(make("span", "math", `${letter} =`), value);
    const limits = make("div", "slider-limits");
    limits.append(min, range, max);
    const stepLabel = make("label", "slider-step");
    stepLabel.append(make("span", "", "step"), step);
    row.append(head, limits, stepLabel);
    return row;
}

/** Sets up the helper buttons and the saved formulas panel. `refresh` follows the field and mode: input labels, the second input, the variable button and the list. */
export function initEditor(): { refresh(field: Field, parametric: boolean): void } {
    initHelpers();
    initAutoSymbols();
    const loaded = loadItems();
    const items = loaded.items;
    const list = $("saved-list");
    const notice = $("saved-notice");
    const saveRow = $("save-row");
    const saveName = $<HTMLInputElement>("save-name");
    const saveError = $("save-error");
    let field: Field = "xy";
    notice.textContent = NOTICE;
    notice.hidden = loaded.available;

    const persist = () => (notice.hidden = saveItems(items));

    function renderItem(item: Item, open: boolean): HTMLLIElement {
        const li = make("li", "saved-item");
        li.append(make("span", "saved-name", item.name), make("span", "saved-expr math", item.exprs.join(", ")));
        const letters = Object.keys(item.sliders);
        const insert = make("button", "", "Insert");
        insert.setAttribute("aria-label", `Insert ${item.name}`);
        const remove = make("button", "secondary", "Delete");
        remove.setAttribute("aria-label", `Delete ${item.name}`);
        remove.onclick = () => {
            if (!confirm(`Delete “${item.name}”?`)) return;
            const rows = [...list.querySelectorAll(".saved-item")];
            const at = rows.indexOf(li);
            items.splice(items.indexOf(item), 1);
            persist();
            render();
            // Focus would fall to the body; move it to the next item, or the heading when none is left.
            const left = list.querySelectorAll(".saved-item");
            const next = left[Math.min(at, left.length - 1)]?.querySelector<HTMLButtonElement>("button:not(:disabled)");
            (next ?? $("saved-heading")).focus();
        };
        const actions = make("div", "actions");
        actions.append(insert, remove);
        if (!letters.length) {
            insert.onclick = () => fill(item.mode, item.exprs);
            li.append(actions);
            return li;
        }
        const preview = make("p", "preview math");
        const note = make("p", "error");
        note.setAttribute("role", "alert");
        let refused = "";
        let tooLong = "";
        const changed = (commit: boolean) => {
            const result = substitute(item.exprs, item.sliders);
            preview.textContent = result.ok ? `→ ${result.value.join(", ")}` : "";
            tooLong = result.ok ? "" : describe(result.error);
            // A live region: only rewrite it when the text changes, not on every drag step.
            if (note.textContent !== (refused || tooLong)) note.textContent = refused || tooLong;
            insert.disabled = !result.ok;
            if (commit) persist();
        };
        const report = (msg: string) => {
            refused = msg;
            changed(false);
        };
        const details = make("details");
        details.open = open;
        details.append(make("summary", "", "Sliders"), ...letters.map((l) => sliderRow(l, item.sliders[l], changed, report)));
        insert.onclick = () => {
            const result = substitute(item.exprs, item.sliders);
            if (result.ok) fill(item.mode, result.value);
        };
        changed(false);
        // Insert and Delete show beside the name, so they come before the sliders in focus order too.
        li.append(actions, details, preview, note);
        return li;
    }

    /** Lists the items of the current field, grouped by mode; `open` is the item whose sliders start expanded. */
    function render(open?: Item) {
        const rows: HTMLLIElement[] = [];
        for (const m of ["explicit", "parametric"] as const) {
            const shown = items.filter((i) => i.field === field && i.mode === m);
            if (!shown.length) continue;
            const group = make("li", "saved-group");
            group.append(make("h3", "math", NOTATION[field][m]));
            rows.push(group, ...shown.map((i) => renderItem(i, i === open)));
        }
        list.replaceChildren(...rows);
        $("saved-empty").hidden = rows.length > 0;
    }

    const closeSave = () => {
        saveRow.hidden = true;
        saveError.textContent = "";
        $("save").focus();
    };
    $("save").onclick = () => {
        saveRow.hidden = false;
        saveError.textContent = "";
        saveName.value = exprs().join(", ").slice(0, MAX_NAME);
        saveName.focus();
        saveName.select();
    };
    $("save-cancel").onclick = closeSave;
    $("save-confirm").onclick = () => {
        const formulas = exprs();
        if (formulas.every((f) => f.trim() === "")) {
            saveError.textContent = "Type a formula to save.";
            return;
        }
        const result = newItem(saveName.value.trim() || formulas.join(", "), field, mode(), formulas);
        if (!result.ok) {
            saveError.textContent = describe(result.error);
            return;
        }
        items.unshift(result.value);
        persist();
        render(result.value);
        closeSave();
    };
    saveName.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeSave();
        else if (e.key === "Enter") $("save-confirm").click();
        else return;
        e.preventDefault();
    });

    return {
        refresh(f, parametric) {
            const m = parametric ? "parametric" : "explicit";
            $("insert-var").textContent = VARIABLE[f][m];
            $("theta-hint").hidden = !(f === "disc" && !parametric);
            const [a, b] = LABELS[f][m];
            $("label-a").textContent = a;
            $("label-b").textContent = b ?? "";
            $("wrap-b").hidden = !parametric;
            if (f !== field || !list.hasChildNodes()) {
                field = f;
                render();
            }
        },
    };
}
