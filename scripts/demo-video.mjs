// Records the About section's demo video (ADR 29): a solo game against an Easy bot on the built
// dist/, with the network cut as in e2e scenario S. Needs `npm run build` first and Playwright's
// Chromium. Writes static/demo.webm and static/demo-poster.jpg; ffmpeg is not needed.
// Run: node scripts/demo-video.mjs
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const DIST = resolve(root, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };
/** Wide enough for the two-column game layout, small enough for a small file. */
const SIZE = { width: 960, height: 540 };
/** The recording is scaled down from the viewport: the file stays small and the game stays legible. */
const VIDEO = { width: 480, height: 270 };
const pause = (page, ms) => page.waitForTimeout(ms);

const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(DIST, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(DIST)) return void res.writeHead(403).end();
    try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

const tmp = mkdtempSync(join(tmpdir(), "graph-fight-demo-"));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: VIDEO } });
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await context.setOffline(true);
await pause(page, 1000);

await page.selectOption("#host-field", "xy");
await page.click("#host-form button[type=submit]");
await page.selectOption("#bot-level", "easy");
await page.click("#add-bot");
await pause(page, 800);
await page.click("#start");
await page.waitForSelector("#game:not([hidden])");
await pause(page, 1500);

let poster;
for (const formula of ["3*sin(x/2)", "x/3 + sin(x)"]) {
    // Our turn: the bot waits at least 1.5 s before it fires, and the game may be over already.
    await page.waitForSelector("#fire:enabled, #end:not([hidden])");
    if (await page.isVisible("#end")) break;
    const turn = await page.evaluate(() => window.__state().turn);
    // The editor holds our previous formula on our next turn (ADR 17).
    await page.fill("#input-a", "");
    await page.locator("#input-a").pressSequentially(formula, { delay: 120 });
    await pause(page, 500);
    await page.click("#fire");
    await page.waitForFunction((t) => window.__state().turn > t, turn);
    await pause(page, 1500);
    poster ??= await page.screenshot({ type: "jpeg", quality: 70 });
}
await pause(page, 1500);
if (!poster) throw new Error("The game ended before our first shot, so there is no poster frame. Run it again.");

const video = page.video();
await context.close();
await video.saveAs(resolve(root, "static/demo.webm"));
writeFileSync(resolve(root, "static/demo-poster.jpg"), poster);
await browser.close();
server.close();
rmSync(tmp, { recursive: true, force: true });
