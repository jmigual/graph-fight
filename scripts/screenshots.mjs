// Takes the README's screenshots (docs/img/*.png) on the built dist/, in the light theme only (ADR 17).
// Needs `npm run build` first and Playwright's Chromium. The lobby and the multi-player games need the
// Nostr relays (real peers); the test arena and the saved formulas are taken offline.
// `about` then makes the web-sized WebP copies the About section serves (ADR 29) from four of those PNGs,
// so it also runs alone, offline, on the PNGs already in docs/img.
// Run: node scripts/screenshots.mjs [lobby|xy|disc|phone|arena|about ...]   (no names: all of them; xy also takes formulas.png)
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const DIST = resolve(root, "dist");
const OUT = resolve(root, "docs/img");
const ABOUT_OUT = resolve(root, "static/about");
/** The README images the About section shows, with the CSS width each has there; the copy is 2x that wide. */
const ABOUT = { "game-xy": 564, "game-disc": 564, "formulas": 424, arena: 564 };
const ABOUT_QUALITY = 0.85;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };
/** Every context is light, so no image can show the dark theme. Rendered at 2x so they are sharp on GitHub. */
const CONTEXT = { colorScheme: "light", reducedMotion: "reduce", deviceScaleFactor: 2 };
const DESKTOP = { ...CONTEXT, viewport: { width: 1280, height: 800 } };
const PHONE = { ...CONTEXT, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
/** A shot shorter than this (in field units) says little, so the game is played again on a new arena. */
const MIN_PATH = 20;
const RELAYS_MS = 120000;

const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(DIST, path.endsWith("/") ? `${path}index.html` : path);
    if (!file.startsWith(DIST)) return void res.writeHead(403).end();
    try {
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
    } catch {
        res.writeHead(404).end();
    }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;
// mDNS hides the local addresses, and then two pages of one machine cannot connect.
const browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

const open = async (options) => {
    const page = await (await browser.newContext(options)).newPage();
    page.on("pageerror", (e) => console.log(`pageerror: ${e}`));
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    return page;
};
/** Takes `clip` of the whole page, or the viewport without one. */
const save = (page, name, clip) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: Boolean(clip), clip });
const closeAll = (pages) => Promise.all(pages.map((p) => p.context().close()));

/** Hosts a game of `n` pages on `field` and starts it; the first page is the host. */
async function startGame(n, field, name, options) {
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(await open(options));
    const [host, ...guests] = pages;
    await host.fill("#host-name", name);
    await host.selectOption("#host-field", field);
    if (field === "disc") await host.fill("#host-seats", String(n));
    await host.click("#host-form button[type=submit]");
    const joins = guests.map((g) => g.locator("#games tr", { hasText: name }).getByRole("button", { name: "Join", disabled: false }));
    await Promise.all(joins.map((j) => j.waitFor({ timeout: RELAYS_MS })));
    await Promise.all(joins.map((j) => j.click()));
    await host.waitForFunction((k) => document.querySelectorAll("#room-players li").length === k, n, { timeout: RELAYS_MS });
    await host.click("#start");
    for (const p of pages) await p.waitForSelector("#game:not([hidden])", { timeout: RELAYS_MS });
    return pages;
}

/** The page whose Fire button is enabled, once exactly one is. */
async function shooter(pages) {
    for (const end = Date.now() + 30000; Date.now() < end; await pages[0].waitForTimeout(200)) {
        const ready = [];
        for (const p of pages) if (await p.isEnabled("#fire")) ready.push(p);
        if (ready.length === 1) return ready[0];
    }
    throw new Error("Nobody can fire.");
}

/** Plays one turn: the shooter fires `exprs` (one formula, or x(t) and y(t)) and every page sees the next turn. */
async function takeTurn(pages, turn, exprs, direction) {
    const page = await shooter(pages);
    await page.check(exprs.length === 2 ? "#mode-parametric" : "#mode-explicit");
    await page.fill("#input-a", exprs[0]);
    if (exprs.length === 2) await page.fill("#input-b", exprs[1]);
    if (direction) await page.check(direction === "cw" ? "#dir-cw" : "#dir-ccw");
    await page.click("#fire");
    for (const p of pages) await p.waitForFunction((t) => window.__state()?.turn === t, turn + 1, { timeout: 30000 });
    await pages[0].waitForTimeout(500);
}

/** Plays `turns` ([formulas, direction] each) until the last shot travelled far enough; returns the page to shoot. */
async function play(n, field, name, options, turns) {
    for (;;) {
        const pages = await startGame(n, field, name, options);
        for (const [turn, [exprs, direction]] of turns.entries()) await takeTurn(pages, turn, exprs, direction);
        const points = await pages[0].evaluate(() => window.__state().shot?.points ?? []);
        const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
        if (length >= MIN_PATH) return pages;
        await closeAll(pages);
    }
}

/** The test arena with hand-placed players and obstacles, two shots fired. */
async function arena() {
    const page = await open(DESKTOP);
    await page.context().setOffline(true);
    await page.click("#test-open");
    const board = page.locator("#arena");
    const click = async (x, y) => {
        await page.evaluate(() => scrollTo(0, 0));
        const box = await board.boundingBox();
        const s = box.width / 40;
        await page.mouse.click(box.x + (x + 20) * s, box.y + (10 - y) * s);
    };
    const place = async (id, spots, team) => {
        await page.check(id);
        if (team !== undefined) await page.selectOption("#test-team", String(team));
        for (const [x, y] of spots) await click(x, y);
    };
    await place("#place-player", [[-14, -3], [-10, 6]], 0);
    await place("#place-player", [[12, 2], [6, -6]], 1);
    await page.fill("#obstacle-size", "1.5");
    await place("#place-obstacle", [[3, 4]]);
    await page.fill("#obstacle-size", "1");
    await place("#place-obstacle", [[-4, -2.5], [-7, 3]]);
    const fire = async (expr) => {
        await page.fill("#input-a", expr);
        await page.click("#fire");
        await page.waitForTimeout(300);
    };
    await page.getByRole("button", { name: /^Team 2 player 1/ }).click();
    await fire("-2*x/9");
    await page.getByRole("button", { name: /^Team 1 player 1/ }).click();
    await fire("5*(x+14)/26 + 2*sin(pi*(x+14)/13)");
    await page.mouse.move(0, 0);
    await page.evaluate(() => scrollTo(0, 0));
    await save(page, "arena", { x: 0, y: 0, width: 1280, height: 640 });
    await page.context().close();
}

