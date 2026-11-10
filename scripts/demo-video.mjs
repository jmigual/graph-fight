// Records the About section's demo video (ADR 29): a solo game against an Easy bot on the built
// dist/, with the network cut as in e2e scenario S. Needs `npm run build` first, Playwright's
// Chromium and the ffmpeg that `npx playwright install` puts next to it. Writes static/demo.webm
// and static/demo-poster.jpg.
// Run: node scripts/demo-video.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const DIST = resolve(root, "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };
/** Wide enough for the two-column game layout. */
const SIZE = { width: 960, height: 540 };
/** Rendered at 2x, so the video is 1920x1080: sharp full screen and on a HiDPI display. */
const SCALE = 2;
/** Frames per second of the video; the shot is the only fast motion. */
const FPS = 15;
/** VP9 constant quality (lower is better) and the JPEG quality of the captured frames and the poster. */
const CRF = 24;
const FRAME_QUALITY = 92;
const POSTER_QUALITY = 80;
const pause = (page, ms) => page.waitForTimeout(ms);

/** Playwright's bundled ffmpeg, found next to its Chromium (the `ffmpeg-NNNN` folder of the browsers path). */
function bundledFfmpeg() {
    const parts = chromium.executablePath().split(sep);
    const at = parts.findIndex((part) => part.startsWith("chromium-"));
    const browsers = parts.slice(0, at).join(sep) || sep;
    const name = { linux: "ffmpeg-linux", darwin: "ffmpeg-mac", win32: "ffmpeg-win64.exe" }[process.platform];
    const dir = at < 0 || !name ? undefined : readdirSync(browsers).find((d) => d.startsWith("ffmpeg-"));
    if (!dir) throw new Error("Playwright's ffmpeg was not found next to its Chromium. Run `npx playwright install chromium`.");
    return join(browsers, dir, name);
}

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

const ffmpeg = spawn(bundledFfmpeg(), [
    "-y", "-v", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "pipe:0",
    "-c:v", "libvpx-vp9", "-crf", String(CRF), "-b:v", "0", "-pix_fmt", "yuv420p", "-row-mt", "1", "-g", String(FPS * 10),
    resolve(root, "static/demo.webm"),
], { stdio: ["pipe", "inherit", "inherit"] });
const encoded = new Promise((ok, fail) => {
    ffmpeg.on("error", fail);
    ffmpeg.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))));
});

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: SCALE });
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
// A screenshot takes longer than a frame, so each one is repeated for the frames that fell due while it was taken.
const started = Date.now();
let frames = 0;
let recording = true;
const capture = (async () => {
    while (recording) {
        const jpeg = await page.screenshot({ type: "jpeg", quality: FRAME_QUALITY });
        const due = Math.floor(((Date.now() - started) * FPS) / 1000) + 1;
        for (; frames < due; frames++) ffmpeg.stdin.write(jpeg);
    }
})();
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
    poster ??= await page.screenshot({ type: "jpeg", quality: POSTER_QUALITY, scale: "css" });
}
await pause(page, 1500);
if (!poster) throw new Error("The game ended before our first shot, so there is no poster frame. Run it again.");

recording = false;
await capture;
ffmpeg.stdin.end();
await encoded;
writeFileSync(resolve(root, "static/demo-poster.jpg"), poster);
await browser.close();
server.close();
