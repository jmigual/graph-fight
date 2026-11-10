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
 * `seats` is the host's seat count for the disc field (default `n`); `frame` is the shot frame,
 * `map` (default) or `player` (ADR 20), shown in the lobby and the waiting room; `fakeHostClock` and
 * `fakeGuestClock` install Playwright's fake clock on the host or the first guest before it loads;
 * `blockStorage` makes the host's localStorage refuse writes; `bots` lists the levels of the bots the
 * host adds before anyone joins (ADR 21); `locals` is the number of local players it adds before them
 * (ADR 22); `offline` cuts the pages' network once they have loaded.
 */
async function startGame(n, field, label, { seats = n, frame = "map", fakeHostClock = false, fakeGuestClock = false, blockStorage = false, bots = [], locals = 0, offline = false } = {}) {
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
                // The host's lobby announcement carries the version the lobby checks (ADR 12).
                const announced = frame.startsWith('["EVENT"') && /\\"version\\":\\"([^"\\]+)\\"/.exec(frame);
                if (announced) page.announced = announced[1];
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
        if (offline) await page.context().setOffline(true);
        pages.push(page);
    }
    const name = `e2e-${label}-${Math.random().toString(36).slice(2, 8)}`;
    const [host, ...guests] = pages;
    await host.fill("#host-name", name);
    await host.selectOption("#host-field", field);
    await host.selectOption("#host-frame", frame);
    if (field === "disc") await host.fill("#host-seats", String(seats));
    await host.click("#host-form button");
    for (const level of bots) {
        await host.selectOption("#bot-level", level);
        await host.click("#add-bot");
    }
    if (bots.length) {
        const total = field === "xy" ? 2 : seats;
        assert.equal(await host.isDisabled("#add-bot"), bots.length >= total - 1, "bots fill at most all seats but the host's");
        // Removing the last bot leaves the focus on Add bot; it then comes back under the same id.
        await host.getByRole("button", { name: `Remove Bot ${bots.length}` }).click();
        assert.equal(await host.evaluate(() => document.activeElement.id), "add-bot");
        await host.click("#add-bot");
        assert.equal(await host.getByRole("button", { name: `Remove Bot ${bots.length}` }).count(), 1);
    }
    for (let i = 0; i < locals; i++) await host.click("#add-local");
    if (locals) {
        // Local players are listed before the bots: removing the last one moves the focus to the first bot's Remove, or to Add local player.
        await host.getByRole("button", { name: `Remove Local ${locals}` }).click();
        assert.equal(await host.evaluate(() => document.activeElement.getAttribute("aria-label") ?? document.activeElement.id), bots.length ? "Remove Bot 1" : "add-local");
        await host.click("#add-local");
        assert.equal(await host.getByRole("button", { name: `Remove Local ${locals}` }).count(), 1);
    }
    // Everyone sees the game before anyone joins, so with fewer seats than guests all still find a free seat.
    const joins = guests.map((guest) => guest.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }));
    await Promise.all(joins.map((join) => join.waitFor({ timeout: SETUP_MS })));
    // The footer shows the version the host announced, on the lobby screen...
    await assertBuild(pages, host.announced);
    // The listing counts the bots and local players (ADR 21, 22).
    if (guests.length && (bots.length || locals)) await guests[0].locator("#games tr", { hasText: name }).filter({ hasText: `${1 + bots.length + locals} of ` }).waitFor({ timeout: SETUP_MS });
    // With a game listed, the empty-list text gives way to the table.
    for (const guest of guests) assert.deepEqual(await guest.evaluate(() => [document.getElementById("no-games").hidden, document.getElementById("games-table").hidden]), [true, false]);
    await Promise.all(joins.map((join) => join.click({ timeout: 5000 })));
    await host.waitForFunction((k) => document.querySelectorAll("#room-players li").length === k, n + bots.length + locals, { timeout: SETUP_MS });
    for (const page of pages) assert.equal(await text(page, "#room-title"), name, "the waiting room is titled with the game name");
    for (const page of pages) assert.match(await text(page, "#room-info"), new RegExp(`, ${frame}-centred, `), "the waiting room names the frame");
    const seatsLine = await text(host, "#room-seats");
    await host.click("#start");
    for (const page of pages) await page.waitForSelector("#game:not([hidden]), #end:not([hidden])", { timeout: SETUP_MS });
    // ...and on the game screen.
    await assertBuild(pages, host.announced);
    return { pages, errors, seatsLine };
}

