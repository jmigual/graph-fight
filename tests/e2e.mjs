// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e [-- NAME...]
// Without names every scenario runs in the order of `ORDER`; with names, only those, in the order given
// (`npm run e2e -- AI AK`).
import assert from "node:assert/strict";
import { TURN_WAIT_MS, assertSynced, browser, server, shooter, startGame, state, takeTurn, text, url } from "./e2e/helpers.mjs";
import { scenarios as editor } from "./e2e/editor.mjs";
import { scenarios as local } from "./e2e/local.mjs";
import { scenarios as bots } from "./e2e/bots.mjs";
import { scenarios as net } from "./e2e/net.mjs";
import { scenarios as core } from "./e2e/core.mjs";

const scenarios = {
    ...editor,
    ...local,
    ...bots,
    ...net,
    ...core,
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

const ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "Help", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AJ", "AK", "AI", "AL", "AM"];
assert.deepEqual(Object.keys(scenarios).sort(), [...ORDER].sort(), "ORDER lists every scenario");
const names = process.argv.length > 2 ? process.argv.slice(2) : ORDER;
const unknown = names.filter((name) => !Object.hasOwn(scenarios, name));
if (unknown.length) {
    console.log(`Unknown scenarios: ${unknown.join(", ")}`);
    await browser.close();
    server.close();
    process.exit(1);
}

let failed = 0;
const started = Date.now();
for (const name of names) {
    const run = scenarios[name];
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
console.log(`${names.length - failed}/${names.length} scenarios passed in ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(failed ? 1 : 0);
