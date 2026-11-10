// End-to-end scenarios: the formula editor, saved formulas and the per-character shot memory (ADR 17).
import assert from "node:assert/strict";
import { SETUP_MS, TURN_WAIT_MS, assertRejected, assertSynced, shooter, startGame, state, takeTurn, text } from "./helpers.mjs";

export const scenarios = {
    async I() {
        // Helper buttons insert at the caret of the last focused formula input and keep the focus.
        const { pages, errors } = await startGame(2, "xy", "I");
        const page = pages[0];
        const input = page.locator("#input-a");
        const key = (label) => page.locator("#helpers").getByRole("button", { name: label, exact: true });
        const caret = () => page.evaluate(() => [document.activeElement.id, document.activeElement.selectionStart, document.activeElement.selectionEnd]);
        await input.fill("x+1");
        await input.selectText();
        await key("sin").click();
        assert.equal(await input.inputValue(), "sin(x+1)");
        assert.deepEqual(await caret(), ["input-a", 8, 8], "a wrapped selection leaves the caret after the bracket");
        await input.fill("");
        await key("cos").click();
        assert.equal(await input.inputValue(), "cos()");
        assert.deepEqual(await caret(), ["input-a", 4, 4], "without a selection the caret goes between the brackets");
        await input.fill("");
        await key("π").click();
        assert.equal(await input.inputValue(), "π", "the π button inserts pi, which is typed as π");
        await key("√").click();
        await key("( )").click();
        await key("^").click();
        assert.equal(await input.inputValue(), "πsqrt((^))");
        await page.locator("#helpers summary").click();
        await key("floor").click();
        assert.equal(await input.inputValue(), "πsqrt((^floor()))");
        // The variable follows the field and mode; the parametric buttons target the last focused input.
        assert.equal(await text(page, "#insert-var"), "x");
        await page.check("#mode-parametric");
        assert.equal(await text(page, "#insert-var"), "t");
        await page.fill("#input-b", "");
        await key("t").click();
        assert.equal(await page.inputValue("#input-b"), "t");
        await page.check("#mode-explicit");
        assert.equal(await text(page, "#insert-var"), "x");
        // The hidden second input is never the target, even if it was the last one focused.
        await page.evaluate(() => (document.getElementById("input-a").value = ""));
        await key("sin").click();
        assert.equal(await input.inputValue(), "sin()");
        assert.equal(await page.inputValue("#input-b"), "t");
        // A helper does not overrun the parser's 256 character limit.
        await input.fill("x".repeat(255));
        await key("sin").click();
        assert.equal((await input.inputValue()).length, 255);
        return errors;
    },
    async J() {
        // Starter templates, saving a template, its sliders, Insert and Fire.
        const { pages, errors } = await startGame(2, "xy", "J");
        await assertSynced(pages, 0);
        const page = await shooter(pages);
        // The first visit lists the starters of this field only.
        assert.equal(await page.locator("#saved-list li", { hasText: "Parabola" }).count(), 1);
        assert.equal(await page.locator("#saved-list li", { hasText: "Spiral" }).count(), 0);
        // A slider letter in the editor is refused with a friendlier message than the parser's.
        await assertRejected(pages, 0, "a*x");
        assert.match(await text(page, "#error"), /slider letter/);
        await page.fill("#input-a", "a*x");
        await page.click("#save");
        assert.equal(await page.inputValue("#save-name"), "a*x");
        await page.fill("#save-name", "Mine");
        await page.getByRole("button", { name: "Save formula" }).click();
        assert.equal(await page.isHidden("#save-row"), true);
        const item = page.locator("#saved-list li", { hasText: "Mine" });
        assert.equal(await item.locator("details").evaluate((d) => d.open), true, "a new template opens its sliders");
        const slider = (label) => item.locator(`[aria-label="${label}"]`);
        // Compact like Desmos: the range and the value share a line, and Lowest, Highest and Step share the next one.
        const middle = async (label) => {
            const box = await slider(label).boundingBox();
            return Math.round(box.y + box.height / 2);
        };
        assert.equal(await middle("a"), await middle("Value of a"), "the range and the value are on one line");
        assert.equal(new Set([await middle("Lowest a"), await middle("Highest a"), await middle("Step of a")]).size, 1, "the limits and the step are on one line");
        assert.ok((await item.locator("details").boundingBox()).height < 150, "a one-slider block is compact");
        await slider("Value of a").fill("-2");
        assert.equal(await item.locator(".preview").innerText(), "→ (-2)*x");
        // Editing the limits updates the range; limits that cross keep the old ones.
        await slider("Highest a").fill("-50");
        await slider("Highest a").press("Tab");
        assert.equal(await slider("a").getAttribute("max"), "10");
        assert.equal(await slider("Highest a").evaluate((i) => i.validity.valid), false);
        await slider("Lowest a").fill("-20");
        await slider("Lowest a").press("Tab");
        assert.equal(await slider("a").getAttribute("min"), "-20");
        await slider("Step of a").fill("0.5");
        await slider("Step of a").press("Tab");
        assert.equal(await slider("a").getAttribute("step"), "0.5");
        assert.equal(await item.locator(".preview").innerText(), "→ (-2)*x");
        // Slider changes are saved.
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("graph-fight.formulas")).items.find((i) => i.name === "Mine"));
        assert.deepEqual(saved.sliders.a, { min: -20, max: 10, step: 0.5, value: -2 });
        await item.getByRole("button", { name: "Insert" }).click();
        assert.equal(await page.inputValue("#input-a"), "(-2)*x");
        assert.equal(await text(page, "#error"), "");
        assert.equal(await page.evaluate(() => document.activeElement.id), "input-a");
        await page.click("#fire");
        await assertSynced(pages, 1);
        // Delete asks first and removes the template from the list and from storage.
        await item.getByRole("button", { name: "Delete Mine" }).click();
        assert.equal(await page.locator("#saved-list li", { hasText: "Mine" }).count(), 0);
        assert.equal(await page.evaluate(() => localStorage.getItem("graph-fight.formulas").includes("Mine")), false);
        return errors;
    },
    async K() {
        // Storage that refuses writes: the notice shows and the list keeps working in memory.
        const { pages, errors } = await startGame(2, "xy", "K", { blockStorage: true });
        const page = pages[0];
        assert.equal(await page.isVisible("#saved-notice"), true);
        assert.equal(await page.locator("#saved-list li", { hasText: "Parabola" }).count(), 1, "starters are listed from memory");
        // `2a` would silently become `21.5`, so saving it is refused.
        await page.fill("#input-a", "2b");
        await page.click("#save");
        await page.getByRole("button", { name: "Save formula" }).click();
        assert.equal(await page.isVisible("#save-row"), true);
        assert.match(await text(page, "#save-error"), /2\*b/);
        await page.fill("#input-a", "a+".repeat(100) + "a");
        await page.click("#save");
        await page.fill("#save-name", "Long");
        await page.getByRole("button", { name: "Save formula" }).click();
        const item = page.locator("#saved-list li", { hasText: "Long" });
        assert.equal(await item.count(), 1, "saving works in memory");
        assert.equal(await item.getByRole("button", { name: "Insert Long" }).isDisabled(), false);
        // Each `a` grows from 1 to (-2) characters wide: the result passes 256 and Insert is disabled.
        await item.locator('[aria-label="Value of a"]').fill("-2");
        assert.equal(await item.getByRole("button", { name: "Insert Long" }).isDisabled(), true);
        assert.match(await item.locator(".error").innerText(), /256/);
        await item.getByRole("button", { name: "Delete Long" }).click();
        assert.equal(await page.evaluate(() => document.activeElement.tagName), "BUTTON", "focus moves to the next item");
        return errors;
    },
    async V() {
        // Each character remembers its last shot (ADR 17): its path stays on the board while it lives,
        // and on its next turn its formulas, mode and direction fill the editor again, not the last
        // shooter's. A rejoined page gets both back from the host's replay (ADR 16).
        const { pages, errors } = await startGame(2, "disc", "V");
        const memory = new Map();
        let restored = 0;
        const editor = (page) =>
            page.evaluate(() => ({
                parametric: document.getElementById("mode-parametric").checked,
                a: document.getElementById("input-a").value,
                b: document.getElementById("input-b").value,
                cw: document.getElementById("dir-cw").checked,
            }));
        const characterOf = ({ current, arena }) => `${current}:${arena.teams[current].currentPlayer}`;
        // Parametric rays, clockwise, alternate with steep explicit curves that leave the disc at once, two
        // rounds each. A character fires every third round of its team, so the shape it last fired
        // differs from the previous shooter's, and a restore that skipped the mode or direction shows.
        const fire = async (page, turn) => {
            const key = characterOf(JSON.parse(await state(page)));
            const known = memory.get(key);
            if (known) {
                assert.deepEqual(await editor(page), known, `turn ${turn}: the editor holds the last shot of character ${key}`);
                restored++;
            }
            const next = Math.floor(turn / 4) % 2 === 1 ? { parametric: true, a: "t", b: `0.0${turn}`, cw: true } : { parametric: false, a: `${100 + turn}*θ`, b: "", cw: false };
            await page.check(next.parametric ? "#mode-parametric" : "#mode-explicit");
            await page.check(next.cw ? "#dir-cw" : "#dir-ccw");
            await page.fill("#input-a", next.a);
            if (next.parametric) await page.fill("#input-b", next.b);
            await page.click("#fire");
            memory.set(key, next);
            await assertSynced(pages, turn + 1);
        };
        await assertSynced(pages, 0);
        // Five rounds: every character fires once, and the first two of each team twice.
        for (let turn = 0; turn < 10; turn++) await fire(await shooter(pages), turn);
        assert.ok(restored >= 4, `formulas were restored on later turns (${restored})`);
        const { faint } = JSON.parse(await state(pages[0]));
        assert.ok(faint > 1, `older paths stay on the board (${faint})`);
        // Reload the guest on its own turn: the replay brings the paths and its formulas back.
        const guest = pages[1];
        let turn = 10;
        while (JSON.parse(await state(guest)).current !== JSON.parse(await state(guest)).me) await fire(await shooter(pages), turn++);
        const before = JSON.parse(await state(guest));
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await guest.reload();
        await guest.waitForFunction((t) => window.__state()?.turn === t && !document.getElementById("fire").disabled, turn, { timeout: SETUP_MS });
        assert.equal(JSON.parse(await state(guest)).faint, before.faint, "the replay restores the older paths");
        assert.deepEqual(await editor(guest), memory.get(characterOf(before)), "the replay restores the character's formula");
        return errors;
    },
    async W() {
        // A rejoin replays the game onto the turn we are already on (ADR 16): a formula typed meanwhile
        // must survive it, though the character's last shot would be restored by a fresh start.
        const { pages, errors } = await startGame(2, "disc", "W");
        const guest = pages[1];
        await assertSynced(pages, 0);
        // Each team's characters fire once (6 turns), so on the guest's next turn its character has a shot to restore.
        let turn = 0;
        const guestUp = async () => {
            const { current, me } = JSON.parse(await state(guest));
            return current === me;
        };
        while (turn < 6 || !(await guestUp())) await takeTurn(pages, turn, ["t", "0"]), turn++;
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await guest.fill("#input-a", "draft");
        // The replay's start puts the direction back to counter-clockwise: that shows it ran.
        await guest.check("#dir-cw");
        const links = await guest.evaluate(() => {
            window.__pcs.forEach(window.__drop);
            return window.__pcs.length;
        });
        await guest.waitForFunction((n) => window.__pcs.length > n && window.__pcs.at(-1).connectionState === "connected", links, { timeout: SETUP_MS });
        await guest.waitForFunction(() => document.getElementById("dir-ccw").checked, null, { timeout: SETUP_MS });
        await assertSynced(pages, turn);
        assert.equal(await guest.inputValue("#input-a"), "draft", "the draft survives the replay of the same turn");
        return errors;
    },
    async AG() {
        // The editor memory starts afresh in the host's next game (ADR 17, section 7): after a long first
        // game, a character's formula still comes back on its second turn of the second one.
        const { pages, errors } = await startGame(2, "xy", "AG");
        const [host, guest] = pages;
        await assertSynced(pages, 0);
        // Steep shots leave the field at once, so nobody is hit.
        for (let turn = 0; turn < 8; turn++) await takeTurn(pages, turn, [`${200 + turn}*x`]);
        await guest.click("#quit");
        await host.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        await host.click("#back");
        const name = `e2e-AG-${Math.random().toString(36).slice(2, 8)}`;
        await host.fill("#host-name", name);
        await host.click("#host-form button[type=submit]");
        await guest.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }).click({ timeout: SETUP_MS });
        await host.waitForFunction(() => document.querySelectorAll("#room-players li").length === 2, null, { timeout: SETUP_MS });
        await host.click("#start");
        await assertSynced(pages, 0);
        const memory = new Map();
        let restored = 0;
        for (let turn = 0; turn < 8; turn++) {
            const page = await shooter(pages);
            const { current, arena } = JSON.parse(await state(page));
            const key = `${current}:${arena.teams[current].currentPlayer}`;
            if (memory.has(key)) {
                assert.equal(await page.inputValue("#input-a"), memory.get(key), `turn ${turn}: character ${key} gets its formula back in the second game`);
                restored++;
            }
            memory.set(key, `${100 + turn}*x`);
            await page.check("#mode-explicit");
            await page.fill("#input-a", memory.get(key));
            await page.click("#fire");
            await assertSynced(pages, turn + 1);
        }
        // A team has 3 characters and plays 4 turns, so each revisits one at least. A stray hit on a random
        // arena can kill a character and make the rest come round more often, so only a floor is certain.
        assert.ok(restored >= 2, `both teams revisited a character (${restored} restored)`);
        return errors;
    },
    async AH() {
        // Typing the whole word theta or pi in a formula input gives θ or π, with the caret kept, and the
        // result fires (ADR 17). `th` stays as typed: it is a parser alias, and theta passes through it.
        // The hint offers theta only where θ is the variable.
        const { pages, errors } = await startGame(2, "disc", "AH");
        await assertSynced(pages, 0);
        const hint = (page) => page.locator("#theta-hint").isVisible();
        const first = await shooter(pages);
        assert.equal(await hint(first), true, "disc function: the hint mentions theta");
        await first.check("#mode-parametric");
        assert.equal(await hint(first), false, "parametric: it does not");
        const typeAndFire = async (typed, shown, turn) => {
            const page = await shooter(pages);
            await page.check("#mode-explicit");
            await page.fill("#input-a", "");
            await page.locator("#input-a").pressSequentially(typed);
            assert.equal(await page.inputValue("#input-a"), shown);
            assert.equal(await page.locator("#input-a").evaluate((el) => el.selectionStart), shown.length, "the caret stays at the end");
            await page.click("#fire");
            await assertSynced(pages, turn + 1);
        };
        // The shots climb steeply and leave the disc at once, so none can kill and the turn always advances.
        await typeAndFire("1000*theta", "1000*θ", 0);
        await typeAndFire("1000*th", "1000*th", 1);
        await typeAndFire("1000*pi*th", "1000*π*th", 2);
        return errors;
    },
};
