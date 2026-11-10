// The demo video and poster keep one URL across re-recordings, and browsers cache media well past
// GitHub Pages' max-age (ADR 29). The built page names them with a hash of their content.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const VERSIONED_MEDIA = ["demo.webm", "demo-poster.jpg"];

/** The first 8 hex characters of the sha256 of `file` in `dir`. */
export const contentHash = (dir, file) => createHash("sha256").update(readFileSync(resolve(dir, file))).digest("hex").slice(0, 8);

/** `html` with each `./file` reference to the media in `dir` turned into `./file?v=<hash>`. */
export const versionMedia = (html, dir) =>
  VERSIONED_MEDIA.reduce((out, file) => out.replaceAll(`"./${file}"`, `"./${file}?v=${contentHash(dir, file)}"`), html);
