# 26. In-app help: a modal dialog with deep links

Status: Accepted (2026-11-10). Amends 0017 (the page has a header above the screens).

## Context

The coordinates are the hardest thing for a new player (ADR 17), and ADR 20 made them a host option:
map-centred, where the formula is offset to start at the shooter, or player-centred. The sliders,
templates and formula syntax (ADR 3, 17) have no explanation either. The user asked for a help that
explains how the map-centred shot is computed and how to use the sliders, reachable at any time.

## Decision

- **Button.** A `<header class="site-bar">` above `<main>` holds **Help** (`#help-open`), so it is on
  every screen, in a game too. It opens `<dialog id="help">` with `showModal()`: the page behind is
  inert, Escape closes it, focus returns to the button, and the game is not touched. The host's turn
  clock, the relay and the board go on, so a shot applied meanwhile shows when the help closes. Under
  600 px the dialog fills the screen. Colours are the ADR 17 tokens; nothing is added to `:root`.
- **Content.** Static HTML in that dialog (one block at the end of `static/index.html`), with no
  dependency, no Markdown renderer and no fetch. Sections, each with an id: `help-play` (turns, timer,
  teams, kills, obstacles, how a game ends, hosting and joining), `help-formulas` (variables,
  constants, functions, operators and precedence, products (implicit multiplication after a number, ADR 32), the 256 limit,
  undefined at the shooter), `help-coordinates` (ADR 20's maths for both frames, with an XY and a
  polar diagram, and the board's on-turn hints), `help-tools` (helper buttons, saved formulas,
  templates and sliders, the starters, the per-character memory of section 7 of ADR 17), `help-modes`
  (bots, local players, kick, private games: ADR 21 to 24), `help-arena` and `help-reconnect`.
  Sub-sections have ids too (`help-coords-xy`, `help-coords-polar`, `help-templates`, ...). The
  diagrams are inline SVG in `currentColor` and the tokens, each with its `<figcaption>` as the text
  alternative (`aria-labelledby`).
- **Deep links.** `js/help.ts` opens the dialog and scrolls to the element a `#help-…` fragment
  names, on load and on `hashchange`, and only when the element is inside the dialog, so the invite
  fragment of ADR 24 (`#join=…`) is left alone. Closing removes the fragment with
  `history.replaceState`, so the same link opens the help again.
- **Staying right.** The text states the engine's rules (`src/game/shot.rs`, `src/formula.rs`), so it
  can go stale. `tests/help.test.mjs` reads the Rust parser and `index.html` and requires the
  function list, the constants, the length limit and the starter templates in the help to equal
  the parser's and `js/starters.json`, and every `#help-…` link to have a target. It cannot check the prose of the
  coordinates section, which was written from `shot.rs` and ADR 20. e2e `Help` covers the button,
  a deep link, Escape, no horizontal scroll at 390 px, and opening the help mid-game.
- **Test arena.** `#help-arena` describes the arena of ADR 25: opening it, placing, dragging and selecting,
  the Position fields, obstacles, and firing from any player.

Rejected:
- A separate `help.html`: it leaves the game page, or needs a second tab; a dialog is one click away
  in either state.
- A Markdown file rendered in the page: a parser or renderer for text that changes with the code and
  is easier to keep next to the markup.
- The popover API: no modal semantics, so the game stays focusable behind it.

## Consequences

- A change to a rule the help states (a function, a limit, a starter, a frame) edits the help too.
- The help is part of `index.html`, so it ships with every build and works offline once loaded.
