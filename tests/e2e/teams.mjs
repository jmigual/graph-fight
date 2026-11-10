// End-to-end scenarios: team mode and the characters per player (ADR 27).
import assert from "node:assert/strict";
import { SETUP_MS, TURN_WAIT_MS, assertSynced, browser, shooter, startGame, state, text, url, watchFrames } from "./helpers.mjs";

/** Opens a page that records its page errors in `errors` and accepts every dialog, keeping its text. */
async function open(errors, i) {
    const page = await (await browser.newContext()).newPage();
    page.on("pageerror", (e) => errors.push(`page ${i}: ${e}`));
    watchFrames(page);
    page.dialogs = [];
    page.on("dialog", (d) => {
        page.dialogs.push(d.message());
        return d.accept();
    });
    await page.goto(url);
    return page;
}

/** Waits until `page`'s waiting room shows `want` (each side's row texts). */
async function waitSides(page, want) {
    await page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll("#room-players li.side")].map((side) => [...side.querySelectorAll(".seats > li")].map((li) => li.firstChild.textContent.trim()))) === w, JSON.stringify(want), { timeout: SETUP_MS });
}

/**
 * Fires, from whichever page may fire, a shot that hits nobody: in the player-centred frame
 * `sqrt(0.0001 - x)` is defined at the shooter (x = 0) and nowhere past it, so the shot ends at once.
 * Returns that page.
 */
async function fire(pages, turn) {
    const page = await shooter(pages);
    await page.check("#mode-explicit");
    await page.fill("#input-a", "sqrt(0.0001 - x)");
    await page.click("#fire");
    await assertSynced(pages, turn + 1);
    return page;
}

