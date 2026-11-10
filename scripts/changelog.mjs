// CHANGELOG.md is the one source of release versions and their notes (ADR 28). Its fixed format:
// a `# ` title, then `## <major>.<minor>.<patch> — <yyyy-mm-dd>` headings, each followed by `- ` bullets,
// newest first. Anything else is an error, so a malformed release PR fails the build.
const HEADING = /^## (\d+)\.(\d+)\.(\d+) — (\d{4}-\d{2}-\d{2})$/;

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Parses CHANGELOG.md into `[{ version, date, notes }]`, newest first. */
export function parseChangelog(text) {
  const entries = [];
  for (const [i, line] of text.split("\n").entries()) {
    const fail = (why) => { throw new Error(`CHANGELOG.md line ${i + 1}: ${why}`); };
    const heading = HEADING.exec(line);
    if (heading) {
      const parts = heading.slice(1, 4).map(Number);
      if (entries.length && compare(entries.at(-1).parts, parts) <= 0) fail("versions must be strictly descending");
      entries.push({ version: parts.join("."), parts, date: heading[4], notes: [] });
    } else if (line.startsWith("- ") && line.length > 2) {
      if (!entries.length) fail("a bullet before the first version heading");
      entries.at(-1).notes.push(line.slice(2));
    } else if (line.startsWith("# ") ? i !== 0 : line.trim() !== "") {
      fail("expected `## x.y.z — yyyy-mm-dd`, a `- ` bullet or a blank line");
    }
  }
  if (!entries.length) throw new Error("CHANGELOG.md has no versions");
  const empty = entries.find((e) => !e.notes.length);
  if (empty) throw new Error(`CHANGELOG.md: ${empty.version} has no notes`);
  return entries.map(({ version, date, notes }) => ({ version, date, notes }));
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// `code` spans are the only inline markup the notes use.
const inline = (s) => escape(s).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The changelog page, styled by style.css (ADR 17 tokens); links back to the game. */
export function changelogHtml(entries) {
  const sections = entries
    .map((e) => `      <section aria-labelledby="v${e.version}">
        <h2 id="v${e.version}">${e.version} <time datetime="${e.date}">${e.date}</time></h2>
        <ul>
${e.notes.map((n) => `          <li>${inline(n)}</li>`).join("\n")}
        </ul>
      </section>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en-US">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Changelog - Graph fight!</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700&amp;family=STIX+Two+Text:ital,wght@0,400;0,600;1,400&amp;display=swap">
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <main class="changelog">
      <p><a href="./">Back to the game</a></p>
      <h1>Changelog</h1>
${sections}
    </main>
  </body>
</html>
`;
}
