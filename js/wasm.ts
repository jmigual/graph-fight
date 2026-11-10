// Loads the engine before any other module runs: it is the first import of index.ts, so every
// handler and the lobby connection go live only once the wasm is ready (ADR 30). Fetches
// `index_bg.wasm`, which sits next to the bundle in dist/.
import init from "../pkg/index.js";

await init();
