// Shared setup of the end-to-end tests over the real Nostr lobby and real WebRTC (ADR 15): the static
// server for dist/, the browser, and the helpers that bring pages into a game and check them.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DIST = resolve(fileURLToPath(new URL("../../dist", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".webm": "video/webm", ".webp": "image/webp" };
export const SETUP_MS = 120_000;
export const TURN_WAIT_MS = 30_000;
/** A dropped guest's watchdog rejoins after 25 s (ADR 18), plus time for the new signalling exchange. */
export const RECONNECT_MS = 35_000;

// Tiny static server for dist/.
export const server = createServer(async (req, res) => {
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
export const url = `http://127.0.0.1:${server.address().port}/`;

export const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
// Every page of this process lists games on the lobby topic the runner chose for its scenario (ADR 33).
const newContext = browser.newContext.bind(browser);
browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.addInitScript((suffix) => (window.__lobbySuffix = suffix), process.env.E2E_LOBBY);
    return context;
};

export const state = (page) => page.evaluate(() => JSON.stringify(window.__state()));
export const comparable = async (page) => {
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
export function watchFrames(page) {
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
 * the host's invite link) (ADR 24); `share` ticks "Guests can share the invite link"; `characters` picks
 * the characters per player (ADR 27).
 */
export async function startGame(n, field, label, { seats = n, frame = "map", fakeHostClock = false, fakeGuestClock = false, blockStorage = false, bots = [], locals = 0, offline = false, beforeStart, visibility = "public", password = "", share = false, characters } = {}) {
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
    if (characters) await host.selectOption("#host-characters", String(characters));
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
export async function assertBuild(pages, id) {
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
export async function shooter(pages) {
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
export async function assertSynced(pages, turn) {
    for (const page of pages) {
        await page.waitForFunction((t) => window.__state()?.turn === t, turn, { timeout: TURN_WAIT_MS });
    }
    const [first, ...rest] = await Promise.all(pages.map(comparable));
    for (const other of rest) assert.deepEqual(other, first, `state diverged at turn ${turn}`);
}

/** Plays one turn from whoever's turn it is. `exprs` has one formula (explicit) or two (parametric). */
export async function takeTurn(pages, turn, exprs) {
    const page = await shooter(pages);
    if (exprs.length === 2) await page.check("#mode-parametric");
    else await page.check("#mode-explicit");
    await page.fill("#input-a", exprs[0]);
    if (exprs.length === 2) await page.fill("#input-b", exprs[1]);
    await page.click("#fire");
    await assertSynced(pages, turn + 1);
}

/** Fast-forwards `page`'s fake clock by `time`: it must not join a game room or open a connection meanwhile. */
export async function assertQuiet(page, time) {
    const before = [page.subscriptions, await page.evaluate(() => window.__pcs.length)];
    await page.clock.fastForward(time);
    await page.waitForTimeout(2000); // real time for a rejoin to reach the relays
    assert.deepEqual([page.subscriptions, await page.evaluate(() => window.__pcs.length)], before, "no rejoin");
}

/** A formula undefined at the shooter is rejected locally and does not use the turn. */
export async function assertRejected(pages, turn, expr) {
    const page = await shooter(pages);
    await page.check("#mode-explicit");
    await page.fill("#input-a", expr);
    await page.click("#fire");
    await page.waitForFunction(() => document.getElementById("error").textContent !== "");
    assert.equal(await page.isEnabled("#fire"), true, "fire stays enabled after a rejected formula");
    await assertSynced(pages, turn);
}

export const text = (page, sel) => page.locator(sel).innerText();

/**
 * Fast-forwards the fake clock of a page that is joining a game it cannot reach (ADR 24): after 25 s
 * it joins the room again and keeps waiting, and 50 s later it ends.
 */
export async function assertGivesUp(page) {
    const before = page.subscriptions;
    await page.clock.fastForward("00:26");
    await page.waitForTimeout(2000); // real time for the second join to reach the relays
    assert.ok(page.subscriptions > before, "the page joined the room again");
    assert.equal(await page.isVisible("#end"), false, "and still waits");
    await page.clock.fastForward("00:50");
    await page.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
}
