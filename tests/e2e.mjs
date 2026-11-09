// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png" };
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
        // The guest leaves, so the host's team is the last one standing.
        await pages[1].close({ runBeforeUnload: true });
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
        await leaver.close({ runBeforeUnload: true });
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
