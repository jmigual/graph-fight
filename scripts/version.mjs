// The version a build announces and shows (ADR 12, 28). The release build, which is the lobby's live
// opt-in (scripts/lobby-topic.mjs), is the newest CHANGELOG.md entry. Every other build, including a
// forgotten flag, is the next minor plus `-dev+<source hash>`, so a dev build never looks like a release.
import { LIVE_TOPIC, lobbyTopic } from "./lobby-topic.mjs";

/** "0.3.0" -> "0.4.0": the next release, since features bump the minor version in 0.x. */
export function nextMinor(version) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

/** `entries` come from `parseChangelog`; `hash` identifies the sources of a non-release build. */
export function buildVersion(entries, hash, env = process.env) {
  const current = entries[0].version;
  return lobbyTopic(env) === LIVE_TOPIC ? current : `${nextMinor(current)}-dev+${hash}`;
}
