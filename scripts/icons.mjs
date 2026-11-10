// Renders static/favicon.svg (light scheme) to the PNG icons beside it (ADR 17).
// Run after editing the SVG: node scripts/icons.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = new URL("../static/", import.meta.url);
const svg = `data:image/svg+xml;base64,${readFileSync(new URL("favicon.svg", dir)).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage({ colorScheme: "light" });
// iOS draws transparent pixels black and rounds the corners itself, so the touch icon is filled
// edge to edge with the light paper.
for (const [file, size, background] of [["favicon-32.png", 32, "transparent"], ["apple-touch-icon.png", 180, "#EEF4EF"]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;background:${background}"><img src="${svg}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.locator("img").evaluate((img) => img.decode());
    await page.screenshot({ path: fileURLToPath(new URL(file, dir)), omitBackground: background === "transparent" });
}
await browser.close();
