// What a build announces and what it shows (ADR 12, 28). A release build is the one with the live
// lobby opt-in (scripts/lobby-topic.mjs); every other build, including a forgotten flag, is a dev build.
import { LIVE_TOPIC, lobbyTopic } from "./lobby-topic.mjs";

const isRelease = (env) => lobbyTopic(env) === LIVE_TOPIC;

/** "0.3.0" -> "0.4.0": the next release, since features bump the minor version in 0.x. */
export function nextMinor(version) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

/**
 * The exact id peers compare for compatibility (`__BUILD_ID__`): `<top CHANGELOG version>+<hash>` for a
 * release, `<next minor>-dev+<hash>` otherwise. The hash keeps two deploys of one release apart.
 * `entries` come from `parseChangelog`; `hash` identifies the sources.
 */
export function buildId(entries, hash, env = process.env) {
  const current = entries[0].version;
  return isRelease(env) ? `${current}+${hash}` : `${nextMinor(current)}-dev+${hash}`;
}

/** What the footer shows (`__BUILD_VERSION__`): the plain release version, or the whole dev id. */
export function buildVersion(entries, hash, env = process.env) {
  return isRelease(env) ? entries[0].version : buildId(entries, hash, env);
}
