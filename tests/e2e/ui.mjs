// End-to-end scenarios: the in-app help, the About section and the page layout (ADR 17, 26, 29).
import assert from "node:assert/strict";
import { TURN_WAIT_MS, assertSynced, browser, shooter, startGame, state, takeTurn, url } from "./helpers.mjs";

export const scenarios = {
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
        // The host form's Coordinates hint links to that section (ADR 17).
        await phone.click("#frame-hint a");
        await phone.waitForFunction(() => document.getElementById("help").open);
        assert.equal(await inView("help-coordinates"), true, "the Coordinates hint opens its section");
        await phone.keyboard.press("Escape");
        await closed();
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
    async AL() {
        // The About section sits below the open games and the host form, links the repository (also from the
        // footer), carries a demo video that loads lazily and plays only on screen without reduced motion,
        // a few lazy screenshots that fit a phone, and is gone in a game (ADR 29).
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
        // Screenshots below the video: 2 to 4, lazy, with the size and the alt text, and they load once scrolled to.
        const shots = about.locator("img");
        const count = await shots.count();
        assert.ok(count >= 2 && count <= 4, `2 to 4 screenshots, got ${count}`);
        for (let i = 0; i < count; i++) {
            const img = shots.nth(i);
            assert.equal(await img.getAttribute("loading"), "lazy", `screenshot ${i} is lazy`);
            assert.match((await img.getAttribute("alt")) ?? "", /\S{3}/, `screenshot ${i} has alt text`);
            for (const attr of ["width", "height"]) assert.match((await img.getAttribute(attr)) ?? "", /^\d+$/, `screenshot ${i} has a ${attr}`);
            assert.ok((await img.evaluate((el) => el.closest("figure").querySelector("figcaption")?.textContent.trim().length)) > 0, `screenshot ${i} has a caption`);
            await img.scrollIntoViewIfNeeded();
            await page.waitForFunction((n) => document.querySelectorAll("#about img")[n].naturalWidth > 0, i);
        }
        // At a phone's width nothing scrolls sideways.
        const phone = await (await browser.newContext({ viewport: { width: 360, height: 700 } })).newPage();
        await phone.goto(url);
        for (const img of await phone.locator("#about img").all()) await img.scrollIntoViewIfNeeded();
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "no horizontal scroll at 360 px");
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
        // The Help button ends where the screen under it ends (ADR 17, section 6; ADR 26).
        const assertHelpAligned = async (page, sel, what) => {
            const [help, screen] = [await box(page, "#help-open"), await box(page, sel)];
            assert.ok(Math.abs(help.right - screen.right) <= 1, `Help lines up with ${what} (${help.right}, ${screen.right})`);
        };
        const lobby = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
        await lobby.goto(url);
        assertCentred(await box(lobby, "#lobby"), "the lobby at 1920 px");
        await assertHelpAligned(lobby, "#lobby", "the lobby");
        // Help's list items keep the measure of its paragraphs.
        const measures = await lobby.evaluate(() => ["#help li", "#help p"].map((s) => getComputedStyle(document.querySelector(s)).maxWidth));
        assert.ok(measures[0] !== "none" && measures[0] === measures[1], `Help's list items are 65ch like its paragraphs (${measures})`);
        const changelog = await lobby.context().newPage();
        await changelog.goto(`${url}changelog.html`);
        const page = await box(changelog, "main");
        assertCentred(page, "the changelog at 1920 px");
        assert.ok(page.width < 1000, `the changelog keeps a reading measure (${page.width} px)`);
        await lobby.setViewportSize({ width: 360, height: 800 });
        assert.equal((await box(lobby, "#lobby")).sideways, false, "the lobby does not scroll sideways at 360 px");
        // The Test arena entry sits under the open games, next to the empty-list text (ADR 25).
        assert.equal(await lobby.locator("[aria-labelledby=open-games] #test-open").count(), 1, "Test arena is in Open games");
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
        // On a phone the arena's editor comes right after the board, and the setup panel after it.
        await lobby.setViewportSize({ width: 360, height: 800 });
        const [fire, setup] = await lobby.evaluate(() => ["fire", "test-panel"].map((id) => document.getElementById(id).getBoundingClientRect().top));
        assert.ok(fire < setup, `the editor comes before the setup panel on a phone (${fire}, ${setup})`);
        // Focus follows the same order: from Back to lobby, Tab reaches the editor before the setup.
        await lobby.focus("#test-exit");
        let next = "";
        for (let i = 0; i < 40 && !["mode-explicit", "input-a", "test-field"].includes(next); i++) {
            await lobby.keyboard.press("Tab");
            next = await lobby.evaluate(() => document.activeElement.id);
        }
        assert.notEqual(next, "test-field", `Tab reaches the editor before the setup panel (${next})`);
        const inRoom = async ([page]) => {
            await page.setViewportSize({ width: 1920, height: 1080 });
            await assertHelpAligned(page, "#room", "the waiting room");
        };
        const { pages, errors } = await startGame(1, "xy", "AM", { bots: ["easy"], offline: true, beforeStart: inRoom });
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
        await assertHelpAligned(host, "#game", "the game");
        const board = await box(host, "#arena");
        assert.ok(board.width > 1000, `the board grows with the window (${board.width} px)`);
        await host.setViewportSize({ width: 360, height: 800 });
        assert.equal((await box(host, "#game")).sideways, false, "the game does not scroll sideways at 360 px");
        // The board's height budget counts the Help bar and the status bar's button, with a fine or a
        // coarse pointer: a disc game's last-shot line ends inside the window (ADR 17, section 4).
        const discErrors = [];
        for (const hasTouch of [false, true]) {
            const disc = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch })).newPage();
            disc.on("pageerror", (e) => discErrors.push(`disc: ${e}`));
            await disc.goto(url);
            await disc.context().setOffline(true);
            await disc.selectOption("#host-field", "disc");
            await disc.click("#host-form button[type=submit]");
            await disc.click("#add-bot");
            await disc.click("#start");
            await disc.waitForSelector("#game:not([hidden])");
            const [bottom, height] = await disc.evaluate(() => {
                scrollTo(0, 0);
                return [document.getElementById("last-shot").getBoundingClientRect().bottom, innerHeight];
            });
            assert.ok(bottom <= height, `the disc's last-shot line ends in the window, ${hasTouch ? "coarse" : "fine"} pointer (${bottom}, ${height})`);
        }
        return [...errors, ...discErrors];
    },
};
