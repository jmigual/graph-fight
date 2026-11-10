// Runs one e2e scenario in its own browser; `tests/e2e.mjs` starts one of these per scenario (ADR 33).
// Run: E2E_LOBBY=<suffix> node tests/e2e-worker.mjs [NAME]
// Prints the failure and exits 1 if the scenario fails, prints nothing and exits 0 if it passes.
// Without NAME it only checks that `ORDER` lists every scenario.
import assert from "node:assert/strict";
import { browser, server } from "./e2e/helpers.mjs";
import { ORDER } from "./e2e/order.mjs";
import { scenarios as core } from "./e2e/core.mjs";
import { scenarios as net } from "./e2e/net.mjs";
import { scenarios as bots } from "./e2e/bots.mjs";
import { scenarios as local } from "./e2e/local.mjs";
import { scenarios as editor } from "./e2e/editor.mjs";
import { scenarios as ui } from "./e2e/ui.mjs";
import { scenarios as arena } from "./e2e/arena.mjs";
import { scenarios as build } from "./e2e/build.mjs";
import { scenarios as teams } from "./e2e/teams.mjs";

const scenarios = { ...core, ...net, ...bots, ...local, ...editor, ...ui, ...arena, ...build, ...teams };

let failed = false;
try {
    assert.deepEqual(Object.keys(scenarios).sort(), [...ORDER].sort(), "ORDER lists every scenario");
    if (process.argv[2]) assert.deepEqual(await scenarios[process.argv[2]](), [], "uncaught page errors");
} catch (err) {
    failed = true;
    console.log(err.stack ?? err);
}
await Promise.all(browser.contexts().map((c) => c.close()));
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
