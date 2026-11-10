// Run: node --experimental-strip-types --no-warnings tests/changelog.test.mjs
// CHANGELOG.md has a fixed format that the build turns into dist/changelog.html (ADR 28).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ChangelogError, changelogHtml, parseChangelog } from "../scripts/changelog.mjs";

const sample = `# Changelog

## 0.10.1 — 2026-12-01
- A fix.

## 0.3.0 — 2026-11-10
- One feature with \`code\`.
- Another <b>feature</b>.
`;
assert.deepEqual(parseChangelog(sample), [
    { version: "0.10.1", date: "2026-12-01", notes: ["A fix."] },
    { version: "0.3.0", date: "2026-11-10", notes: ["One feature with `code`.", "Another <b>feature</b>."] },
]);

// Malformed input fails the build instead of publishing a half-read page.
for (const [why, text] of [
    ["empty", "# Changelog\n"],
    ["a bullet before any heading", "- x\n## 0.1.0 — 2026-11-10\n- y\n"],
    ["a heading without notes", "## 0.2.0 — 2026-11-10\n- y\n## 0.1.0 — 2026-11-10\n"],
    ["a hyphen instead of the dash", "## 0.1.0 - 2026-11-10\n- y\n"],
    ["a prerelease version", "## 0.1.0-rc1 — 2026-11-10\n- y\n"],
    ["stray prose", "## 0.1.0 — 2026-11-10\n- y\nsome text\n"],
    ["ascending order", "## 0.1.0 — 2026-11-10\n- y\n## 0.2.0 — 2026-11-10\n- z\n"],
    ["a repeated version", "## 0.1.0 — 2026-11-10\n- y\n## 0.1.0 — 2026-11-10\n- z\n"],
    ["a title below the top", "## 0.1.0 — 2026-11-10\n- y\n# Changelog\n"],
    ["a whitespace-only note", "## 0.1.0 — 2026-11-10\n-  \n"],
    ["a leading zero in a version", "## 0.01.0 — 2026-11-10\n- y\n"],
    ["month 13", "## 0.1.0 — 2026-13-10\n- y\n"],
    ["month 00", "## 0.1.0 — 2026-00-10\n- y\n"],
    ["February 30", "## 0.1.0 — 2026-02-30\n- y\n"],
    ["February 29 in a common year", "## 0.1.0 — 2026-02-29\n- y\n"],
]) assert.throws(() => parseChangelog(text), ChangelogError, why);
assert.equal(parseChangelog("## 0.1.0 — 2028-02-29\n- leap day\n")[0].date, "2028-02-29");

// A Windows checkout (CRLF) and an editor's BOM read like the plain file.
assert.deepEqual(parseChangelog(`\uFEFF${sample.replace(/\n/g, "\r\n")}`), parseChangelog(sample));

// 0.10.0 is newer than 0.9.0 (numeric, not text, order).
assert.equal(parseChangelog("## 0.10.0 — 2026-11-10\n- a\n## 0.9.0 — 2026-11-09\n- b\n").length, 2);

const html = changelogHtml(parseChangelog(sample));
assert.ok(html.indexOf("0.10.1") < html.indexOf("0.3.0"), "newest first");
assert.ok(html.includes("<code>code</code>"));
assert.ok(html.includes("&lt;b&gt;feature&lt;/b&gt;") && !html.includes("<b>"), "notes are escaped");
assert.ok(html.includes('<a href="./">Back to the game</a>'));

// The real file follows the format and still lists the releases so far.
const real = parseChangelog(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
for (const v of ["0.1.0", "0.2.0", "0.3.0"]) assert.ok(real.some((e) => e.version === v), `${v} is listed`);
console.log("changelog tests passed");