export const scenarios = {
    async AO() {
        // A 2-against-2 XY game with 1 character per player: the host, a local player and two
        // guests. Guests see the host's sides before the start (`lineup`, taken only before it), one
        // asks to change sides (`team`), the seats of each side take its characters in turn, and a
        // guest who leaves while it aims hands its character to its teammate, who gets a new turn.
        const errors = [];
        const [host, first, second] = await Promise.all([0, 1, 2].map((i) => open(errors, i)));
        const name = `e2e-AO-${Math.random().toString(36).slice(2, 8)}`;
        await host.fill("#host-name", name);
        await host.selectOption("#host-field", "xy");
        await host.selectOption("#host-frame", "player");
        await host.selectOption("#host-mode", "teams");
        assert.deepEqual(await Promise.all(["#host-seats", "#host-teams", "#host-team-size"].map((sel) => host.isVisible(sel))), [false, false, true], "XY teams: Players per team only");
        await host.fill("#host-team-size", "2");
        await host.selectOption("#host-characters", "1");
        await host.click("#host-form button[type=submit]");
        assert.equal(await text(host, "#room-info"), "XY plane, player-centred, 2 teams of 2, 1 character each");
        const hostId = (await text(host, "#room-players .seats > li")).split(" ")[0];
        await waitSides(host, [[`${hostId} (you) (host)`], []]);

        // The lobby lists the sides' open seats and the characters per player.
        const row = first.locator("#games tr", { hasText: name });
        await row.getByRole("button", { name: "Join" }).waitFor({ timeout: SETUP_MS });
        assert.match(await row.innerText(), /2 teams of 2, Team 1: 1 open, Team 2: 2 open, 1 character each/);
        await row.getByRole("button", { name: "Join" }).click();
        await first.waitForSelector("#room-players li.side", { timeout: SETUP_MS });
        const firstId = (await first.locator("#room-players li", { hasText: "(you)" }).last().innerText()).split(" ")[0];
        // The joiner goes to the side with the most open seats; the guest shows the host's lineup.
        await waitSides(first, [[`${hostId} (host)`], [`${firstId} (you)`]]);

        const row2 = second.locator("#games tr", { hasText: name });
        await row2.getByRole("button", { name: "Join" }).waitFor({ timeout: SETUP_MS });
        await row2.getByRole("button", { name: "Join" }).click();
        await second.waitForSelector("#room-players li.side", { timeout: SETUP_MS });
        const secondId = (await second.locator("#room-players li", { hasText: "(you)" }).last().innerText()).split(" ")[0];
        // A tie goes to the lowest side.
        await waitSides(host, [[`${hostId} (you) (host)`, secondId], [firstId]]);
        // The second guest asks for Team 2, which has room; the host moves it and tells everyone.
        await waitSides(second, [[`${hostId} (host)`, `${secondId} (you)`], [firstId]]);
        assert.equal(await second.getByRole("button", { name: "Join Team 1" }).count(), 0, "no Join for our own side");
        await second.getByRole("button", { name: "Join Team 2" }).click();
        for (const page of [host, first, second]) await waitSides(page, [[page === host ? `${hostId} (you) (host)` : `${hostId} (host)`], [page === first ? `${firstId} (you)` : firstId, page === second ? `${secondId} (you)` : secondId]]);
        // A local player takes the one open seat; then both sides are full.
        assert.equal(await host.isEnabled("#start"), true);
        await host.click("#add-local");
        await waitSides(host, [[`${hostId} (you) (host)`, "Local 1"], [firstId, secondId]]);
        assert.deepEqual([await host.isDisabled("#add-local"), await host.isDisabled("#add-bot")], [true, true], "no open seat left");
        await host.click("#start");
        const pages = [host, first, second];
        for (const page of pages) await page.waitForSelector("#game:not([hidden])", { timeout: SETUP_MS });
        await assertSynced(pages, 0);
        const s0 = JSON.parse(await state(host));
        assert.deepEqual(s0.arena.teams.map((t) => t.players.length), [2, 2], "c = k x S = 2 on each side");
        assert.deepEqual(await Promise.all(pages.map(async (p) => JSON.parse(await state(p)).me)), [0, 1, 1], "me is our side");
        for (const page of pages) assert.deepEqual(await page.locator("#roster .seats .id").allInnerTexts(), [hostId, "Local 1", firstId, secondId]);

        // The seats of a side take its characters in turn: Team 1 seat 1, Team 2 seat 1, Team 1 seat 2, Team 2 seat 2.
        const order = [];
        for (let turn = 0; turn < 3; turn++) {
            const { shooter: seat } = JSON.parse(await state(host));
            order.push(seat.slice(0, 6));
            if (seat.startsWith(firstId)) assert.equal(await text(host, "#turn"), `Team 2: ${firstId} is aiming`);
            if (seat === "local:1") assert.equal(await text(host, "#turn"), "Local 1's turn");
            await fire(pages, turn);
        }
        const aiming = JSON.parse(await state(host));
        assert.deepEqual([...order, aiming.shooter.slice(0, 6)], [hostId, firstId, "local:", secondId], "seats take turns within each side");
        assert.ok(aiming.arena.teams.every((t) => t.players.every((pl) => pl.alive)), "the shots hit nobody");

        // The second guest leaves while it aims Team 2's second character: the first guest takes it
        // over at once, before any shot, and gets a full turn of its own.
        await second.waitForFunction(() => Number(document.getElementById("countdown").textContent) <= 55, null, { timeout: TURN_WAIT_MS });
        await second.click("#quit");
        assert.equal(second.dialogs.at(-1), "Leave the game? Your teammates take over your players.");
        const rest = [host, first];
        for (const page of rest) await page.waitForFunction((id) => window.__state().shooter.startsWith(id), firstId, { timeout: TURN_WAIT_MS });
        for (const page of rest) assert.equal(JSON.parse(await state(page)).turn, 3, "no shot was applied");
        assert.equal(await text(host, "#last-shot"), `${secondId} left the game. Team 2 plays on.`);
        assert.deepEqual(await host.locator("#roster .seats li", { hasText: secondId }).locator(".state").allInnerTexts(), ["left"]);
        await first.waitForFunction(() => document.getElementById("turn-cue").textContent === "Your turn", null, { timeout: TURN_WAIT_MS });
        await first.waitForFunction(() => Number(document.getElementById("countdown").textContent) >= 58, null, { timeout: 2000 });
        assert.equal(await text(host, "#turn"), `Team 2: ${firstId} is aiming`);
        // The heir fires the character it inherited.
        assert.equal(await fire(rest, 3), first);

        // The host kicks the last seat of Team 2: its side is out and Team 1 wins.
        await host.getByRole("button", { name: `Kick ${firstId}` }).click();
        assert.equal(host.dialogs.at(-1), `Kick ${firstId}? Their team will be out.`);
        await host.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        // Local players share the host's screen, so the side is named, with its seats.
        assert.equal(await text(host, "#end-message"), "Team 1 wins.");
        assert.equal(await text(host, "#end-detail"), `${hostId}, Local 1`);
        await first.waitForSelector("#end:not([hidden])", { timeout: TURN_WAIT_MS });
        assert.equal(await text(first, "#end-message"), "The host removed you from this game.");
        return errors;
    },
    async AP() {
        // Characters per player in a free-for-all (ADR 27): 2 each, alone against a bot offline.
        const beforeStart = async ([page]) => assert.equal(await text(page, "#room-info"), "XY plane, map-centred, 2 seats, 2 characters each");
        const { pages, errors } = await startGame(1, "xy", "AP", { bots: ["easy"], offline: true, characters: 2, beforeStart });
        const [host] = pages;
        await assertSynced(pages, 0);
        assert.deepEqual(JSON.parse(await state(host)).arena.teams.map((t) => t.players.length), [2, 2]);
        assert.deepEqual(await host.locator("#roster .pips").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["2 of 2 players left", "2 of 2 players left"]);
        return errors;
    },
};
