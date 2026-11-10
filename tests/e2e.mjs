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
/** A dropped guest's watchdog rejoins after 25 s (ADR 18), plus time for the new signalling exchange. */
const RECONNECT_MS = 35_000;

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
 * `seats` is the host's seat count for the disc field (default `n`); `fakeHostClock` and
 * `fakeGuestClock` install Playwright's fake clock on the host or the first guest before it loads;
 * `blockStorage` makes the host's localStorage refuse writes.
 */
async function startGame(n, field, label, { seats = n, fakeHostClock = false, fakeGuestClock = false, blockStorage = false } = {}) {
    const pages = [];
    const errors = [];
    for (let i = 0; i < n; i++) {
        const page = await (await browser.newContext()).newPage();
        page.on("pageerror", (e) => errors.push(`page ${i}: ${e}`));
        // Counts game-room subscriptions (Nostr REQs other than the lobby's): joining a room sends them.
        page.subscriptions = 0;
        page.on("websocket", (ws) =>
            ws.on("framesent", (f) => {
                const frame = String(f.payload);
                if (frame.startsWith('["REQ"') && !frame.startsWith('["REQ","lobby"')) page.subscriptions++;
            }),
        );
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
        if (i === 0 && blockStorage) {
            await page.addInitScript(() => {
                const set = Storage.prototype.setItem;
                Storage.prototype.setItem = function (key, value) {
                    if (this === localStorage) throw new DOMException("blocked", "QuotaExceededError");
                    return set.call(this, key, value);
                };
            });
        }
        if ((i === 0 && fakeHostClock) || (i === 1 && fakeGuestClock)) await page.clock.install();
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
    // With a game listed, the empty-list text gives way to the table.
    for (const guest of guests) assert.deepEqual(await guest.evaluate(() => [document.getElementById("no-games").hidden, document.getElementById("games-table").hidden]), [true, false]);
    await Promise.all(joins.map((join) => join.click({ timeout: 5000 })));
    await host.waitForFunction((k) => document.querySelectorAll("#room-players li").length === k, n, { timeout: SETUP_MS });
    for (const page of pages) assert.equal(await text(page, "#room-title"), name, "the waiting room is titled with the game name");
    const seatsLine = await text(host, "#room-seats");
    await host.click("#start");
    for (const page of pages) await page.waitForSelector("#game:not([hidden]), #end:not([hidden])", { timeout: SETUP_MS });
    return { pages, errors, seatsLine };
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

/** Fast-forwards `page`'s fake clock by `time`: it must not join a game room or open a connection meanwhile. */
async function assertQuiet(page, time) {
    const before = [page.subscriptions, await page.evaluate(() => window.__pcs.length)];
    await page.clock.fastForward(time);
    await page.waitForTimeout(2000); // real time for a rejoin to reach the relays
    assert.deepEqual([page.subscriptions, await page.evaluate(() => window.__pcs.length)], before, "no rejoin");
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
        for (const page of pages) assert.match(await text(page, "#last-shot"), /^Team \d ran out of time\./);
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
        const { pages, errors, seatsLine } = await startGame(3, "disc", "E", { seats: 2, fakeHostClock: true });
        assert.equal(seatsLine, "More players than seats: the first 2 to join play.");
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
        // A guest's links drop while the tab stays open, and Trystero cannot reconnect on its own, as
        // when it answers a stale copy of an offer and waits for its next announce (ADR 18). The
        // guest's watchdog rejoins the room after 25 s; the guest keeps its seat, gets a replay, and
        // both sides play on. O covers a quick reconnect.
        const { pages, errors } = await startGame(2, "disc", "G");
        const guest = pages[1];
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const dropped = Date.now();
        const links = await guest.evaluate(() => {
            window.__pcs.forEach(window.__drop);
            // Every connection opened in the next 10 s dies at once.
            const until = Date.now() + 10_000;
            const Recorded = window.RTCPeerConnection;
            window.RTCPeerConnection = class extends Recorded {
                constructor(...args) {
                    super(...args);
                    if (Date.now() < until) setTimeout(() => window.__drop(this));
                }
            };
            return window.__pcs.length;
        });
        await guest.waitForFunction((n) => window.__pcs.length > n && window.__pcs.at(-1).connectionState === "connected", links, { timeout: RECONNECT_MS });
        assert.ok(Date.now() - dropped >= 20_000, "the watchdog's rejoin brought the link back");
        // Back before the host's 60 s turn clock runs out; O covers a turn passed during the drop.
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
    async L() {
        // Status bar, roster, last-shot text, tab title, error presentation and the end screen (ADR 17).
        const { pages, errors } = await startGame(2, "xy", "L");
        await assertSynced(pages, 0);
        const page = await shooter(pages);
        const other = pages.find((p) => p !== page);
        assert.equal(await page.evaluate(() => document.activeElement.id), "input-a", "the formula has focus when our turn starts");
        await page.waitForFunction(() => document.getElementById("turn-cue").textContent === "Your turn");
        assert.equal(await text(other, "#turn-cue"), "");
        assert.equal(await page.title(), "Your turn | Graph fight!");
        assert.equal(await other.title(), "Graph fight!");
        assert.equal(await text(page, "#turn"), "Your turn");
        assert.match(await text(other, "#turn"), /^Team \d is aiming$/);
        assert.equal(await page.isHidden("#direction"), true, "the direction is for the disc only");
        assert.equal(await page.locator("#roster li").count(), 2);
        assert.equal(await page.locator('#roster li [aria-label="3 of 3 players left"]').count(), 2);
        const { me } = JSON.parse(await state(page));
        assert.match(await text(page, `#roster li >> nth=${me}`), /\baiming\b/);
        assert.doesNotMatch(await text(page, `#roster li >> nth=${1 - me}`), /aiming/);
        await page.waitForFunction(() => parseFloat(document.getElementById("timer-fill").style.width) > 0, null, { timeout: 5000 });
        // A repeated identical error is cleared first, so the alert is announced again.
        await page.evaluate(() => {
            window.__errors = [];
            new MutationObserver(() => window.__errors.push([document.getElementById("error").textContent, performance.now()])).observe(document.getElementById("error"), { childList: true });
        });
        await page.check("#mode-explicit");
        const shown = (n) => page.waitForFunction((k) => window.__errors.filter(([e]) => e !== "").length >= k, n);
        await page.fill("#input-a", "1/x");
        await page.click("#fire");
        await shown(1);
        assert.equal(await page.getAttribute("#input-a", "aria-invalid"), "true");
        assert.equal(await page.getAttribute("#input-b", "aria-invalid"), null, "the hidden input is not marked");
        await page.click("#fire");
        await shown(2);
        const log = await page.evaluate(() => window.__errors);
        // Each repeat is emptied first and filled at least one frame later, so a screen reader announces it again.
        assert.ok(log.length >= 3, "the second error went through an empty line");
        assert.ok(log.every(([e, t], i) => e === "" || i === 0 || (log[i - 1][0] === "" && t - log[i - 1][1] >= 30)), "an error is never replaced by text directly");
        await page.fill("#input-a", "x");
        assert.equal(await text(page, "#error"), "");
        assert.equal(await page.getAttribute("#input-a", "aria-invalid"), null);
        await page.click("#fire");
        await assertSynced(pages, 1);
        for (const p of pages) assert.match(await text(p, "#last-shot"), /^Team \d fired y = x\./);
        assert.equal(await page.title(), "Graph fight!", "the title is restored after the turn");
        // The end screen has a headline and an explanation, and focus moves to the headline.
        await other.click("#quit");
        await page.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.match(await text(page, "#end-message"), /win/i);
        assert.equal(await page.evaluate(() => document.activeElement.id), "end-message");
        return errors;
    },
    async M() {
        // Direction (disc only): clockwise mirrors the shot across the shooter's axis to the centre.
        const { pages, errors, seatsLine } = await startGame(2, "disc", "M", { seats: 3 });
        assert.equal(seatsLine, "1 seat open");
        await assertSynced(pages, 0);
        // `r = t, θ = 0.5` is a straight ray 0.5 rad from the axis: to the left (counter-clockwise) or right.
        const aim = async (cw) => {
            const page = await shooter(pages);
            const before = JSON.parse(await state(page));
            const { pos } = before.arena.teams[before.current].players[before.arena.teams[before.current].currentPlayer].shape;
            assert.equal(await page.isVisible("#direction"), true);
            await page.check(cw ? "#dir-cw" : "#dir-ccw");
            await page.check("#mode-parametric");
            await page.fill("#input-a", "t");
            await page.fill("#input-b", "0.5");
            await page.click("#fire");
            await assertSynced(pages, before.turn + 1);
            const { shot } = JSON.parse(await state(page));
            const [from, to] = shot.points;
            const d = Math.hypot(pos.x, pos.y);
            const forward = { x: -pos.x / d, y: -pos.y / d };
            const v = { x: to.x - from.x, y: to.y - from.y };
            return Math.atan2(forward.x * v.y - forward.y * v.x, forward.x * v.x + forward.y * v.y);
        };
        const ccw = await aim(false);
        const cw = await aim(true);
        assert.equal(await pages[0].isHidden("#direction"), false);
        assert.ok(Math.abs(ccw - 0.5) < 0.05, `counter-clockwise turns left (${ccw})`);
        assert.ok(Math.abs(cw + 0.5) < 0.05, `clockwise turns right (${cw})`);
        return errors;
    },
    async N() {
        // A guest's tab dies. The host keeps its seat, and shows it as disconnected (ADR 16, 17).
        const { pages, errors } = await startGame(2, "xy", "N");
        const [host, guest] = pages;
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        // The guest's team must be the current one when it disappears.
        if (await host.isEnabled("#fire")) await takeTurn(pages, 0, ["x"]);
        await guest.close();
        await host.waitForFunction(() => document.getElementById("roster").textContent.includes("disconnected"), null, { timeout: SETUP_MS });
        assert.match(await text(host, "#roster li >> nth=1"), /disconnected/);
        assert.doesNotMatch(await text(host, "#roster li >> nth=0"), /disconnected/);
        assert.match(await text(host, "#turn"), /^Team 2 is disconnected/);
        return errors;
    },
    async O() {
        // A guest's links drop and the host's turn clock runs out before Trystero reconnects: the
        // replay brings the timeout the guest missed, and both sides play on from there.
        const { pages, errors } = await startGame(2, "disc", "O", { fakeHostClock: true });
        const guest = pages[1];
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const links = await guest.evaluate(() => {
            window.__pcs.forEach(window.__drop);
            return window.__pcs.length;
        });
        // Runs before Trystero can open a new link, which takes Nostr round trips.
        await pages[0].clock.fastForward("01:01");
        await guest.waitForFunction((n) => window.__pcs.length > n && window.__pcs.at(-1).connectionState === "connected", links, { timeout: SETUP_MS });
        const { turn } = JSON.parse(await state(pages[0]));
        assert.ok(turn >= 1, "the turn clock ran out during the drop");
        await assertSynced(pages, turn);
        await takeTurn(pages, turn, ["2"]);
        await takeTurn(pages, turn + 1, ["t", "0"]);
        return errors;
    },
    async P() {
        // After its game ends, a guest leaves the room: it does not keep rejoining a host that is gone (ADR 18).
        const { pages, errors } = await startGame(2, "disc", "P", { fakeGuestClock: true });
        const [host, guest] = pages;
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await host.close({ runBeforeUnload: true });
        await guest.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        await guest.waitForTimeout(2000); // real time for the host's links to close
        await assertQuiet(guest, "00:30");
        return errors;
    },
    async Q() {
        // A host tab that dies without its quit leaves the guest rejoining, less and less often.
        // After 3 minutes the guest gives the game up and stops (ADR 18).
        const { pages, errors } = await startGame(2, "disc", "Q", { fakeGuestClock: true });
        const [host, guest] = pages;
        await assertSynced(pages, 0);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await host.close();
        await guest.waitForFunction(() => document.getElementById("turn").textContent.startsWith("Reconnecting"), null, { timeout: TURN_WAIT_MS });
        // Rejoins come 25, 75 and 175 s after the drop. Each fast-forward fires a due timer at most
        // once, and the waits give the rejoin real time to reach the relays.
        const step = async (time) => {
            const before = guest.subscriptions;
            await guest.clock.fastForward(time);
            await guest.waitForTimeout(1000);
            return guest.subscriptions > before;
        };
        assert.ok(await step("00:30"), "the guest rejoined after 25 s");
        assert.equal(await step("00:35"), false, "the second wait doubles: no rejoin 50 s after the drop");
        assert.ok(await step("00:15"), "the guest rejoined after 75 s");
        assert.equal(await guest.isVisible("#end"), false, "the guest still waits for the host");
        for (let i = 0; i < 4; i++) {
            await guest.clock.fastForward("00:30");
            await guest.waitForTimeout(500);
        }
        await guest.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.equal(await text(guest, "#end-message"), "Host unreachable.");
        await assertQuiet(guest, "05:00");
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
