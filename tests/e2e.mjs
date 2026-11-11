// End-to-end test over the real Nostr lobby and real WebRTC (ADR 15, 33).
// Run: npm run build && npm run e2e [-- NAME...]
// Without names every scenario runs, slowest first (`ORDER`); with names, only those, in the order given
// (`npm run e2e -- AI AK`). Each scenario runs in its own process (`e2e-worker.mjs`) with its own browser
// and lobby topic; `E2E_JOBS` of them run at once (default 4, 1 is sequential).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ORDER } from "./e2e/order.mjs";

const run = promisify(execFile);
const worker = fileURLToPath(new URL("./e2e-worker.mjs", import.meta.url));
const SCENARIO_TIMEOUT_S = 180;
/** Scenarios that may run longer than `SCENARIO_TIMEOUT_S` (seconds): S plays a bot game of random length. */
const LONGER_S = { S: 300 };
const timeoutOf = (name) => LONGER_S[name] ?? SCENARIO_TIMEOUT_S;
const names = [...new Set(process.argv.length > 2 ? process.argv.slice(2) : ORDER)];
const unknown = names.filter((name) => !ORDER.includes(name));
if (unknown.length) {
    console.log(`Unknown scenarios: ${unknown.join(", ")}`);
    process.exit(1);
}
const jobs = Number(process.env.E2E_JOBS ?? 4);
if (!Number.isInteger(jobs) || jobs < 1) {
    console.log(`E2E_JOBS must be a positive integer, got ${process.env.E2E_JOBS}`);
    process.exit(1);
}

// A worker given no scenario only checks that `ORDER` and the scenario files list the same names.
try {
    await run(process.execPath, [worker]);
} catch (err) {
    console.log(`${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err);
    process.exit(1);
}

// Cancelling the runner takes the workers down; a killed worker closes its browser's pipe, so the browser exits too.
const children = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        for (const child of children) child.kill("SIGKILL");
        process.exit(1);
    });
}

// A topic per run and scenario: scenarios of this run, and of other runs, never see each other's games.
const runId = randomBytes(3).toString("hex");
let failed = 0;
const started = Date.now();
const queue = [...names];
await Promise.all(
    Array.from({ length: Math.min(jobs, names.length) }, async () => {
        for (let name; (name = queue.shift()); ) {
            const t0 = Date.now();
            // SIGKILL, not SIGTERM: Playwright's signal handler can leave a hung worker alive.
            const job = run(process.execPath, [worker, name], { env: { ...process.env, E2E_LOBBY: `${runId}-${name}` }, maxBuffer: 1 << 26, timeout: timeoutOf(name) * 1000, killSignal: "SIGKILL" });
            children.add(job.child);
            try {
                await job;
                console.log(`ok   ${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
            } catch (err) {
                failed++;
                console.log(`FAIL ${name}: ${err.killed ? `timed out after ${timeoutOf(name)} s` : `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err}`);
            }
            children.delete(job.child);
        }
    }),
);
console.log(`${names.length - failed}/${names.length} scenarios passed in ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(failed ? 1 : 0);
