// End-to-end scenarios: local players, kicks, and password and private-link games (ADR 22, 23, 24).
import assert from "node:assert/strict";
import { SETUP_MS, TURN_WAIT_MS, assertGivesUp, assertSynced, browser, shooter, startGame, state, takeTurn, text, url, watchFrames } from "./helpers.mjs";

export const scenarios = {
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
};