/** Every page's `#build` footer shows the announced build version with an accessible name (ADR 17). */
async function assertBuild(pages, version) {
    assert.ok(version, "the host announced a version");
    for (const page of pages) {
        assert.equal(await text(page, "#build"), `v ${version}`);
        assert.equal(await page.getByLabel(`Build version ${version}`).count(), 1);
    }
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
        // The player-centred frame: shots start at local x = 0, so 1/x is undefined there (ADR 20).
        const { pages, errors } = await startGame(2, "xy", "A", { frame: "player" });
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
        await assertBuild([pages[0]], pages[0].announced); // the end screen too
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
        // θ₀ is in [0, 2π] (ADR 20), so ln(-θ) is undefined at every shooter.
        await assertRejected(pages, 0, "ln(-θ)");
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
        // Undefined at the first shooter's x, which is in the left half (ADR 20).
        await page.fill("#input-a", "sqrt(x)");
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
        // Direction (disc only): θ sweeps up from the shooter's map angle, or down when clockwise (ADR 20).
        const { pages, errors, seatsLine } = await startGame(2, "disc", "M", { seats: 3 });
        assert.equal(seatsLine, "1 seat open");
        await assertSynced(pages, 0);
        // `r = 3` orbits the centre at the shooter's distance: it leaves at +90° from the outward
        // radius counter-clockwise, at -90° clockwise.
        const aim = async (cw) => {
            const page = await shooter(pages);
            const before = JSON.parse(await state(page));
            const { pos } = before.arena.teams[before.current].players[before.arena.teams[before.current].currentPlayer].shape;
            assert.equal(await page.isVisible("#direction"), true);
            await page.check(cw ? "#dir-cw" : "#dir-ccw");
            await page.check("#mode-explicit");
            await page.fill("#input-a", "3");
            await page.click("#fire");
            await assertSynced(pages, before.turn + 1);
            const { shot } = JSON.parse(await state(page));
            const d = Math.hypot(pos.x, pos.y);
            for (const p of shot.points) assert.ok(Math.abs(Math.hypot(p.x, p.y) - d) < 1e-9, "the shot orbits the centre");
            const [from, to] = shot.points;
            const out = { x: pos.x / d, y: pos.y / d };
            const v = { x: to.x - from.x, y: to.y - from.y };
            return Math.atan2(out.x * v.y - out.y * v.x, out.x * v.x + out.y * v.y);
        };
        const ccw = await aim(false);
        const cw = await aim(true);
        assert.equal(await pages[0].isHidden("#direction"), false);
        assert.ok(Math.abs(ccw - Math.PI / 2) < 0.05, `counter-clockwise sweeps θ up (${ccw})`);
        assert.ok(Math.abs(cw + Math.PI / 2) < 0.05, `clockwise sweeps θ down (${cw})`);
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
    async R() {
        // Direction in the player-centred frame: clockwise mirrors the shot across the shooter's axis to the centre.
        const { pages, errors } = await startGame(2, "disc", "R", { frame: "player" });
        await assertSynced(pages, 0);
        // `r = t, θ = 0.5` is a straight ray 0.5 rad from the axis: to the left (counter-clockwise) or right.
        const aim = async (cw) => {
            const page = await shooter(pages);
            const before = JSON.parse(await state(page));
            const { pos } = before.arena.teams[before.current].players[before.arena.teams[before.current].currentPlayer].shape;
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
        assert.ok(Math.abs(ccw - 0.5) < 0.05, `counter-clockwise turns left (${ccw})`);
        assert.ok(Math.abs(cw + 0.5) < 0.05, `clockwise turns right (${cw})`);
        return errors;
    },
    async S() {
        // Solo against a Hard bot with the network cut once the page has loaded (ADR 21): the host's
        // page plays the bot, and the game runs to the end.
        const { pages, errors } = await startGame(1, "xy", "S", { bots: ["hard"], offline: true });
        const [host] = pages;
        assert.equal(await host.evaluate(() => navigator.onLine), false);
        assert.equal((await host.locator("#roster .id").allInnerTexts())[1], "Bot 1, hard");
        let waited = Infinity;
        for (let turn = 0; ; turn++) {
            await assertSynced(pages, turn);
            if (await host.isVisible("#end")) break;
            const ours = JSON.parse(await state(host)).current === 0;
            const t0 = Date.now();
            if (ours) {
                // Steep, so it leaves the field at once
                await host.check("#mode-explicit");
                await host.fill("#input-a", "100*x");
                await host.click("#fire");
            } else {
                assert.equal(await text(host, "#turn"), "Team 2 is aiming");
            }
            await host.waitForFunction((t) => window.__state().turn > t, turn, { timeout: TURN_WAIT_MS });
            if (!ours) waited = Math.min(waited, Date.now() - t0);
        }
        assert.match(await text(host, "#end-message"), /^(You win|Team 2 wins|Draw)\./);
        assert.ok(waited >= 1000, `the bot waits before it fires (${waited} ms)`);
        return errors;
    },
    async T() {
        // An online disc game with a Medium bot in the third seat. The guest reloads mid-game and
        // gets the bot's shots in the replay; the host keeps playing the bot (ADR 21).
        const { pages, errors } = await startGame(2, "disc", "T", { seats: 3, bots: ["medium"] });
        const [host, guest] = pages;
        for (const page of pages) assert.equal((await page.locator("#roster .id").allInnerTexts())[2], "Bot 1, medium");
        // Humans fire straight out of the disc, so only the bot can kill and the game lasts.
        const play = async (turn) => {
            const { current } = JSON.parse(await state(host));
            if (current !== 2) return takeTurn(pages, turn, ["t", "0"]);
            await assertSynced(pages, turn + 1);
            const { shot } = JSON.parse(await state(guest));
            assert.equal(shot?.team, 2, "the bot fired");
        };
        await assertSynced(pages, 0);
        for (let turn = 0; turn < 3; turn++) await play(turn);
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await guest.reload();
        await guest.waitForFunction(() => window.__state()?.turn === 3, null, { timeout: SETUP_MS });
        await assertSynced(pages, 3);
        assert.equal((await guest.locator("#roster .id").allInnerTexts())[2], "Bot 1, medium", "the replayed roster names the bot");
        for (let turn = 3; turn < 6; turn++) await play(turn);
        return errors;
    },
    async U() {
        // The host's own shot is drawn with the pen like everyone else's: a redraw of the unchanged
        // shot after Fire (the shot is applied synchronously on the host) must not cut the animation.
        const { pages, errors } = await startGame(2, "xy", "U");
        const [host] = pages;
        assert.equal(await host.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), false);
        await assertSynced(pages, 0);
        // The first shooter is random: let the guest go first if it is up.
        if (!(await host.isEnabled("#fire"))) await takeTurn(pages, 0, ["x"]);
        const { turn } = JSON.parse(await state(host));
        await host.check("#mode-explicit");
        await host.fill("#input-a", "0");
        // The canvas at four instants: the pen is still moving 150 and 300 ms after Fire, and rests at the end.
        // Fire is clicked in the same evaluate, so no round trip sits before the first frame.
        const frames = await host.evaluate(async () => {
            const canvas = document.getElementById("arena");
            const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
            document.getElementById("fire").click();
            const out = [canvas.toDataURL()];
            await wait(150);
            out.push(canvas.toDataURL());
            await wait(150);
            out.push(canvas.toDataURL());
            await wait(1500);
            out.push(canvas.toDataURL());
            return out;
        });
        assert.notEqual(frames[0], frames[1], "the pen is still drawing 150 ms after Fire");
        assert.notEqual(frames[1], frames[2], "and 300 ms after Fire");
        assert.notEqual(frames[2], frames[3], "the final frame replaces the pen");
        await assertSynced(pages, turn + 1);
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
    async X() {
        // Hot seat (ADR 22): the host and a local player take turns in one page, played to the end. The
        // status bar, title and cue name whose turn it is, and each character gets its own last formula back.
        const { pages, errors } = await startGame(1, "xy", "X", { locals: 1 });
        const [host] = pages;
        assert.equal((await host.locator("#roster .id").allInnerTexts())[1], "Local 1");
        const memory = new Map();
        let restored = 0;
        for (let turn = 0; ; turn++) {
            await assertSynced(pages, turn);
            if (await host.isVisible("#end")) break;
            assert.ok(turn < 100, "the game ends");
            const { current, arena } = JSON.parse(await state(host));
            const words = current === 1 ? "Local 1's turn" : "Your turn";
            assert.equal(await text(host, "#turn"), words);
            assert.equal(await host.title(), `${words} | Graph fight!`);
            await host.waitForFunction((w) => document.getElementById("turn-cue").textContent === w, words);
            assert.equal(await host.evaluate(() => document.activeElement.id), "input-a", "the formula has focus on every turn played here");
            const key = `${current}:${arena.teams[current].currentPlayer}`;
            if (memory.has(key)) {
                assert.equal(await host.inputValue("#input-a"), memory.get(key), `turn ${turn}: character ${key} gets its own formula back`);
                restored++;
            }
            // The first round, one shot per character, leaves the field at once (steep), so every character
            // has a formula to get back while the game still runs. Then a straight line through the shooter
            // and the nearest living enemy: y = k x in the map frame is offset to pass through the shooter
            // (ADR 20). Obstacles in the way are dug out shot by shot.
            const { pos } = arena.teams[current].players[arena.teams[current].currentPlayer].shape;
            const targets = arena.teams[1 - current].players.filter((pl) => pl.alive).map((pl) => pl.shape.pos);
            const target = targets.sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))[0];
            const formula = turn < 6 ? `${100 + turn}*x` : `(${((target.y - pos.y) / (target.x - pos.x)).toFixed(6)})*x`;
            await host.check("#mode-explicit");
            await host.fill("#input-a", formula);
            await host.click("#fire");
            memory.set(key, formula);
            await host.waitForFunction((t) => window.__state().turn > t, turn, { timeout: TURN_WAIT_MS });
        }
        assert.match(await text(host, "#end-message"), /^(You win|Local 1 wins|Draw)\./);
        assert.ok(restored >= 2, `formulas were restored on later turns (${restored})`);
        return errors;
    },
    async Y() {
        // A local player, a bot and a guest in one disc game (ADR 21, 22). The guest sees the local
        // player's turn as any other team's; humans fire straight out of the disc so the game lasts.
        const { pages, errors } = await startGame(2, "disc", "Y", { seats: 4, bots: ["medium"], locals: 1 });
        const [host, guest] = pages;
        for (const page of pages) assert.deepEqual((await page.locator("#roster .id").allInnerTexts()).slice(2), ["Local 1", "Bot 1, medium"]);
        await assertSynced(pages, 0);
        let localTurns = 0;
        for (let turn = 0; turn < 8; turn++) {
            const { current } = JSON.parse(await state(host));
            if (current === 3) {
                await assertSynced(pages, turn + 1);
                assert.equal(JSON.parse(await state(guest)).shot?.team, 3, "the bot fired");
                continue;
            }
            if (current === 2) {
                localTurns++;
                assert.equal(await text(host, "#turn"), "Local 1's turn");
                assert.equal(await text(guest, "#turn"), "Team 3 is aiming");
                assert.equal(await guest.isDisabled("#fire"), true);
            }
            await takeTurn(pages, turn, ["t", "0"]);
        }
        assert.ok(localTurns >= 1, "the local player had a turn");
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
