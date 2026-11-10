// Bundles js/index.ts into dist/ with esbuild (ADR 19). Needs pkg/ from `npm run build:wasm`.
// `--serve` watches the TypeScript and serves dist/ on :8080 instead of minifying.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";
import { lobbyTopic } from "./lobby-topic.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");

// Identifies the build so peers on different builds refuse to play together (ADR 12):
// the commit hash, or a hash of the sources (and Cargo.lock, which fixes the arenas) when the
// repository is unavailable.
function buildVersion() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    const hash = createHash("sha256");
    hash.update(readFileSync(resolve(root, "Cargo.lock")));
    for (const dir of ["js", "src", "static"]) {
      for (const f of readdirSync(resolve(root, dir), { recursive: true }).sort()) {
        const file = resolve(root, dir, f);
        if (statSync(file).isFile()) hash.update(readFileSync(file));
      }
    }
    return hash.digest("hex").slice(0, 7);
  }
}

const serve = process.argv.includes("--serve");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(resolve(root, "static"), dist, { recursive: true });
const copyWasm = () => cpSync(resolve(root, "pkg/index_bg.wasm"), resolve(dist, "index_bg.wasm"));
copyWasm();

const options = {
  entryPoints: [resolve(root, "js/index.ts")],
  outdir: dist,
  bundle: true,
  format: "esm",
  target: "es2022",
  define: { __BUILD_VERSION__: JSON.stringify(buildVersion()), __LOBBY_TOPIC__: JSON.stringify(lobbyTopic()) },
  minify: !serve,
  sourcemap: serve,
  logLevel: "info",
  // `npm run build:wasm` rewrites the glue, which triggers a rebuild; pick up the new wasm too.
  plugins: [{ name: "copy-wasm", setup: (b) => b.onEnd(copyWasm) }],
};

if (serve) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: dist, port: 8080 });
} else {
  await build(options);
}
