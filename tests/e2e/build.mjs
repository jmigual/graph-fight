// End-to-end scenarios: the icons and the footer version (ADR 17, 28).
import assert from "node:assert/strict";
import { browser, url } from "./helpers.mjs";

export const scenarios = {
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
