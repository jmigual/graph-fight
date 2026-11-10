// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e [-- NAME...]
// Without names every scenario runs in the order of `ORDER`; with names, only those, in the order given
// (`npm run e2e -- AI AK`).
import assert from "node:assert/strict";
import { browser, server, url } from "./e2e/helpers.mjs";
import { scenarios as arena } from "./e2e/arena.mjs";
import { scenarios as ui } from "./e2e/ui.mjs";
import { scenarios as editor } from "./e2e/editor.mjs";
import { scenarios as local } from "./e2e/local.mjs";
import { scenarios as bots } from "./e2e/bots.mjs";
import { scenarios as net } from "./e2e/net.mjs";
import { scenarios as core } from "./e2e/core.mjs";

const scenarios = {
    ...arena,
    ...ui,
    ...editor,
    ...local,
    ...bots,
    ...net,
    ...core,
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
