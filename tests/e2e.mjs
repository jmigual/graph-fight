// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".webm": "video/webm" };
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
 * Counts `page`'s game-room subscriptions (Nostr REQs other than the lobby's) in `page.subscriptions`:
 * joining a room sends them. A subscription is counted once by its id, since some relays make
 * Trystero send the same REQ again. Also keeps the Nostr events the page publishes (lobby listings
 * and signalling) in `page.published`, and the build version its last lobby announcement carried in
 * `page.announced`.
 */
function watchFrames(page) {
    const ids = new Set();
    page.subscriptions = 0;
    page.published = [];
    page.on("websocket", (ws) =>
        ws.on("framesent", (f) => {
            const frame = String(f.payload);
            // The host's lobby announcement carries the version the lobby checks (ADR 12).
            const announced = frame.startsWith('["EVENT"') && /\\"version\\":\\"([^"\\]+)\\"/.exec(frame);
            if (announced) page.announced = announced[1];
            if (frame.startsWith('["REQ"') && !frame.startsWith('["REQ","lobby"')) page.subscriptions = ids.add(JSON.parse(frame)[1]).size;
            if (frame.startsWith('["EVENT"')) page.published.push(frame);
        }),
    );
}

/**
 * Opens `n` pages (separate contexts) and brings them into one started game; pages[0] hosts.
 * `seats` is the host's seat count for the disc field (default `n`); `frame` is the shot frame,
 * `map` (default) or `player` (ADR 20), shown in the lobby and the waiting room; `fakeHostClock` and
 * `fakeGuestClock` install Playwright's fake clock on the host or the first guest before it loads;
 * `blockStorage` makes the host's localStorage refuse writes; `bots` lists the levels of the bots the
 * host adds before anyone joins (ADR 21); `locals` is the number of local players it adds before them
 * (ADR 22); `offline` cuts the pages' network once they have loaded; `beforeStart(pages, name, errors)`
 * runs in the waiting room once everyone has joined, before the host clicks Start; `visibility` is
 * `public` (default), `password` (guests join from the lobby with `password`) or `link` (guests open
 * the host's invite link) (ADR 24); `share` ticks "Guests can share the invite link".
 */
