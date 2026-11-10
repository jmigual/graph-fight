// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15).
// Run: npm run build && npm run e2e [-- NAME...]
// Without names every scenario runs in the order of `ORDER`; with names, only those, in the order given
// (`npm run e2e -- AI AK`).
import assert from "node:assert/strict";
import { browser, server } from "./e2e/helpers.mjs";
import { scenarios as core } from "./e2e/core.mjs";
import { scenarios as net } from "./e2e/net.mjs";
import { scenarios as bots } from "./e2e/bots.mjs";
import { scenarios as local } from "./e2e/local.mjs";
import { scenarios as editor } from "./e2e/editor.mjs";
import { scenarios as ui } from "./e2e/ui.mjs";
import { scenarios as arena } from "./e2e/arena.mjs";
import { scenarios as build } from "./e2e/build.mjs";

const scenarios = { ...core, ...net, ...bots, ...local, ...editor, ...ui, ...arena, ...build };

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
