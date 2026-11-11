// End-to-end scenarios: bots in a game (ADR 21).
import assert from "node:assert/strict";
import { SETUP_MS, TURN_WAIT_MS, assertSynced, gameOver, startGame, state, takeTurn, text, watchPen } from "./helpers.mjs";

export const scenarios = {
    async S() {
        // Solo against a Hard bot with the network cut once the page has loaded (ADR 21): the host's
        // page plays the bot, and the game runs to the end.
        const { pages, errors } = await startGame(1, "xy", "S", { bots: ["hard"], offline: true });
        const [host] = pages;
        await watchPen(host);
        assert.equal(await host.evaluate(() => navigator.onLine), false);
        assert.equal((await host.locator("#roster .id").allInnerTexts())[1], "Bot 1, hard");
        let waited = Infinity;
        for (let turn = 0; ; turn++) {
            await assertSynced(pages, turn);
            if (await gameOver(host)) break;
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
        // The shot that ends the game plays out before the result shows (ADR 17).
        assert.ok((await host.evaluate(() => window.__penMs)) >= 600, "the last shot's pen lands before the end screen");
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
};
