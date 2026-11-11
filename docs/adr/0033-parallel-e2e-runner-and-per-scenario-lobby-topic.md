# 33. Parallel e2e runner and per-scenario lobby topic

Status: Accepted (2026-11-10). Amends 0030 (the e2e runner) and 0012 (the lobby topic).

## Context

`npm run e2e` ran the 43 scenarios one after another in one browser: 218 s, nearly all of it
waiting for relays, WebRTC and real turn clocks, so the machine was idle. The slowest scenarios
(G 27 s, AC 25 s, Q 20 s) set a floor of about 28 s. Running them side by side needs two things:
scenarios must not see each other's lobby listings (all dev builds shared `graph-fight:lobby:dev`),
and one scenario's cleanup must not close another's pages.

Game rooms are already apart: `game-<hostId>` with a random host id, and the Nostr signalling of a
room is keyed by it. The stored seat is per browser context. Only the lobby topic was shared.

## Decision

- **Topic suffix.** `js/net.ts` reads `globalThis.__lobbySuffix`; when it is a non-empty string and
  the build's topic ends in `:dev`, the lobby topic is `graph-fight:lobby:dev:<suffix>`. The live
  build (`graph-fight:lobby`) never takes it. `LOBBY_TOPIC` is exported for the test. Alternatives:
  a query parameter is lost by invite links (`<origin><path>#join=...` has no query) and by
  `about:blank` hops, so link guests would land on the plain dev topic; a `localStorage` key is
  per context, readable by a script on the live site, and blocked by the `blockStorage` scenario;
  a build define needs one build per scenario. A window global set by Playwright's `addInitScript`
  covers every navigation of every page of a context, and nothing in a live user's browser sets it.
  `tests/build.test.mjs` bundles `net.ts` with a dev and a live define and checks the topic with and
  without a suffix, including a non-string and an empty one; a real `GRAPH_FIGHT_LOBBY=live` build
  was also loaded in a browser with the suffix set and subscribed to `graph-fight:lobby` only. The
  guard is checked when the page runs; esbuild does not fold it out of the live bundle.
- **One process and browser per scenario.** `tests/e2e-worker.mjs NAME` runs one scenario in a fresh
  browser and static server (what `helpers.mjs` already starts on import) and exits 1 with the
  failure on stdout, or 0 silently. A crashed browser can only fail its own scenario, and the old
  "close every context after each scenario" step stays correct. One browser with many contexts would
  have needed per-scenario bookkeeping to close the right ones. The cost is about 1.4 s of start-up
  per scenario, which the pool hides. A hung scenario is killed after 180 s with SIGKILL (not
  SIGTERM: Playwright's handler can close the browser and leave the worker alive) and reported as
  `FAIL NAME: timed out after 180 s`; the killed worker's pipe to its browser closes, so the browser
  exits with it. `LONGER_S` in `tests/e2e.mjs` gives a scenario more than 180 s: S, a game against a bot,
  has a random length and took 147 s in a parallel run, so it gets 300 s. The runner also kills its workers on SIGINT and SIGTERM.
- **Topic per run and scenario.** `tests/e2e.mjs` gives each worker `E2E_LOBBY=<runId>-<name>`
  (random run id, so two runs on the same relays do not meet either), and `helpers.mjs` wraps
  `browser.newContext` so every context, in `startGame` or opened directly by a scenario, installs
  `window.__lobbySuffix` from it.
- **Pool.** `tests/e2e.mjs` runs `E2E_JOBS` workers at once (default 4; `E2E_JOBS=1` is sequential;
  anything but a positive integer exits 1). It prints one `ok NAME (n s)` or `FAIL NAME: <stack>`
  line per scenario as it finishes and the `N/M scenarios passed in S s` line, and exits 1 if any
  failed. Scenario names select and order the run as before (a repeated name runs once, so two
  workers never share a topic), and an unknown name exits 1 before anything starts.
- **`ORDER`** moved to `tests/e2e/order.mjs` and is sorted slowest first, so the pool starts G, AC
  and Q at once and short scenarios fill the gaps. Before any scenario starts, the runner
  runs a worker without a scenario name, which asserts that `ORDER` and the scenario files list the
  same names, so a new scenario goes into both and, if long, near the front.

Measured on a 32-core machine: sequential in one browser 218 s; the new runner with 4 jobs 67 to 72 s
(3 runs), with 8 jobs 36 to 37 s (3 runs) and 76 s in a fourth, when scenario S, a bot game of random
length, took 63 s instead of 5 to 16 s; with 1 job 282 s. No run failed.

## Consequences

- A full run takes about a third of the time at 4 jobs; the floor is the longest scenario, so 8 jobs
  roughly halves it again, at a load average of about 7. The default stays 4 to leave a shared
  machine and the public relays some room.
- Run sequentially, the suite is about 60 s slower than before from process start-up.
- Scenario S plays a Hard bot to the end of a random game and varies from 5 to 60 s; it is the
  tail of a parallel run.
- A scenario that needs two scenarios' pages in one lobby cannot exist; each scenario's pages share
  only their own topic.
- Failure output of a scenario is printed in one block when it ends, not as it happens.
- The ADR 12 lobby code gains one read of a window global, ignored in the live build.
