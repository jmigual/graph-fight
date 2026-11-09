// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css" };
const SETUP_MS = 120_000;
const TURN_WAIT_MS = 30_000;

// Tiny static server for dist/.
const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(DIST, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(DIST)) return void res.writeHead(403).end();
    try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

const state = (page) => page.evaluate(() => JSON.stringify(window.__state()));
const comparable = async (page) => {
    const { me, ...rest } = JSON.parse(await state(page));
    return rest;
};

/**
 * Opens `n` pages (separate contexts) and brings them into one started game; pages[0] hosts.
 * `seats` is the host's seat count for the disc field (default `n`); `fakeHostClock` installs
 * Playwright's fake clock on the host before it loads.
 */
async function startGame(n, field, label, { seats = n, fakeHostClock = false } = {}) {
    const pages = [];
    const errors = [];
    for (let i = 0; i < n; i++) {
        const page = await (await browser.newContext()).newPage();
        page.on("pageerror", (e) => errors.push(`page ${i}: ${e}`));
        // Leave game asks for confirmation (ADR 17): record the message, then accept unless told to dismiss.
        page.dialogs = [];
        page.on("dialog", (d) => {
            page.dialogs.push(d.message());
            return page.dismissDialogs ? d.dismiss() : d.accept();
        });
        // Records the page's WebRTC connections so a scenario can drop its links with `__drop`.
        await page.addInitScript(() => {
            const Native = RTCPeerConnection;
            window.__pcs = [];
            // A local close() fires no state event, so announce it the way a dead link would.
            window.__drop = (pc) => {
                pc.close();
                pc.dispatchEvent(new Event("iceconnectionstatechange"));
            };
            window.RTCPeerConnection = class extends Native {
                constructor(...args) {
                    super(...args);
                    window.__pcs.push(this);
                }
            };
        });
        if (i === 0 && fakeHostClock) await page.clock.install();
        await page.goto(url);
        pages.push(page);
    }
    const name = `e2e-${label}-${Math.random().toString(36).slice(2, 8)}`;
    const [host, ...guests] = pages;
    await host.fill("#host-name", name);
    await host.selectOption("#host-field", field);
    if (field === "disc") await host.fill("#host-seats", String(seats));
    await host.click("#host-form button");
    // Everyone sees the game before anyone joins, so with fewer seats than guests all still find a free seat.
    const joins = guests.map((guest) => guest.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }));
    await Promise.all(joins.map((join) => join.waitFor({ timeout: SETUP_MS })));
    await Promise.all(joins.map((join) => join.click({ timeout: 5000 })));
    await host.waitForFunction((k) => document.querySelectorAll("#room-players li").length === k, n, { timeout: SETUP_MS });
    await host.click("#start");
    for (const page of pages) await page.waitForSelector("#game:not([hidden]), #end:not([hidden])", { timeout: SETUP_MS });
    return { pages, errors };
}