/** Scales the PNG `name` to `2 * width` pixels and encodes it as WebP, which Chromium's canvas can do and its screenshots cannot. */
async function webp(name, width) {
    const page = await browser.newPage();
    const png = (await readFile(`${OUT}/${name}.png`)).toString("base64");
    const copy = await page.evaluate(async ([data, w, quality]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = new OffscreenCanvas(2 * w, Math.round((2 * w * img.height) / img.width));
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality });
        return { size: [canvas.width, canvas.height], data: btoa(Array.from(new Uint8Array(await blob.arrayBuffer()), (b) => String.fromCharCode(b)).join("")) };
    }, [png, width, ABOUT_QUALITY]);
    await page.close();
    writeFileSync(`${ABOUT_OUT}/${name}.webp`, Buffer.from(copy.data, "base64"));
    console.log(`about/${name}.webp ${copy.size.join("x")} (shown at ${width}x${Math.round(copy.size[1] / 2)}) ${Buffer.from(copy.data, "base64").length} bytes`);
}

const shots = {
    async lobby() {
        // A guest's lobby with a password game and a public one, its host form set to Password, down to the Test arena button and the Password field.
        const [quiz, duel, guest] = [await open(DESKTOP), await open(DESKTOP), await open(DESKTOP)];
        await quiz.fill("#host-name", "Quiz night");
        await quiz.selectOption("#host-field", "disc");
        await quiz.fill("#host-seats", "4");
        await quiz.selectOption("#host-visibility", "password");
        await quiz.fill("#host-password", "maths");
        await quiz.click("#host-form button[type=submit]");
        await duel.fill("#host-name", "Friday duel");
        await duel.click("#host-form button[type=submit]");
        for (const name of ["Quiz night", "Friday duel"]) await guest.locator("#games tr", { hasText: name }).waitFor({ timeout: RELAYS_MS });
        await guest.selectOption("#host-visibility", "password");
        await guest.mouse.move(0, 0);
        const bottom = await guest.evaluate(() => Math.max(...["test-open", "host-password"].map((id) => document.getElementById(id).getBoundingClientRect().bottom)));
        await save(guest, "lobby", { x: 0, y: 0, width: 1280, height: Math.ceil(bottom + 24) });
        await closeAll([quiz, duel, guest]);
    },
    async xy() {
        const pages = await play(2, "xy", "Friday duel", DESKTOP, [[["2*sin(x/2)"]], [["-0.04*x^2 + 1.2*x"]], [["0.15*x + 2*sin(x/2)"]]]);
        const page = await shooter(pages);
        await page.fill("#input-a", "0.5*x*sin(x/2)");
        await page.waitForTimeout(500);
        await save(page, "game-xy", { x: 0, y: 0, width: 1280, height: 560 });
        // The saved formulas of the same page: the Parabola template with its compact sliders open.
        const item = page.locator("#saved-list li", { hasText: "Parabola" });
        await item.locator("summary").click();
        await item.locator('[aria-label="Value of a"]').fill("-0.03");
        await item.locator('[aria-label="Value of a"]').blur();
        await page.waitForTimeout(300);
        const top = await page.evaluate(() => document.getElementById("saved").getBoundingClientRect().top + scrollY);
        const bottom = await item.evaluate((el) => el.getBoundingClientRect().bottom + scrollY);
        await save(page, "formulas", { x: 856, y: top - 16, width: 424, height: bottom - top + 32 });
        await closeAll(pages);
    },
    async disc() {
        const pages = await play(4, "disc", "Disc party", DESKTOP, [[["1.5*sin(3*θ)"]], [["θ/2"], "cw"], [["-t", "0.15*sin(t)"]], [["-θ/4"], "cw"]]);
        const page = await shooter(pages);
        await page.fill("#input-a", "0.8*θ");
        await page.waitForTimeout(500);
        await save(page, "game-disc", { x: 0, y: 0, width: 1280, height: 800 });
        await closeAll(pages);
    },
    async phone() {
        const pages = await play(2, "xy", "Phone duel", PHONE, [[["2*sin(x/2)"]], [["-0.04*x^2 + 1.2*x"]]]);
        const page = await shooter(pages);
        await page.fill("#input-a", "3*sin(x/3)");
        await page.waitForTimeout(500);
        await save(page, "phone");
        await closeAll(pages);
    },
    arena,
    async about() {
        mkdirSync(ABOUT_OUT, { recursive: true });
        for (const [name, width] of Object.entries(ABOUT)) await webp(name, width);
    },
};

try {
    const names = process.argv.slice(2);
    const unknown = names.filter((n) => !(n in shots));
    if (unknown.length) throw new Error(`Unknown shot: ${unknown.join(", ")}. Choose from ${Object.keys(shots).join(", ")}.`);
    for (const name of names.length ? names : Object.keys(shots)) await shots[name]();
} finally {
    await browser.close();
    server.close();
}
