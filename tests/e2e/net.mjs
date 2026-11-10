// End-to-end scenarios: the lobby listing, seats, reconnection and a host that goes away (ADR 12, 16, 18).
import assert from "node:assert/strict";
import { RECONNECT_MS, SETUP_MS, TURN_WAIT_MS, assertGivesUp, assertQuiet, assertSynced, browser, startGame, state, takeTurn, text, url, watchFrames } from "./helpers.mjs";

export const scenarios = {
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
};
