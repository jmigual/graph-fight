// Release checks run in CI (ADR 31): a release needs its own CHANGELOG entry, and its tag
// `v<version>` sits on the deployed commit. The rules are pure; the CLI feeds them from git.
//   node scripts/release-check.mjs free [sha]   the top version is not tagged on another commit
//   node scripts/release-check.mjs tag <tag>    the tag is the top version at its commit, on master
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "./changelog.mjs";

/** A broken release rule; `code` says which: `tag-taken`, `no-tags`, `tag-version` or `not-on-master`. */
export class ReleaseCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Fails if tag `v<version>` is in `tags` (tag name to commit sha) on a commit other than `headSha`. */
export function checkTagFree(version, tags, headSha) {
  const at = tags[`v${version}`];
  if (at !== undefined && at !== headSha) {
    throw new ReleaseCheckError("tag-taken", `v${version} is already tagged at ${at}, not at ${headSha}: add a CHANGELOG entry with a new version`);
  }
}

/** Fails unless `tag` is `v` plus the top version of `changelogText`. */
export function checkTagVersion(tag, changelogText) {
  const top = parseChangelog(changelogText)[0].version;
  if (tag !== `v${top}`) {
    throw new ReleaseCheckError("tag-version", `${tag} does not match the top CHANGELOG entry v${top}`);
  }
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// `%(*objectname)` is the commit an annotated tag points at, empty for a lightweight tag.
const localTags = () => {
  const tags = {};
  for (const line of git("for-each-ref", "--format=%(refname:strip=2) %(*objectname) %(objectname)", "refs/tags").split("\n")) {
    const [name, peeled, own] = line.split(" ");
    if (name) tags[name] = own === undefined ? peeled : peeled || own;
  }
  return tags;
};

function main([command, arg]) {
  if (command === "free") {
    const tags = localTags();
    // An empty list means the checkout did not fetch tags, which would make the check pass for nothing.
    if (!Object.keys(tags).length) throw new ReleaseCheckError("no-tags", "no tags in the checkout: fetch them (fetch-depth: 0)");
    const version = parseChangelog(readFileSync("CHANGELOG.md", "utf8"))[0].version;
    checkTagFree(version, tags, arg ?? git("rev-parse", "HEAD"));
  } else if (command === "tag" && arg) {
    checkTagVersion(arg, git("show", `${arg}^{commit}:CHANGELOG.md`));
    try {
      git("merge-base", "--is-ancestor", `${arg}^{commit}`, "refs/remotes/origin/master");
    } catch {
      throw new ReleaseCheckError("not-on-master", `${arg} is not on master`);
    }
  } else {
    throw new Error("usage: release-check.mjs free [sha] | tag <tag>");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
