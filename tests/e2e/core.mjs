// End-to-end scenarios: turns, shots, timeouts, directions and the end of a game (ADR 14, 17, 20).
import assert from "node:assert/strict";
import { TURN_WAIT_MS, assertBuild, assertRejected, assertSynced, comparable, shooter, startGame, state, takeTurn, text } from "./helpers.mjs";

export const scenarios = {
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
};