/** Waits until exactly one page can fire and returns it. */
async function shooter(pages) {
    const deadline = Date.now() + TURN_WAIT_MS;
    while (Date.now() < deadline) {
        const ready = [];
        for (const page of pages) if (await page.isEnabled("#fire")) ready.push(page);
        if (ready.length === 1) return ready[0];
        await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error("no page became the shooter");
}

/** Every page must have applied turn `turn` and hold an identical arena. */
async function assertSynced(pages, turn) {
    for (const page of pages) {
        await page.waitForFunction((t) => window.__state()?.turn === t, turn, { timeout: TURN_WAIT_MS });
    }
    const [first, ...rest] = await Promise.all(pages.map(comparable));
    for (const other of rest) assert.deepEqual(other, first, `state diverged at turn ${turn}`);
}

/** Plays one turn from whoever's turn it is. `exprs` has one formula (explicit) or two (parametric). */
async function takeTurn(pages, turn, exprs) {
    const page = await shooter(pages);
    if (exprs.length === 2) await page.check("#mode-parametric");
    else await page.check("#mode-explicit");
    await page.fill("#input-a", exprs[0]);
    if (exprs.length === 2) await page.fill("#input-b", exprs[1]);
    await page.click("#fire");
    await assertSynced(pages, turn + 1);
}

/** A formula undefined at the shooter is rejected locally and does not use the turn. */
async function assertRejected(pages, turn, expr) {
    const page = await shooter(pages);
    await page.check("#mode-explicit");
    await page.fill("#input-a", expr);
    await page.click("#fire");
    await page.waitForFunction(() => document.getElementById("error").textContent !== "");
    assert.equal(await page.isEnabled("#fire"), true, "fire stays enabled after a rejected formula");
    await assertSynced(pages, turn);
}

const text = (page, sel) => page.locator(sel).innerText();

const scenarios = {
    async A() {
        const { pages, errors } = await startGame(2, "xy", "A");
        await assertSynced(pages, 0);
        await assertRejected(pages, 0, "1/x");
        await takeTurn(pages, 0, ["x"]);
        await takeTurn(pages, 1, ["t", "t"]);
        await takeTurn(pages, 2, ["-x"]);
        // The guest leaves the game, so the host's team is the last one standing.
        // Dismissing the confirm keeps the player in the game.
        pages[1].dismissDialogs = true;
        await pages[1].click("#quit");
        assert.match(pages[1].dialogs.at(-1), /Leave the game/);
        assert.equal(await pages[1].isVisible("#game"), true, "dismissing Leave game stays in the game");
        pages[1].dismissDialogs = false;
        await pages[1].click("#quit");
        await pages[0].waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.match(await text(pages[0], "#end-message"), /win/i);
        return errors;
    },
    async B() {
        const { pages, errors } = await startGame(3, "disc", "B");
        await assertSynced(pages, 0);
        await takeTurn(pages, 0, ["2"]);
        await takeTurn(pages, 1, ["t", "0"]);
        await takeTurn(pages, 2, ["1+θ"]);
        const leaver = pages[2];
        const team = JSON.parse(await state(leaver)).me;
        await leaver.click("#quit");
        const rest = pages.slice(0, 2);
        for (const page of rest) {
            await page.waitForFunction((t) => window.__state().arena.teams[t].players.every((p) => !p.alive), team, { timeout: TURN_WAIT_MS });
        }
        const { turn } = JSON.parse(await state(rest[0]));
        await assertSynced(rest, turn);
        await takeTurn(rest, turn, ["t", "0"]);
        return errors;
    },
    async C() {
        const { pages, errors } = await startGame(2, "disc", "C");
        await assertSynced(pages, 0);
        await assertRejected(pages, 0, "1/θ");
        await takeTurn(pages, 0, ["t", "0"]);
        await takeTurn(pages, 1, ["3"]);
        // The host leaves: the guest must end the game.
        await pages[0].close({ runBeforeUnload: true });
        await pages[1].waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.match(await text(pages[1], "#end-message"), /host left/i);
        return errors;
    },
    async D() {
        // The host's clock is faked, so the 60 s turn timeout fires without waiting.
        const { pages, errors } = await startGame(2, "xy", "D", { fakeHostClock: true });
        await assertSynced(pages, 0);
        const before = await comparable(pages[0]);
        await pages[0].clock.fastForward("01:01");
        await assertSynced(pages, 1);
        const after = await comparable(pages[0]);
        assert.notEqual(after.current, before.current, "the timeout passes the turn");
        const alive = (c) => c.arena.teams.map((t) => t.players.map((pl) => pl.alive));
        assert.deepEqual([alive(after), after.arena.holes], [alive(before), before.arena.holes], "a timeout fires no shot");
        // The clock was re-armed for the next turn.
        await pages[0].clock.fastForward("01:01");
        await assertSynced(pages, 2);
        assert.equal((await comparable(pages[0])).current, before.current);
        await takeTurn(pages, 2, ["x"]);
        return errors;
    },
    async E() {
        // Three pages, two seats: the host starts with the first guest to connect.
        const { pages, errors } = await startGame(3, "disc", "E", { seats: 2, fakeHostClock: true });
        const [host, ...guests] = pages;
        const full = [];
        const seated = [];
        for (const g of guests) (await g.isVisible("#end")) ? full.push(g) : seated.push(g);
        assert.equal(full.length, 1, "exactly one guest has no seat");
        assert.match(await text(full[0], "#end-message"), /full/i);
        const players = [host, ...seated];
        await assertSynced(players, 0);
        // The seatless guest leaving must not restart the host's turn clock: 40 s, the leave, then
        // 25 s more reach the original 60 s deadline. A re-armed clock would not fire yet.
        await host.clock.fastForward("00:40");
        await full[0].close({ runBeforeUnload: true });
        await host.waitForTimeout(3000); // real time for the host to see the peer leave
        await host.clock.fastForward("00:25");
        await assertSynced(players, 1);
        await takeTurn(players, 1, ["t", "0"]);
        return errors;
    },
    async F() {
        // A guest reloads mid-game and takes its seat back with the token kept in sessionStorage.
        const { pages, errors } = await startGame(2, "disc", "F");
        await assertSynced(pages, 0);
        await takeTurn(pages, 0, ["2"]);
        const guest = pages[1];
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const { me } = JSON.parse(await state(guest));
        await guest.reload();
        await guest.waitForFunction(() => window.__state()?.turn === 1, null, { timeout: SETUP_MS });
        await assertSynced(pages, 1);
        assert.equal(JSON.parse(await state(guest)).me, me, "the reloaded page holds the same seat");
        // The guest's team is up next, so this also checks the host accepts shots from its new peer id.
        assert.equal(JSON.parse(await state(guest)).current, me);
        await takeTurn(pages, 1, ["t", "0"]);
        await takeTurn(pages, 2, ["3"]);
        return errors;
    },
    async G() {
        // A guest's links drop while the tab stays open. It keeps its seat, Trystero reconnects,
        // and the guest rejoins with a replay; then both sides play on.
        const { pages, errors } = await startGame(2, "disc", "G");
        const guest = pages[1];
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const links = await guest.evaluate(() => {
            window.__pcs.forEach(window.__drop);
            return window.__pcs.length;
        });
        // Trystero only opens a new connection to the host once it has noticed the old one died.
        await guest.waitForFunction((n) => window.__pcs.length > n && window.__pcs.at(-1).connectionState === "connected", links, { timeout: SETUP_MS });
        await takeTurn(pages, 0, ["2"]);
        await takeTurn(pages, 1, ["t", "0"]);
        return errors;
    },
    async H() {
        // A tab restored with a seat from the host's previous game lands in the host's next waiting
        // room (same room id). If the host leaves it, the tab ends with "Host left"; if the host
        // starts, the stale seat is dropped and the tab plays under its own id.
        const { pages, errors } = await startGame(2, "xy", "H");
        const [host, old] = pages;
        await old.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const seat = await old.evaluate(() => sessionStorage.getItem("graph-fight-seat"));
        await old.close();
        await host.click("#quit");
        const restored = await (await browser.newContext()).newPage();
        restored.on("pageerror", (e) => errors.push(`restored: ${e}`));
        // Runs on every load, so each reload restores the stale seat again.
        await restored.addInitScript((s) => sessionStorage.setItem("graph-fight-seat", s), seat);
        await restored.goto(url);
        assert.equal(await text(restored, "#room-status"), "Rejoining…");
        const hostAgain = async () => {
            await host.fill("#host-name", `e2e-H-${Math.random().toString(36).slice(2, 8)}`);
            await host.click("#host-form button");
        };
        const twoPlayers = () => host.waitForFunction(() => document.querySelectorAll("#room-players li").length === 2, null, { timeout: SETUP_MS });
        await hostAgain();
        await twoPlayers();
        await host.click("#leave");
        await restored.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.match(await text(restored, "#end-message"), /host left/i);
        // The ended page left the room, so the host's next game in the same room does not pick it up.
        await hostAgain();
        await host.waitForTimeout(5000);
        assert.equal(await host.locator("#room-players li").count(), 1, "the ended page stays out of the next game");
        await restored.reload();
        await twoPlayers();
        await host.click("#start");
        const players = [host, restored];
        await assertSynced(players, 0);
        await takeTurn(players, 0, ["x"]);
        await takeTurn(players, 1, ["-x"]);
        return errors;
    },
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
        assert.equal(await input.inputValue(), "pi");
        await key("√").click();
        await key("( )").click();
        await key("^").click();
        assert.equal(await input.inputValue(), "pisqrt((^))");
        await page.locator("#helpers summary").click();
        await key("floor").click();
        assert.equal(await input.inputValue(), "pisqrt((^floor()))");
        // The variable follows the field and mode; the parametric buttons target the last focused input.
        assert.equal(await text(page, "#insert-var"), "x");
        await page.check("#mode-parametric");
        assert.equal(await text(page, "#insert-var"), "t");
        await page.fill("#input-b", "");
        await key("t").click();
        assert.equal(await page.inputValue("#input-b"), "t");
        await page.check("#mode-explicit");
        assert.equal(await text(page, "#insert-var"), "x");
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
};

let failed = 0;
const started = Date.now();
for (const [name, run] of Object.entries(scenarios)) {
    const t0 = Date.now();
    try {
        const errors = await run();
        assert.deepEqual(errors, [], "uncaught page errors");
        console.log(`ok   ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (err) {
        failed++;
        console.log(`FAIL ${name}: ${err.stack ?? err}`);
    }
    await Promise.all(browser.contexts().map((c) => c.close()));
}
await browser.close();
server.close();
console.log(`${Object.keys(scenarios).length - failed}/${Object.keys(scenarios).length} scenarios passed in ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(failed ? 1 : 0);