async function startGame(n, field, label, { seats = n, frame = "map", fakeHostClock = false, fakeGuestClock = false, blockStorage = false, bots = [], locals = 0, offline = false, beforeStart, visibility = "public", password = "", share = false } = {}) {
    const pages = [];
    const errors = [];
    for (let i = 0; i < n; i++) {
        const page = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
        page.on("pageerror", (e) => errors.push(`page ${i}: ${e}`));
        watchFrames(page);
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
    await host.selectOption("#host-visibility", visibility);
    if (share) await host.check("#host-share");
    if (visibility === "password") {
        // The password is masked until its Show toggle is pressed (ADR 24).
        assert.equal(await host.getAttribute("#host-password", "type"), "password");
        await host.fill("#host-password", password);
    }
    await host.click("#host-form button[type=submit]");
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
    // A private-link game is not listed: its guests open the invite link (ADR 24). The first one loads
    // it, as from a new tab; the next one pastes it into its open lobby, which only changes the fragment.
    const listed = visibility === "link" ? [] : guests;
    // A private-link host announces nothing; its invite link carries the build version instead.
    const version = host.announced ?? (visibility === "link" ? new URLSearchParams((await host.inputValue("#invite-link")).split("#")[1]).get("v") : undefined);
    for (const [i, guest] of guests.filter((g) => !listed.includes(g)).entries()) {
        if (i % 2 === 0) await guest.goto("about:blank");
        await guest.goto(await host.inputValue("#invite-link"));
    }
    // Everyone sees the game before anyone joins, so with fewer seats than guests all still find a free seat.
    const rows = listed.map((guest) => guest.locator("#games tr", { hasText: name }));
    const joins = rows.map((row) => row.getByRole("button", { name: "Join", disabled: false }));
    await Promise.all(joins.map((join) => join.waitFor({ timeout: SETUP_MS })));
    // The footer shows the version the host announced, on the lobby screen...
    await assertBuild(pages, host.announced ?? version);
    // The listing counts the bots and local players (ADR 21, 22), and marks a password game (ADR 24).
    if (listed.length && (bots.length || locals)) await rows[0].filter({ hasText: `${1 + bots.length + locals} of ` }).waitFor({ timeout: SETUP_MS });
    for (const row of rows) assert.equal(await row.getByRole("img", { name: "Password required" }).count(), visibility === "password" ? 1 : 0);
    // With a game listed, the empty-list text gives way to the table.
    for (const guest of listed) assert.deepEqual(await guest.evaluate(() => [document.getElementById("no-games").hidden, document.getElementById("games-table").hidden]), [true, false]);
    await Promise.all(
        joins.map(async (join, i) => {
            await join.click({ timeout: 5000 });
            if (visibility !== "password") return;
            await listed[i].fill("#join-password", password);
            await listed[i].press("#join-password", "Enter");
        }),
    );
    await host.waitForFunction((k) => document.querySelectorAll("#room-players li").length === k, n + bots.length + locals, { timeout: SETUP_MS });
    // A guest that came by link has no listing to take the name and field from.
    for (const page of visibility === "link" ? [host] : pages) assert.equal(await text(page, "#room-title"), name, "the waiting room is titled with the game name");
    for (const page of visibility === "link" ? [host] : pages) assert.match(await text(page, "#room-info"), new RegExp(`, ${frame}-centred, `), "the waiting room names the frame");
    if (beforeStart) await beforeStart(pages, name, errors);
    const seatsLine = await text(host, "#room-seats");
    await host.click("#start");
    for (const page of pages) await page.waitForSelector("#game:not([hidden]), #end:not([hidden])", { timeout: SETUP_MS });
    // ...and on the game screen.
    await assertBuild(pages, host.announced ?? version);
    return { pages, errors, seatsLine };
}

/**
 * Every page's `#build` footer link shows the build the host announced and names the changelog it opens
 * (ADR 17, 28). The announced id is `x.y.z+<hash>` (release) or `x.y.z-dev+<hash>` (dev, what e2e runs
 * against); the footer shows the plain version for a release and the whole id for a dev build.
 */
async function assertBuild(pages, id) {
    assert.match(id ?? "", /^\d+\.\d+\.\d+(-dev)?\+\w+$/, "the host announced a build id");
    const version = id.includes("-dev") ? id : id.split("+")[0];
    for (const page of pages) {
        assert.equal(await text(page, "#build"), `v ${version}`);
        const link = page.getByRole("link", { name: `v ${version}, changelog, opens in a new tab` });
        assert.equal(await link.count(), 1);
        assert.equal(await link.getAttribute("href"), "./changelog.html");
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

/**
 * Fast-forwards the fake clock of a page that is joining a game it cannot reach (ADR 24): after 25 s
 * it joins the room again and keeps waiting, and 50 s later it ends.
 */
async function assertGivesUp(page) {
    const before = page.subscriptions;
    await page.clock.fastForward("00:26");
    await page.waitForTimeout(2000); // real time for the second join to reach the relays
    assert.ok(page.subscriptions > before, "the page joined the room again");
    assert.equal(await page.isVisible("#end"), false, "and still waits");
    await page.clock.fastForward("00:50");
    await page.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
}

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
            await host.click("#host-form button[type=submit]");
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
        // The end screen shows the result, not the editor: the board and the last shot stay (ADR 17).
        for (const sel of ["#shot-form", "#saved"]) assert.equal(await host.isVisible(sel), false, `${sel} is hidden at the end`);
        for (const sel of ["#arena", "#last-shot"]) assert.equal(await host.isVisible(sel), true, `${sel} stays at the end`);
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
        // The board's fonts are in first: their arrival redraws the board, which ends a running pen (ADR 17).
        await host.evaluate(() => Promise.all(['italic 14px "STIX Two Text"', '700 11px "Atkinson Hyperlegible Next"', '16px "Atkinson Hyperlegible Next"'].map((f) => document.fonts.load(f))).then(() => document.fonts.ready));
        // The first shooter is random: let the guest go first if it is up.
        if (!(await host.isEnabled("#fire"))) await takeTurn(pages, 0, ["x"]);
        // Lines in several directions, in case an obstacle sits right in front of the shooter.
        const lines = ["0", "0.3*x", "(-0.3)*x", "0.15*x", "(-0.15)*x", "0.6*x", "(-0.6)*x", "0.05*x"];
        for (let attempt = 0; ; attempt++) {
            const { turn } = JSON.parse(await state(host));
            await host.check("#mode-explicit");
            await host.fill("#input-a", lines[attempt]);
            // The canvas on every animation frame from Fire, for 2 s (a pen takes at most 1.4 s) and then
            // until it has not changed for 10 frames. The pen's first frames can look the same while it
            // is still under the shooter's face, so stillness alone does not end the sampling. Fire is
            // clicked in the same evaluate, so no round trip sits before the first frame.
            const changes = await host.evaluate(async () => {
                const canvas = document.getElementById("arena");
                const frame = () => new Promise((ok) => requestAnimationFrame(ok));
                const start = performance.now();
                document.getElementById("fire").click();
                const seen = [{ at: 0, image: canvas.toDataURL() }];
                for (let still = 0; (still < 10 || performance.now() - start < 2000) && performance.now() - start < 5000; ) {
                    await frame();
                    const image = canvas.toDataURL();
                    if (image === seen.at(-1).image) {
                        still++;
                    } else {
                        still = 0;
                        seen.push({ at: performance.now() - start, image });
                    }
                }
                return seen.map(({ at }) => at);
            });
            await assertSynced(pages, turn + 1);
            // A shot that hits something at once draws too little to watch: try again on the host's next turn.
            const points = JSON.parse(await state(host)).shot.points.length;
            if (points < 40 && attempt < lines.length - 1) {
                await takeTurn(pages, turn + 1, ["100*x"]);
                continue;
            }
            assert.ok(points >= 40, `a shot long enough to watch (${points} points)`);
            // The first image is the pen's first frame, drawn inside Fire; the last is the final frame.
            assert.ok(changes.length - 2 >= 3, `the pen drew at least 3 frames (${changes.length - 2})`);
            assert.ok(changes.at(-1) >= 600, `the final frame came at least 600 ms after Fire (${Math.round(changes.at(-1))} ms)`);
            break;
        }
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
    async Help() {
        // The help (ADR 26): a Help button, #help-... deep links and Escape, at phone width, then mid-game.
        const errors = [];
        const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
        phone.on("pageerror", (e) => errors.push(`phone: ${e}`));
        const isOpen = () => phone.evaluate(() => document.getElementById("help").open);
        const closed = () => phone.waitForFunction(() => !document.getElementById("help").open && location.hash === "");
        await phone.goto(`${url}#help-coordinates`);
        assert.equal(await isOpen(), true, "a #help-... address opens the help on load");
        const inView = (id) =>
            phone.evaluate((id) => {
                const r = document.getElementById(id).getBoundingClientRect();
                const d = document.getElementById("help").getBoundingClientRect();
                return r.top >= d.top && r.top < d.bottom;
            }, id);
        assert.equal(await inView("help-coordinates"), true, "the section is shown");
        assert.equal(await phone.evaluate(() => { const d = document.getElementById("help"); return d.scrollWidth <= d.clientWidth; }), true, "no horizontal scroll at phone width");
        await phone.keyboard.press("Escape");
        await closed();
        // A hash change in the open page deep-links too, and the link works again after a close.
        await phone.evaluate(() => (location.hash = "#help-formulas"));
        await phone.waitForFunction(() => document.getElementById("help").open);
        assert.equal(await inView("help-formulas"), true, "a hash change shows its section");
        await phone.keyboard.press("Escape");
        await closed();
        const focused = () => phone.evaluate(() => document.activeElement?.id);
        await phone.click("#help-open");
        assert.equal(await isOpen(), true, "the Help button opens the help");
        await phone.keyboard.press("Escape");
        await closed();
        assert.equal(await focused(), "help-open", "focus returns to the Help button after Escape");
        await phone.click("#help-open");
        await phone.click("#help-close");
        assert.equal(await isOpen(), false, "Close closes it");
        assert.equal(await focused(), "help-open", "focus returns to the Help button after Close");
        // Unrelated fragments (an invite link, ADR 24) do not open it. Wait for the event the help listens to.
        await phone.evaluate(
            () =>
                new Promise((ok) => {
                    addEventListener("hashchange", ok, { once: true });
                    location.hash = "#join=abc&key=def&v=1";
                }),
        );
        assert.equal(await isOpen(), false);

        // Mid-game: the page that is not shooting reads the help while the other fires.
        const { pages, errors: gameErrors } = await startGame(2, "xy", "Help");
        await assertSynced(pages, 0);
        const first = await shooter(pages);
        const reader = pages.find((p) => p !== first);
        await reader.click("#help-open");
        const before = JSON.parse(await state(reader));
        await takeTurn(pages, 0, ["x"]);
        assert.equal(await reader.evaluate(() => document.getElementById("help").open), true, "the help stays open while a turn is applied");
        assert.equal(JSON.parse(await state(reader)).turn, before.turn + 1, "the game goes on behind the help");
        await reader.keyboard.press("Escape");
        await reader.waitForFunction(() => !document.getElementById("help").open);
        await takeTurn(pages, 1, ["-x"]);
        return [...errors, ...gameErrors];
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
            const words = current === 1 ? "Local 1's turn" : "Host's turn";
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
        assert.match(await text(host, "#end-message"), /^(Host wins|Local 1 wins|Draw)\./);
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
    async Z() {
        // The host removes a guest in the waiting room (ADR 23): the guest is told, and joining again
        // under the same peer id is ignored. The game starts without it.
        let removed;
        const { pages, errors } = await startGame(3, "disc", "Z", {
            seats: 4,
            beforeStart: async ([host, ...guests], name) => {
                removed = guests[0];
                const [id, next] = await Promise.all(guests.map(async (g) => (await g.locator("#room-players li", { hasText: "(you)" }).innerText()).split(" ")[0]));
                // Guests join in any order: Remove the one listed first, so the focus has a next Remove to go to.
                const first = (await host.locator("#room-players li >> nth=1").innerText()).startsWith(id);
                if (!first) removed = guests[1];
                await host.getByRole("button", { name: `Remove ${first ? id : next}` }).click();
                assert.equal(await host.evaluate(() => document.activeElement.getAttribute("aria-label")), `Remove ${first ? next : id}`, "the focus moves to the next Remove");
                assert.equal(await host.locator("#room-players li").count(), 2);
                await removed.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
                assert.match(await text(removed, "#end-message"), /removed you/i);
                await removed.click("#back");
                await removed.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }).click({ timeout: SETUP_MS });
                await removed.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
                assert.match(await text(removed, "#end-message"), /removed you/i, "a removed peer joining again is told again");
                await host.waitForTimeout(3000);
                assert.equal(await host.locator("#room-players li").count(), 2, "and the host does not list it");
            },
        });
        const players = pages.filter((page) => page !== removed);
        assert.equal(await removed.evaluate(() => window.__state()), null, "the removed page has no game");
        await assertSynced(players, 0);
        await takeTurn(players, 0, ["t", "0"]);
        return errors;
    },
    async AA() {
        // The host kicks a guest mid-game (ADR 23): its team is out as after a quit, its page ends, and
        // neither a reload nor a reload that restores its old seat token gets it back.
        const { pages, errors } = await startGame(3, "disc", "AA");
        const [host, kicked, other] = pages;
        await assertSynced(pages, 0);
        await kicked.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        const seat = await kicked.evaluate(() => sessionStorage.getItem("graph-fight-seat"));
        const team = JSON.parse(await state(kicked)).me;
        assert.equal(await other.locator("#roster button").count(), 0, "only the host can kick");
        assert.equal(await host.locator("#roster li >> nth=0").getByRole("button").count(), 0, "the host does not kick itself");
        await host.getByRole("button", { name: `Kick Team ${team + 1}` }).click();
        assert.match(host.dialogs.at(-1), /Kick Team/);
        await kicked.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.match(await text(kicked, "#end-message"), /removed you/i);
        const rest = [host, other];
        for (const page of rest) await page.waitForFunction((t) => window.__state().arena.teams[t].players.every((p) => !p.alive), team, { timeout: TURN_WAIT_MS });
        assert.equal(await host.getByRole("button", { name: `Kick Team ${team + 1}` }).count(), 0, "an out team has no Kick");
        await kicked.reload();
        await kicked.waitForSelector("#lobby:not([hidden])");
        assert.equal(await kicked.evaluate(() => window.__state()), null, "the ended game left no seat to rejoin");
        // A tab that kept the seat token: the host knows it was revoked and says so.
        await kicked.evaluate((s) => sessionStorage.setItem("graph-fight-seat", s), seat);
        await kicked.reload();
        await kicked.waitForSelector("#end:not([hidden])", { timeout: SETUP_MS });
        assert.match(await text(kicked, "#end-message"), /removed you/i);
        assert.equal(await kicked.evaluate(() => window.__state()), null, "the revoked seat gets no replay");
        const { turn } = JSON.parse(await state(host));
        await assertSynced(rest, turn);
        await takeTurn(rest, turn, ["t", "0"]);
        return errors;
    },
    async AB() {
        // A password game (ADR 24): listed with a lock and joined with the password. A wrong password
        // never connects; the page joins the room again once, then ends. A reload rejoins with the stored password.
        const password = "open sesame";
        const { pages, errors } = await startGame(2, "disc", "AB", {
            seats: 3,
            visibility: "password",
            password,
            beforeStart: async ([host, guest], name, errors) => {
                const wrong = await (await browser.newContext()).newPage();
                wrong.on("pageerror", (e) => errors.push(`wrong: ${e}`));
                watchFrames(wrong);
                await wrong.clock.install();
                await wrong.goto(url);
                await wrong.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }).click({ timeout: SETUP_MS });
                // The dialog's field is masked; Show reveals it and says so with aria-pressed.
                assert.equal(await wrong.getAttribute("#join-password", "type"), "password");
                const show = wrong.locator("#password-dialog").getByRole("button", { name: "Show password" });
                await show.click();
                assert.deepEqual([await wrong.getAttribute("#join-password", "type"), await show.getAttribute("aria-pressed")], ["text", "true"]);
                await wrong.fill("#join-password", `${password}!`);
                await wrong.press("#join-password", "Enter");
                // The closed dialog keeps no password, and is masked again.
                await wrong.waitForFunction(() => !document.getElementById("password-dialog").open);
                assert.deepEqual([await wrong.inputValue("#join-password"), await wrong.getAttribute("#join-password", "type")], ["", "password"]);
                await wrong.waitForTimeout(3000); // real time for the signalling to meet and fail
                await assertGivesUp(wrong);
                assert.match(await text(wrong, "#end-message"), /wrong password/i);
                assert.equal(await host.locator("#room-players li").count(), 2, "the wrong password never connected");
                assert.equal(await guest.isHidden("#invite"), true, "the host did not let guests share the link");
            },
        });
        const guest = pages[1];
        assert.equal(await pages[0].inputValue("#host-password"), "", "the host's form keeps no password");
        await assertSynced(pages, 0);
        await takeTurn(pages, 0, ["t", "0"]);
        // The seat keeps the stretched room password, never the typed one (ADR 24).
        await guest.waitForFunction(() => /^[0-9a-f]{64}$/.test(JSON.parse(sessionStorage.getItem("graph-fight-seat") ?? "{}").key));
        await guest.reload();
        await guest.waitForFunction(() => window.__state()?.turn === 1, null, { timeout: SETUP_MS });
        await assertSynced(pages, 1);
        await takeTurn(pages, 1, ["t", "0"]);
        return errors;
    },
    async AC() {
        // A private-link game (ADR 24) is never announced. The host copies the invite link, which
        // carries a 128-bit key in the fragment; the guests join through it, and their address bars drop the key.
        let link;
        const { pages, errors } = await startGame(3, "disc", "AC", {
            visibility: "link",
            share: true,
            beforeStart: async ([host, ...guests], name) => {
                const observer = await (await browser.newContext()).newPage();
                await observer.goto(url);
                await observer.waitForTimeout(7000); // more than two announce periods
                assert.equal(await observer.locator("#games tr", { hasText: name }).count(), 0, "a lobby page does not list it");
                assert.equal(host.published.some((f) => f.includes(name)), false, "the host never announced it");
                link = await host.inputValue("#invite-link");
                assert.ok(link.startsWith(`${url}#join=`), link);
                assert.match(link, /&key=[0-9a-f]{32}&v=/);
                await host.click("#copy-link");
                assert.equal(await host.evaluate(() => navigator.clipboard.readText()), link);
                await host.waitForFunction(() => document.getElementById("copy-status").textContent !== "");
                for (const guest of guests) assert.equal(await guest.evaluate(() => location.href), url, "the key is gone from the guest's address bar");
                // The host lets guests share the link: they get the same one.
                for (const guest of guests) await guest.waitForFunction((l) => document.getElementById("invite-link").value === l && !document.getElementById("invite").hidden, link);
                // The link pasted again in the waiting room: the page stays, says why, and drops the key.
                await guests[1].goto(link);
                await guests[1].waitForFunction(() => document.getElementById("room-error").textContent !== "");
                assert.match(await text(guests[1], "#room-error"), /leave this game first/);
                assert.equal(await guests[1].evaluate(() => location.href), url, "the address bar is clean");
                // A page whose host form is still stretching its password when it opens the invite joins
                // that game only: the stretch finishing later must not host a room as well.
                const racer = await (await browser.newContext()).newPage();
                watchFrames(racer);
                await racer.addInitScript(() => {
                    const derive = SubtleCrypto.prototype.deriveBits;
                    SubtleCrypto.prototype.deriveBits = function (...args) {
                        return new Promise((ok) => setTimeout(ok, 3000)).then(() => derive.apply(this, args));
                    };
                });
                await racer.goto(url);
                const racerName = `e2e-AC-racer-${Math.random().toString(36).slice(2, 8)}`;
                await racer.fill("#host-name", racerName);
                await racer.selectOption("#host-visibility", "password");
                await racer.fill("#host-password", "slow");
                await racer.click("#host-form button[type=submit]");
                await racer.goto(link);
                // It reaches the invite's waiting room: the host and both guests, and itself.
                const players = () => racer.evaluate(() => document.querySelectorAll("#room-players li").length);
                await racer.waitForFunction(() => document.querySelectorAll("#room-players li").length === 4, null, { timeout: SETUP_MS });
                await racer.waitForTimeout(4000); // past the slowed stretch
                assert.equal(await players(), 4, "the page is still in the invite's waiting room");
                assert.equal(await racer.isHidden("#start"), true, "as a guest");
                assert.equal(racer.published.some((f) => f.includes(racerName)), false, "and announces no game of its own");
                await racer.close();
                await host.waitForFunction(() => document.querySelectorAll("#room-players li").length === 3, null, { timeout: SETUP_MS });
            },
        });
        await assertSynced(pages, 0);
        await takeTurn(pages, 0, ["t", "0"]);
        // A link pasted mid-game: the page stays in its game and says why, the key leaves the address
        // bar, and a reload rejoins the seat instead of following the link (ADR 16, 24).
        const guest = pages[1];
        const { me } = JSON.parse(await state(guest));
        await guest.waitForFunction(() => sessionStorage.getItem("graph-fight-seat") !== null);
        await guest.goto(link);
        await guest.waitForFunction(() => document.getElementById("error").textContent !== "");
        assert.match(await text(guest, "#error"), /leave this game first/);
        assert.equal(await guest.evaluate(() => location.href), url, "the address bar is clean");
        await guest.reload();
        await guest.waitForFunction(() => window.__state()?.turn === 1, null, { timeout: SETUP_MS });
        assert.equal(JSON.parse(await state(guest)).me, me, "the reload rejoined the same seat");
        await assertSynced(pages, 1);
        await takeTurn(pages, 1, ["t", "0"]);
        return errors;
    },
    async AD() {
        // A guest quits on its turn and a local player is next (ADR 22): the turn number stays, but the
        // local player's turn has started, so its character's last formula comes back in the host's editor.
        const { pages, errors } = await startGame(2, "disc", "AD", { seats: 3, locals: 1 });
        const [host, guest] = pages;
        // Everyone fires straight out of the disc; the local player's formulas differ from the host's.
        const memory = new Map();
        let turn = 0;
        await assertSynced(pages, 0);
        for (;;) {
            const { current, arena } = JSON.parse(await state(host));
            if (current === 1 && memory.has(`2:${arena.teams[2].currentPlayer}`)) break;
            assert.ok(turn < 30, "the local player's next character has fired");
            const exprs = current === 2 ? ["t", `0.0${turn}`] : ["t", "0"];
            if (current === 2) memory.set(`2:${arena.teams[2].currentPlayer}`, exprs[1]);
            await takeTurn(pages, turn++, exprs);
        }
        const { arena } = JSON.parse(await state(host));
        const expected = memory.get(`2:${arena.teams[2].currentPlayer}`);
        assert.equal(await host.inputValue("#input-b"), "0", "the host's own formula is in the editor");
        await guest.click("#quit");
        await host.waitForFunction(() => window.__state().current === 2, null, { timeout: TURN_WAIT_MS });
        assert.equal(JSON.parse(await state(host)).turn, turn, "a quit uses no turn number");
        assert.equal(await host.inputValue("#input-b"), expected, "the local player's formula is back");
        return errors;
    },
    async AE() {
        // The host kicks the current shooter, and a bot is next (ADR 23): the turn passes on every page,
        // the countdown starts again, the bot fires, and the keyboard stays in the roster.
        const { pages, errors } = await startGame(3, "disc", "AE", { seats: 4, bots: ["medium"] });
        const [host] = pages;
        const teams = await Promise.all(pages.map(async (page) => JSON.parse(await state(page)).me));
        const kicked = pages[teams.indexOf(2)];
        const rest = pages.filter((page) => page !== kicked);
        await assertSynced(pages, 0);
        let turn = 0;
        for (let { current } = JSON.parse(await state(host)); current !== 2; { current } = JSON.parse(await state(host))) {
            assert.ok(turn < 12, "team 3 gets a turn");
            if (current === 3) await assertSynced(pages, turn + 1);
            else await takeTurn(pages, turn, ["t", "0"]);
            turn++;
        }
        for (const page of rest) await page.waitForFunction(() => Number(document.getElementById("countdown").textContent) <= 57, null, { timeout: 10_000 });
        await host.getByRole("button", { name: "Kick Team 3" }).focus();
        await host.keyboard.press("Enter");
        // Checked before the bot's shot (1.5 s later) rebuilds the roster again.
        await host.waitForFunction(() => window.__state().current === 3, null, { timeout: TURN_WAIT_MS });
        assert.equal(await host.evaluate(() => !!document.activeElement.closest("#roster")), true, "the focus stays in the roster");
        for (const page of rest) await page.waitForFunction(() => window.__state().current === 3, null, { timeout: TURN_WAIT_MS });
        for (const page of rest) await page.waitForFunction(() => Number(document.getElementById("countdown").textContent) >= 58, null, { timeout: 2000 });
        await assertSynced(rest, turn + 1);
        assert.equal(JSON.parse(await state(host)).shot?.team, 3, "the bot fired");
        return errors;
    },
    async AF() {
        // A public game whose host page died without withdrawing stays listed for a few seconds. A guest
        // that joins it then joins the room again once, and ends saying the host can't be reached (ADR 24).
        const errors = [];
        const [host, guest] = await Promise.all([0, 1].map(async () => (await browser.newContext()).newPage()));
        for (const page of [host, guest]) page.on("pageerror", (e) => errors.push(`${e}`));
        watchFrames(guest);
        await guest.clock.install();
        for (const page of [host, guest]) await page.goto(url);
        const name = `e2e-AF-${Math.random().toString(36).slice(2, 8)}`;
        await host.fill("#host-name", name);
        await host.click("#host-form button[type=submit]");
        const join = guest.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false });
        await join.waitFor({ timeout: SETUP_MS });
        await host.close();
        await join.click();
        await assertGivesUp(guest);
        assert.match(await text(guest, "#end-message"), /can't be reached/);
        assert.doesNotMatch(await text(guest, "#end-message"), /password/i, "a public game asks for no password");
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
    async AJ() {
        // Every icon the page links is in dist/ and served as an image, and the PNGs have their sizes (ADR 17).
        const page = await (await browser.newContext()).newPage();
        await page.goto(url);
        const hrefs = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (links) => links.map((l) => l.href));
        assert.equal(hrefs.length, 3, "SVG, PNG fallback and touch icon");
        for (const href of hrefs) {
            const res = await page.request.get(href);
            assert.equal(res.ok(), true, href);
            assert.match(res.headers()["content-type"], /^image\//, href);
        }
        const width = (file) => page.evaluate(async (src) => {
            const img = new Image();
            img.src = src;
            await img.decode();
            return img.naturalWidth;
        }, file);
        assert.equal(await width("favicon-32.png"), 32);
        assert.equal(await width("apple-touch-icon.png"), 180);
        return [];
    },
    async AK() {
        // The footer version opens the changelog in a new tab, newest version first, with a way back (ADR 28).
        const errors = [];
        const page = await (await browser.newContext()).newPage();
        page.on("pageerror", (e) => errors.push(`page: ${e}`));
        await page.goto(url);
        const link = page.getByRole("link", { name: /^v \S+, changelog, opens in a new tab$/ });
        const [log] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
        await log.waitForLoadState();
        assert.equal(new URL(log.url()).pathname, "/changelog.html");
        const shown = (await log.locator("main h2").allInnerTexts()).map((t) => t.split(" ")[0]);
        assert.deepEqual(shown.filter((v) => ["0.1.0", "0.2.0", "0.3.0"].includes(v)), ["0.3.0", "0.2.0", "0.1.0"]);
        assert.equal(await log.getByRole("heading", { level: 1 }).innerText(), "Changelog");
        await log.getByRole("link", { name: "Back to the game" }).click();
        await log.waitForSelector("#build");
        return errors;
    },
    async AI() {
        // The test arena (ADR 25): players and obstacles placed by hand, shots from any player, and
        // nothing permanent. It is offline: no lobby announcement, no game room, no WebRTC link.
        const page = await (await browser.newContext()).newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(`${e}`));
        // `lobby` counts the lobby's own subscriptions, so the check below knows the relays were watched.
        let [sent, lobby] = [0, 0];
        page.on("websocket", (ws) =>
            ws.on("framesent", (f) => {
                const frame = String(f.payload);
                if (frame.startsWith('["REQ","lobby"')) lobby++;
                else if (frame.startsWith('["EVENT"') || frame.startsWith('["REQ"')) sent++;
            }),
        );
        await page.addInitScript(() => {
            const Native = RTCPeerConnection;
            window.__links = 0;
            window.RTCPeerConnection = class extends Native {
                constructor(...args) {
                    super(...args);
                    window.__links++;
                }
            };
        });
        await page.goto(url);
        // A game we were out of hides the editor and leaving it does not show it again: the arena must.
        await page.evaluate(() => (document.getElementById("shot-form").hidden = true));
        await page.click("#test-open");
        assert.equal(await page.isVisible("#shot-form"), true, "the arena has the editor");
        assert.equal(await page.locator("#test-items li").count(), 0, "the arena starts without obstacles");
        const board = page.locator("#arena");
        // The page position of map point (x, y) on a field with extents xMax, yMax, and a click there.
        const spot = async (x, y, [xMax, yMax] = [20, 10]) => {
            await board.scrollIntoViewIfNeeded();
            const box = await board.boundingBox();
            const scale = box.width / (2 * xMax);
            return [box.x + (x + xMax) * scale, box.y + (yMax - y) * scale];
        };
        const click = async (...args) => page.mouse.click(...(await spot(...args)));
        const fire = async (exprs, expected) => {
            await page.check(exprs.length === 2 ? "#mode-parametric" : "#mode-explicit");
            await page.fill("#input-a", exprs[0]);
            if (exprs.length === 2) await page.fill("#input-b", exprs[1]);
            await page.evaluate(() => (document.getElementById("last-shot").textContent = ""));
            await page.click("#fire");
            await page.waitForFunction(() => document.getElementById("last-shot").textContent !== "");
            assert.match(await text(page, "#last-shot"), expected);
        };

        // The first player placed shoots; y = 0 runs into the other one, and the same shot hits again.
        assert.equal(await page.locator("#test-team option").count(), 2, "XY has two teams");
        await click(-8, 0);
        await page.selectOption("#test-team", "1");
        await click(5, 0);
        await fire(["0"], /^Team 1 player 1 fired y = 0\. It hit Team 2 player 1\.$/);
        await fire(["0"], /It hit Team 2 player 1\.$/);
        // A swipe across an empty part of the board places nothing.
        await page.mouse.move(...(await spot(-4, -6)));
        await page.mouse.down();
        await page.mouse.move(...(await spot(0, -6)), { steps: 5 });
        await page.mouse.up();
        assert.equal(await page.locator("#test-items li").count(), 2, "a swipe is not a click");
        // Nor is a right click.
        await page.mouse.click(...(await spot(-4, -6)), { button: "right" });
        assert.equal(await page.locator("#test-items li").count(), 2, "a right click places nothing");
        // Nor does a press that loses its pointer capture before it is let go.
        await page.evaluate(() => document.getElementById("arena").addEventListener("pointerdown", (e) => (window.__pressed = e.pointerId), { once: true }));
        const [qx, qy] = await spot(-4, -6);
        await page.mouse.move(qx, qy);
        await page.mouse.down();
        // A capture is only pending until the next event: a 1 px move (no drag) makes it the pointer's.
        await page.mouse.move(qx + 1, qy);
        await page.evaluate(() => document.getElementById("arena").releasePointerCapture(window.__pressed));
        await page.mouse.up();
        assert.equal(await page.locator("#test-items li").count(), 2, "a press that lost its capture places nothing");
        // An obstacle cannot touch a player; one in the way stops the shot there.
        await page.check("#place-obstacle");
        await click(5, 1);
        await page.waitForFunction(() => /^Can't place an obstacle there\. A player can't touch an obstacle\.$/.test(document.getElementById("test-error").textContent));
        await click(0, 0);
        await fire(["0"], /It hit no player\. It stopped in obstacle 1\.$/);
        // A player must be fully inside the field.
        await page.check("#place-player");
        await page.selectOption("#test-team", "0");
        await click(19.95, 0);
        await page.waitForFunction(() => /^Can't place a player there\. A player must be fully inside the field\.$/.test(document.getElementById("test-error").textContent));
        assert.equal(await page.locator("#test-items li").count(), 3);
        // Formula errors show as in a game, and nothing is fired.
        await page.fill("#input-a", "sqrt(-1)");
        await page.click("#fire");
        await page.waitForFunction(() => /undefined at the shooter/.test(document.getElementById("error").textContent));
        // From the keyboard: Delete on the obstacle's row removes it, and the shot reaches the player again.
        await page.getByRole("button", { name: /^Obstacle 1,/ }).press("Delete");
        assert.equal(await page.locator("#test-items li").count(), 2);
        await fire(["0"], /It hit Team 2 player 1\.$/);
        // A dragged player moves out of the line of fire.
        await page.mouse.move(...(await spot(5, 0)));
        await page.mouse.down();
        await page.mouse.move(...(await spot(5, 1.5)), { steps: 5 });
        await page.mouse.move(...(await spot(5, 3)), { steps: 5 });
        await page.mouse.up();
        assert.match(await text(page, "#test-items"), /Team 2 player 1 at \(5\.0, 3\.0\)/);
        // The dragged player is selected, and Position shows where it is.
        const position = async () => [Number(await page.inputValue("#test-x")), Number(await page.inputValue("#test-y"))];
        const [px, py] = await position();
        assert.ok(Math.abs(px - 5) < 0.1 && Math.abs(py - 3) < 0.1, `Position follows the drag (${px}, ${py})`);
        await fire(["0"], /^Team 1 player 1 fired y = 0\. It hit no player\.$/);
        // Another player shoots once chosen; on the disc, the straight shot through the centre.
        await page.getByRole("button", { name: /^Team 2 player 1/ }).click();
        await fire(["3*x/13"], /^Team 2 player 1 fired y = 3\*x\/13\. It hit Team 1 player 1\.$/);
        // Position moves the selected player to an exact spot, through the same check as a click.
        await page.fill("#test-x", "25");
        await page.click("#test-move");
        await page.waitForFunction(() => /^Can't move it there\. A player must be fully inside the field\.$/.test(document.getElementById("test-error").textContent));
        await page.fill("#test-x", "5");
        await page.fill("#test-y", "0");
        await page.click("#test-move");
        assert.match(await text(page, "#test-items"), /Team 2 player 1 at \(5\.0, 0\.0\), shooter/);
        await fire(["0"], /^Team 2 player 1 fired y = 0\. It hit Team 1 player 1\.$/);
        // An empty field is caught by the form, not sent to the engine; a typed value survives a shot.
        await page.fill("#test-x", "");
        await page.click("#test-move");
        assert.equal(await page.evaluate(() => document.getElementById("test-x").matches(":invalid")), true);
        assert.equal(await text(page, "#test-error"), "", "no engine message for an empty field");
        assert.match(await text(page, "#test-items"), /Team 2 player 1 at \(5\.0, 0\.0\)/);
        await page.fill("#test-x", "1.5");
        await fire(["0"], /It hit Team 1 player 1\.$/);
        assert.equal(await page.inputValue("#test-x"), "1.5", "Position keeps what was typed");
        await page.selectOption("#test-field", "disc");
        assert.equal(await page.locator("#test-items li").count(), 0, "another field starts over");
        // With nothing selected, Move says so, before the form complains about an empty field.
        await page.fill("#test-x", "");
        await page.click("#test-move");
        await page.waitForFunction(() => document.getElementById("test-error").textContent === "Choose a player or an obstacle to move.");
        assert.equal(await page.locator("#test-team option").count(), 8, "the disc has up to eight teams");
        await click(8, 0, [10, 10]);
        // Placing from the keyboard: Position, then Enter.
        await page.selectOption("#test-team", "4");
        await page.fill("#test-x", "-5");
        await page.fill("#test-y", "0");
        await page.press("#test-y", "Enter");
        await fire(["-t", "0"], /^Team 1 player 1 fired r = -t, θ = 0, counterclockwise\. It hit Team 5 player 1\.$/);
        await page.click("#random-obstacles");
        assert.ok((await page.locator("#test-items li").count()) > 2, "random obstacles are added");
        await page.click("#test-exit");
        await page.waitForSelector("#lobby:not([hidden])");
        // An invite link pasted in the arena leaves test mode first (here it is for another build, so
        // it ends at once without joining anything).
        await page.click("#test-open");
        await page.evaluate(() => (location.hash = "#join=someone&key=secret&v=another-build"));
        await page.waitForSelector("#end:not([hidden])");
        assert.equal(await page.evaluate(() => document.getElementById("game").dataset.mode), undefined, "the arena closed");
        // Nothing was announced or joined meanwhile.
        await page.waitForTimeout(2000);
        assert.ok(lobby > 0, "the page subscribed to the lobby, so its frames were seen");
        assert.equal(sent, 0, "no lobby announcement or room subscription");
        assert.equal(await page.evaluate(() => window.__links), 0, "no WebRTC link");
        assert.equal(await page.evaluate(() => window.__state()), null, "no game");
        return errors;
    },
    async AL() {
        // The About section sits below the open games and the host form, links the repository (also from the
        // footer), carries a demo video that loads lazily and plays only on screen without reduced motion,
        // and is gone in a game (ADR 29).
        const REPO = "https://github.com/jmigual/graph-fight";
        const errors = [];
        // Short, so the video starts below the fold.
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 500 } })).newPage();
        page.on("pageerror", (e) => errors.push(`page: ${e}`));
        await page.goto(url);
        const about = page.locator("#about");
        assert.equal(await about.isVisible(), true, "visible on the lobby screen");
        const [top, games, form] = await Promise.all(["#about", "#open-games", "#host-submit"].map((sel) => page.locator(sel).boundingBox()));
        assert.ok(top.y >= form.y + form.height && top.y > games.y, "below the open games and the host form");
        assert.equal(await about.getByRole("link", { name: /GitHub/ }).getAttribute("href"), REPO);
        assert.equal(await page.locator("footer").getByRole("link", { name: /^GitHub/ }).getAttribute("href"), REPO);
        const video = page.locator("#about video");
        assert.match((await video.getAttribute("poster")) ?? "", /\S/, "a poster");
        assert.equal(await video.getAttribute("preload"), "none");
        for (const attr of ["muted", "loop", "playsinline", "controls"]) assert.notEqual(await video.getAttribute(attr), null, attr);
        assert.ok(await video.getAttribute("aria-describedby"), "described by its caption");
        assert.equal(await video.evaluate((v) => v.paused), true, "not playing below the fold");
        const waitPaused = (paused) => page.waitForFunction((p) => document.querySelector("#about video").paused === p, paused, { timeout: TURN_WAIT_MS });
        await video.scrollIntoViewIfNeeded();
        await waitPaused(false);
        // It pauses out of view and resumes in view...
        await page.evaluate(() => scrollTo(0, 0));
        await waitPaused(true);
        await video.scrollIntoViewIfNeeded();
        await waitPaused(false);
        // ...but a pause by the viewer stays through a scroll away and back.
        await video.evaluate((v) => v.pause());
        await waitPaused(true);
        await page.evaluate(() => scrollTo(0, 0));
        await video.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1000);
        assert.equal(await video.evaluate((v) => v.paused), true, "a viewer's pause is kept");
        // With reduced motion, scrolling to the video does not start it.
        const calm = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })).newPage();
        await calm.goto(url);
        await calm.locator("#about video").scrollIntoViewIfNeeded();
        await calm.waitForTimeout(1500);
        assert.equal(await calm.evaluate(() => document.querySelector("#about video").paused), true, "reduced motion: no autoplay");
        // A game hides it with the lobby (solo against a bot, no network needed).
        const game = await startGame(1, "xy", "AL", { bots: ["easy"], offline: true });
        assert.equal(await game.pages[0].isVisible("#about"), false, "hidden in a game");
        return [...errors, ...game.errors];
    },
    async AM() {
        // Layout (ADR 17, section 6): each screen is a centred block, the board grows with a wide
        // window, and nothing scrolls sideways on a phone.
        const box = (page, sel) =>
            page.evaluate((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                const { clientWidth, scrollWidth } = document.documentElement;
                return { left: r.left, right: clientWidth - r.right, width: r.width, sideways: scrollWidth > clientWidth };
            }, sel);
        const assertCentred = ({ left, right }, what) => assert.ok(Math.abs(left - right) <= 4, `${what} is centred (${left}, ${right})`);
        const lobby = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
        await lobby.goto(url);
        assertCentred(await box(lobby, "#lobby"), "the lobby at 1920 px");
        const changelog = await lobby.context().newPage();
        await changelog.goto(`${url}changelog.html`);
        const page = await box(changelog, "main");
        assertCentred(page, "the changelog at 1920 px");
        assert.ok(page.width < 1000, `the changelog keeps a reading measure (${page.width} px)`);
        await lobby.setViewportSize({ width: 360, height: 800 });
        assert.equal((await box(lobby, "#lobby")).sideways, false, "the lobby does not scroll sideways at 360 px");
        // The game's board stays in view while the side column scrolls, but not the test arena's: its
        // setup panel is under the board and must scroll into view (ADR 25).
        await lobby.setViewportSize({ width: 1280, height: 800 });
        await lobby.click("#test-open");
        const cut = await lobby.evaluate(() =>
            [...document.querySelectorAll("#test-panel :is(button, select, input)")]
                .filter((el) => el.getClientRects().length)
                .filter((el) => {
                    el.scrollIntoView({ block: "nearest" });
                    const r = el.getBoundingClientRect();
                    return r.top < 0 || r.bottom > innerHeight;
                })
                .map((el) => el.id || el.textContent.trim()),
        );
        assert.deepEqual(cut, [], "every test-arena control scrolls into view");
        const { pages, errors } = await startGame(1, "xy", "AM", { bots: ["easy"], offline: true });
        const [host] = pages;
        // In a game the board stays on screen while the page scrolls down the side column.
        await host.setViewportSize({ width: 1280, height: 800 });
        const scrolled = await host.evaluate(() => {
            scrollTo(0, 600);
            const r = document.getElementById("arena").getBoundingClientRect();
            return { y: scrollY, top: r.top, bottom: r.bottom, height: innerHeight };
        });
        assert.ok(scrolled.y >= 600, `the page scrolls (${scrolled.y})`);
        assert.ok(scrolled.top >= 0 && scrolled.bottom <= scrolled.height, `the board stays on screen (${scrolled.top}, ${scrolled.bottom})`);
        await host.evaluate(() => scrollTo(0, 0));
        // Fire comes right after the formula: Tab from the input reaches it before the helper buttons.
        await host.waitForFunction(() => !document.getElementById("fire").disabled, null, { timeout: TURN_WAIT_MS });
        await host.focus("#input-a");
        let reached = "";
        for (let i = 0; i < 40 && !["fire", "insert-var"].includes(reached); i++) {
            await host.keyboard.press("Tab");
            reached = await host.evaluate(() => document.activeElement.id);
        }
        assert.equal(reached, "fire", "Tab from the formula reaches Fire before the helper buttons");
        await host.setViewportSize({ width: 1920, height: 1080 });
        assertCentred(await box(host, "#game"), "the game at 1920 px");
        const board = await box(host, "#arena");
        assert.ok(board.width > 1000, `the board grows with the window (${board.width} px)`);
        await host.setViewportSize({ width: 360, height: 800 });
        assert.equal((await box(host, "#game")).sideways, false, "the game does not scroll sideways at 360 px");
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
