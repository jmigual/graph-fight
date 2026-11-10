// End-to-end scenarios: the test arena (ADR 25).
import assert from "node:assert/strict";
import { browser, shooter, text, url } from "./helpers.mjs";

export const scenarios = {
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
};
