# 17. UI and UX design: graph paper, formula editor, saved formulas and templates

Status: Proposed (2026-11-09)

## Context

The client (ADR 15) is deliberately plain: unstyled HTML on a grey page, a fixed 800 px canvas,
team colour carried only by text colour, one global `#error` line. Screenshots of the current
build show:

- There is no `<meta name="viewport">`, so phones lay the page out at 980 px and the 800 px
  canvas scrolls horizontally.
- Team identity is colour only (red/blue/green/...), which fails for red-green colour-blind
  players and in a dark theme.
- The board gives no sense of scale or of the shot's coordinate frame. Shots are relative to
  the shooter (ADR 4, 5), and on XY they are mirrored for a shooter on the right. Neither is
  visible, and that is the hardest thing for a new player to learn.
- Typing `θ`, `^` or `(` on a phone keyboard takes several taps.

The user asked for a UI/UX pass, helper buttons for building formulas, saved formulas, and saved
formulas with values chosen on Desmos-like sliders (min, max, optional step) that insert the
formula with the values filled in.

Audience: friends who like maths, and students. Primary job: get from "I see where the enemy
is" to "I typed the curve that reaches it" within 60 seconds. The game is inspired by Graphwar,
and its look must not copy Graphwar.

Naming: "parametric" already names the `x(t), y(t)` / `r(t), θ(t)` shot mode. A saved formula
with sliders is a **template** everywhere in the UI and the code. The letters inside a template
are **sliders** in the UI copy ("Letters like a or b become sliders"); the word "parameter" is not
shown to users, so it never sits next to "Parametric". In code they are `sliders`.

## Decision

### 1. Direction: the graph paper follows the shooter

The game's subject is the maths classroom. Light theme is a **green engineering pad**; dark theme
is a **chalkboard**. Both are green-family, so the two themes read as one product.

The one memorable thing is the board. The graph paper is drawn **in the current shooter's
coordinate frame**: its axes pass through the shooter, the positive `x` (or `θ = 0`) arrow points
the way the formula will go, and grid lines are one world unit apart. Every turn the paper moves
to the next shooter. The paper only makes the formula's frame and scale visible. It shows nothing
about where a particular formula will land (see 9). The rest of the UI stays quiet: plain form
controls, one text face and one maths face, no cards, no shadows, no gradients.

The pen stroke is the one motion. The title's curve draws itself once on load, and each shot's
trajectory is drawn like a pen plotter after the engine has already decided the outcome.

### 2. Palette tokens

CSS custom properties on `:root`, switched by `@media (prefers-color-scheme: dark)`.
`color-scheme: light dark` is set so native controls (range, number, select, checkbox) follow the
theme, and `accent-color: var(--mark)` styles them without custom widget CSS. The canvas reads the
same tokens with `getComputedStyle`, so CSS is the only place colours are defined. It redraws when
the scheme changes (`matchMedia(...).onchange`).

| Token | Light (pad) | Dark (board) | Use | Contrast on paper (light / dark) |
|---|---|---|---|---|
| `--paper` | `#EEF4EF` | `#22332D` | page and board background | |
| `--ink` | `#14302A` | `#E6EFEA` | text, primary button fill, board edge | 12.7 / 11.3 |
| `--ink-soft` | `#4B655D` | `#A9BDB5` | secondary text, borders of secondary controls | 5.7 / 6.7 |
| `--grid` | `#CFE0D5` | `#30463F` | minor grid (1 unit) | decorative |
| `--grid-major` | `#A3C2AE` | `#45625A` | major grid (5 units) | decorative |
| `--obstacle` | `#3A4743` | `#7D918A` | obstacles (graphite / chalk) | 8.7 / 4.0 |
| `--mark` | `#2347B5` | `#F5D547` | focus ring, `accent-color` (pen blue / chalk yellow) | 7.1 / 9.2 |
| `--danger` | `#B42318` | `#FF8C7A` | error text, timer under 10 s | 5.9 / 5.9 |

**Team colours** `--team-1` .. `--team-8`. They are the Okabe-Ito hues, darkened for the pad and
lightened for the board. Teams 1 and 2 are vermilion and blue, the pair that stays distinct
under every common colour-vision deficiency, and the XY field only ever uses those two.

| Team | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Light | `#C2410C` | `#0B63B0` | `#00775A` | `#A63D8A` | `#806200` | `#8B4A1C` | `#6B46C1` | `#4F6F00` |
| Dark | `#FF9A5C` | `#6CB6F2` | `#3FD0A0` | `#F08BD0` | `#EBCB45` | `#E0A577` | `#B9A2F5` | `#B5D35E` |

All 16 values are at least 4.6:1 on their paper, and the team numeral drawn in `--paper` on top
of them is just as legible. Colour is never the only cue. Every team-coloured mark comes with the
team **number**: on the player discs, in the roster, and in the status line ("Team 3").

### 3. Typography

Loaded from Google Fonts with `display=swap` (one `<link>` plus `preconnect`):

- **Atkinson Hyperlegible Next** (400, 700) for all UI text. It was designed for low-vision
  readers and has unambiguous `l/1/I` and `0/O`, which matters when people read each other's
  formulas. Fallback `system-ui, sans-serif`.
- **STIX Two Text** (400, 400 italic, 600) as the maths voice: the title, every formula (inputs,
  saved list, canvas labels, mode labels), and the end-of-game headline. It is the face of
  scientific publishing and has proper Greek glyphs for `θ` and `π`. Fallback `"Cambria Math",
  "Times New Roman", serif`.

Scale is a major third (1.25) on a 16 px base: 0.8, 1, 1.25, 1.563, 1.953, 3.052 rem. Body text
uses line-height 1.5 and is capped at 65ch. Formula inputs are 1.25 rem STIX upright. The title is
3.052 rem STIX italic, set like a function name. Headings are Atkinson 700 in sentence case.
There are no all-caps labels and no eyebrows. Numbers that change (timer, players) use
`font-variant-numeric: tabular-nums`. Canvas text waits for `document.fonts.ready` and the board
redraws once fonts are in.

### 4. Board (canvas)

Layering, back to front:

1. **Paper** in `--paper`, clipped to the disc on the disc field.
2. **Grid in the current shooter's frame.** On XY there are lines every 1 unit (`--grid`) and
   every 5 units (`--grid-major`), offset so that lines pass through the shooter. Two axes through
   the shooter are drawn in `--ink-soft` at 1.5 px, with an arrowhead on `+x` pointing the way
   shots go (toward the centre, so mirrored for a right-hand shooter), an arrowhead on `+y`, and
   the numbers 5, 10, 15 along the `+x` axis in 0.8 rem Atkinson. On the disc the paper is polar
   and centred on the shooter: circles every 1 unit (major every 5), rays every 30° (`π/6`). The
   `θ = 0` ray toward the disc centre is an axis with an arrowhead and the label `θ = 0`, plus a
   short counter-clockwise arc arrow near the shooter that shows the direction θ grows. When there
   is no current shooter (game over), the grid is drawn in the world frame from the centre.
3. **Obstacles** filled with `--obstacle` ("pencil shading").
4. **Craters** are "erased". Each crater is clipped and layers 1 and 2 are repainted inside it, so
   the grid shows through the hole.
5. **Board edge**: 2 px `--ink` rectangle or circle.
6. **Last trajectory**: 2.5 px stroke in the shooter's team colour with round caps and joins. Its
   formula is written beside the end point in STIX italic, 14 px, in the team colour, with a 4 px
   `--paper` halo (`strokeText` before `fillText`). The label is truncated to 32 characters plus an
   ellipsis and clamped inside the canvas. Peer formulas only reach the canvas through
   `fillText`/`strokeText`, which render text only.
7. **Players** at their true hit radius (no enlarging, so what you see is what can be hit).
   - Alive: a team-colour disc with a 1.5 px `--paper` outline that separates it from adjacent
     obstacles (team colours are only ~1.5:1 against `--obstacle`), and the team number in
     `--paper`, Atkinson 700, when the drawn radius is at least 8 px.
   - Current shooter: also a 2 px `--ink` ring 3 px outside, and it is the origin of the grid.
   - Disconnected (reconnection work): hollow, a 2 px team-colour stroke with no fill and a
     dashed ring.
   - Dead: a team-colour cross at 60 % alpha (as today).

Responsive sizing: the backing size stays the ADR 15 constant (800 x 400, 600 x 600). CSS sets
`max-width: 100%; height: auto`, and on desktop `max-height: calc(100dvh - 7rem); width: auto` so
the disc fits in the viewport. Optional: size the backing store to `clientWidth * devicePixelRatio`
for sharp lines and labels on HiDPI screens. That changes the ADR 15 constant, so it is listed
separately in the plan.

### 5. Motion

- **Trajectory draw.** When a shot is applied, the engine has already moved to the new state
  (`fire` returned the points and `__state` already reflects the outcome). The renderer draws the
  arena as it was before the shot (`index.ts` keeps `sim.arena()` from just before applying) with
  a growing prefix of the points, at constant pen speed: 700 ms, plus up to 700 ms more for long
  paths, using `requestAnimationFrame`. On the last frame it switches to the new arena, so kills
  and the new crater appear when the pen lands. A newer draw (next message, theme change) cancels
  the running animation and draws the final frame. The animation is display only and gates
  nothing: inputs stay live and the next turn's clock is already running.
- **Title curve.** In the lobby header, an inline SVG path runs from a team-1 dot to a team-2 dot
  and draws once on load with `stroke-dashoffset`, 900 ms.
- **Nothing else moves.** No hover transitions, no entrance animations, no pulsing current player.
- `prefers-reduced-motion: reduce` turns off both animations. The CSS media query covers the
  title, and `matchMedia` in `render`'s caller draws the final frame directly.

### 6. Layout per screen

Gutter 16 px on phones and 24 px from 600 px up. Content is left-aligned. One breakpoint at 960 px.
No horizontal scroll at 320 px or wider. Untrusted strings (game names, formulas) get
`overflow-wrap: anywhere`.

**Lobby.** Open games come first because joining a friend's game is the common case. The list
stays a `<table>` (it is tabular). An empty list says: "No open games yet. Host one, then ask
a friend to open this page." Field names shown to users: "XY plane" and "Polar disc"; the option
values stay `xy`/`disc`. Players are shown as "2 of 4". A full game's button reads "Full"
(disabled). A game on another build has no button and reads "Different version. Reload the page."
Host form: "Game name", "Field" (select: "XY plane, 2 players" / "Polar disc, 2 to 8 players"),
"Seats" (shown only for the disc), and a "Host game" button.

```
desktop                                                 phone (390)
+-----------------------------------------------------+ +---------------------+
| Graph fight!  (draws: o~~~~~~~~~~~~~~~~~~~~o)        | | Graph fight!        |
| Aim with a formula. Your shot follows the curve.     | | o~~~~~~~~~~~~~o     |
|                                                     | | Aim with a ...      |
| Open games                    | Host a game          | | Open games          |
| Game     Field       Players  | Game name [______]   | | Game  Field  Pl.    |
| friday   Polar disc  2 of 4 [Join] Field [XY plane v] | | friday Disc 2/4 Join|
| quiz     XY plane    2 of 2 [Full] Seats [4] (disc)  | | Host a game         |
| old      Different version. Reload.  [Host game]     | | [stacked form]      |
+-----------------------------------------------------+ +---------------------+
```

On phone the table keeps four columns; the field column uses the short words "XY" and "Disc"
below 480 px.

**Waiting room.** The heading is the game name. Below it: "Polar disc, 4 seats", then the player
list (`#room-players`, one `li` per connected player, tagged "you" / "host"). Open seats are a
text line ("2 seats open"), never extra `li`. The host sees **Start** (primary, disabled below 2
players, with "Start needs at least 2 players" next to it) and, when players outnumber seats,
"More players than seats: the first 4 to join play." A guest sees "Waiting for the host to
start." Both see **Leave**. Room errors (`Could not start`) go to `#room-error` in this section.

**Game.** Desktop is a two-column grid, `minmax(0, 1fr) 24rem`. Left: status bar, board, then
the last-shot line. Right: formula editor, roster, saved formulas. On phone it is one column:
status bar (sticky top), board, editor, roster, saved formulas.

```
+-----------------------------------------------+------------------------+
| [1] Your turn                42 s [Leave game]| (o) y = f(x) ( ) x(t),y(t)
| ====================------ timer bar          | y = [2*sin(x)        ] |
| +-------------------------------------------+ | x π e ( ) ^ √ sin cos  |
| |  graph paper centred on the shooter       | | tan abs exp ln  More   |
| |  +x -->   obstacles   [2] [2]             | | Formula error ...      |
| +-------------------------------------------+ | [Save]          [Fire] |
| Team 2 fired y = x/2. Team 1 lost a player.   | Teams                  |
|                                               | [1] Team 1, you   ●●○  |
|                                               | [2] Team 2        ●●●  |
|                                               | Saved formulas         |
+-----------------------------------------------+------------------------+
```

The status bar holds a numbered team swatch, then `#turn` ("Your turn" or "Team 2 is aiming"),
then `#countdown` ("42 s"), then **Leave game** (reconnection work). Under it a 4 px bar drains
in the current team's colour (width from the same 250 ms tick). From 10 s down the number turns
`--danger` and bold. The last-shot line (`#last-shot`, `aria-live="polite"`) is the text
alternative for the canvas: "Team 2 fired y = x/2. Team 1 lost a player." It is computed from the
alive flags before and after the shot.

The editor stays usable on other players' turns: only Fire is disabled. Aiming while you wait is
part of the game. On a pointer-fine device the formula input gets focus when your turn starts.
On touch it does not, because the keyboard would cover the board.

**End.** `#end` moves above `#game` in the DOM and spans the grid. The board stays visible below
it (ADR 15). The headline is STIX 1.953 rem, with one explanatory line and **Back to lobby**.
Focus moves to the headline (`tabindex="-1"`). Without a game (Game full, version mismatch
before start), it stands alone.

### 7. Formula editor

- **Mode switch.** Two native radios styled as a segmented pair; the radios stay visible and get
  `accent-color`. Labels are the notation in STIX: `y = f(x)` / `x(t), y(t)` on XY, `r = f(θ)` /
  `r(t), θ(t)` on the disc. The accessible names are "Function" and "Parametric". Ids are unchanged.
- **Inputs** `#input-a`/`#input-b` with the labels from `LABELS` ("y =", "x(t) =", ...), plus
  `maxlength="256"` (the parser cap; `θ` is one UTF-16 unit), `spellcheck="false"`,
  `autocapitalize="off"`, `autocorrect="off"`, `enterkeyhint="send"`, `aria-describedby="error"`.
  Enter fires (the form submits).
- **Helper buttons**, `role="group"` with the label "Insert", placed between the inputs and the
  Save/Fire row:
  - Always visible: the mode variable (`x` on XY function, `θ` on disc function, `t` in either
    parametric mode, relabelled by `setMode`), `π`, `e`, `( )`, `^`, `√`, `sin`, `cos`, `tan`,
    `abs`, `exp`, `ln`.
  - In a `<details>` "More": `asin acos atan sinh cosh tanh log10 floor ceil`.
  - Inserted text is what the parser accepts: `π` inserts `pi` (the parser rejects the `π`
    character), `θ` inserts `θ`, `√` inserts `sqrt()`.
  - Target: the last focused of `#input-a`/`#input-b` (default `#input-a`).
  - Behaviour, using the native `setRangeText`. Functions, `√` and `( )`: with a selection, wrap
    it (`sin(` + selection + `)`, caret after `)`). Without one, insert `sin()` with the caret
    between the parentheses. Everything else inserts at the caret, replacing any selection.
  - The buttons call `preventDefault()` on `pointerdown` so the input keeps focus and selection
    (on phones the keyboard does not flicker). After inserting, the input is focused and an
    `input` event is dispatched.
  - Size: at least 44 x 44 px under `(pointer: coarse)` and 36 px high otherwise. Labels in STIX.
- **Errors.** `#error` moves into the editor under the inputs. It is cleared when either input is
  edited. When it has text, the inputs get `aria-invalid="true"`. Messages are the parser's own
  ("Unknown name 'y'"), plus one client message: if the text contains slider letters (section 8),
  "a and b are slider letters. Insert the formula from its template, or type numbers." This
  replaces the parser's "Unknown name 'a'" with a fix. A single ASCII letter other than `x`, `t`,
  `e` is never valid, so this check cannot reject a valid formula. Send errors also go to `#error`.

### 8. Saved formulas and templates

One list, "Saved formulas", below the editor. Any saved formula that contains slider letters is a
**template** and shows sliders. There is no separate store or screen.

**Saving.** **Save** (secondary, next to Fire) opens an inline row under the editor: "Name"
input prefilled with the formula text (cut to 64 characters), plus **Save formula** and
**Cancel** (Escape cancels). Saving stores the current field, mode and input text(s) and does not
validate the formula, so unfinished work can be saved; Fire validates. Slider letters are
detected when saving. A letter right after a digit or `.` (`2a`) blocks the save with "Put * between a
number and a slider: 2*a." Without that check, substitution would silently turn `2a` with
`a = 1.5` into `21.5`.

**Slider letters** are identifier tokens that are one ASCII letter, optionally followed by digits
(`a`, `b`, `k2`), except `x`, `t`, `e`. The tokenizer mirrors the parser: an identifier is a
letter (`\p{L}`) followed by letters or digits (`\p{L}\p{N}`), so `atan`, `pi`, `theta`, `θ`,
`sinh` are single tokens and never contain a slider. The parser rejects every single ASCII letter
except `x`, `t`, `e` in every mode, so slider letters cannot clash with a variable, a constant
(`pi`, `e`) or a function name. `x` and `t` are reserved in all modes, so a template cannot
capture the variable of another mode. One letter matches Desmos and catches typos: `amp` is not
a slider, and Fire reports "Unknown name 'amp'". In a parametric template both formulas share
their sliders.

**Slider row** per letter, in order of first appearance, laid out like Desmos:

```
a = [ 1.5 ]                      value: number input, exact entry
[-10] ----------o---------- [10]  min, native <input type=range>, max
step [     ]                     optional; empty = continuous
```

- Labels: the letter in STIX italic is the range's label. The number inputs are labelled
  "Lowest a", "Highest a", "Step of a" (visually just the field, with `aria-label`).
- Defaults for a new letter: min -10, max 10, value 1, step empty.
- Empty step gives `step="any"`. The value is shown and inserted with
  `clamp(ceil(-log10((max - min) / 1000)), 0, 6)` decimals (2 for the default span). A step
  gives `step=<step>`; the range snaps natively and values use the step's decimals.
- Typing a value outside the limits widens the limits to include it (Desmos does the same).
  `min >= max` or `step <= 0` marks that field invalid (`setCustomValidity`) and keeps the old
  limits. Limits are clamped to |v| <= 1e6, so `toFixed` never produces exponent notation.
- Keyboard is native: arrows, Page Up/Down, Home/End.
- Live: on `input`, the value field and a preview line under the template update. The preview
  (`→ 1.5*sin(0.5*x)`, STIX, `--ink-soft`) shows the exact text that will be inserted. This is
  the live feedback; there is no curve preview (section 9).

**Insert.** Substitution replaces each slider token with its value as a numeric literal: no
exponent, trailing zeros removed, `-0` becomes `0`, and negatives in parentheses (`x^a` with
`a = -2` gives `x^(-2)`, `-a` gives `-(-2)`). Insert switches the mode radio to the item's mode,
replaces the input text(s), clears `#error`, and focuses `#input-a` at the end. If the result is
over 256 characters, nothing is inserted and the template shows "Too long with these values
(270 of 256 characters)." The editor then holds an ordinary formula. Only that text is checked
(`check`/`check_param`) and sent, so the wire protocol and the parser do not change. A plain saved
formula (no sliders) has the same **Insert**.

**List.** Only items for the current field are shown, grouped by mode, newest first. Each row has
the name (Atkinson), the formula (STIX, `overflow-wrap: anywhere`), **Insert**, and a delete
button with `aria-label="Delete <name>"`. Delete asks `confirm("Delete “<name>”?")` because it is
the only destructive action. Names and formulas go in with `textContent` only. The empty state
says: "Save a formula to reuse it. Letters like a or b become sliders, for example a*sin(b*x)."

**Storage.** `localStorage["graph-fight.formulas"]` =
`{ v: 1, items: [{ name, field, mode, exprs, sliders: { [letter]: { min, max, step, value } } }] }`.
Every read and write is in `try/catch`. On read, the shape is validated and invalid items are
dropped (name ≤ 64, each expr ≤ 256, `field` in `xy|disc`, `mode` in `explicit|parametric`,
1 or 2 exprs to match the mode, finite numbers). If storage is unavailable or full, the list keeps
working in memory and shows "Can't save in this browser; saved formulas last until you close the
tab." Slider limits and values are saved on `change` (not on every `input`).

### 9. No curve preview before firing

Decision: **no** preview of the trajectory or of the curve's shape.

- A preview drawn on the board, anchored at the shooter, turns the game into trial and error
  within 60 s and removes the skill of turning a picture into a formula. A preview that also
  showed hits would remove it completely.
- An unanchored "shape sketch" (auto-scaled thumbnail) still lets players iterate on magnitudes
  by eye. It also needs a second evaluator in JS or a new WASM export.
- What the design gives instead is the frame and the scale, which are what a player needs to do
  the maths: graph paper in the shooter's frame with unit spacing and numbered axes (section 4),
  the template's substituted text as live feedback, and the drawn trajectory and its label after
  each shot for learning.
- A determined player can always compute outcomes (the seed is shared and `Game.clone` exists),
  so this is a game-design choice, not a security measure. A practice mode with a full preview
  could be a later, separate feature.

### 10. Turn, roster and player states

**Roster** (`#roster`, an `ol` in team order). Each entry has: numbered team swatch, "Team 2",
short id, then "you" when it is ours; pips for players left (filled/hollow, with the accessible
text "2 of 3 players left"); and a state word:

| State | Roster | Board | Status bar |
|---|---|---|---|
| Current, ours | "aiming", bold | ring + grid origin | "Your turn", swatch, timer |
| Current, other | "aiming" | ring + grid origin | "Team 2 is aiming" |
| Waiting | nothing | discs | |
| Disconnected (reconnection work) | "disconnected", `--ink-soft` | hollow dashed discs | when current: "Team 2 is disconnected. Turn ends in 42 s." |
| Eliminated | strikethrough + "out" | crosses | ours: editor replaced by "Your team is out. Watch the rest or leave." |
| We lost the host link (reconnection) | | board frozen | "Reconnecting to the host…" in `--ink-soft`, Fire disabled |

Optional: `document.title` becomes "Your turn — Graph fight!" while it is our turn, so a player
in another tab notices.

**Reconnection hooks** (designed here; behaviour comes from the parallel reconnection ADR, assumed
to be 0016; to confirm). Lobby: a `#rejoin` line above Open games: "Your game “name” is still
running." with **Rejoin game** and **Dismiss**. Game: **Leave game** in the status bar,
secondary style, with `confirm("Leave the game? Your team will be out.")`. The wording must match
that ADR's semantics.

### 11. Errors and end states (copy)

Errors state what happened and what to do, in sentence case, without apologies.

| Case | Where | Text |
|---|---|---|
| Parse error | `#error` | parser message, e.g. "Unknown name 'y'" |
| Slider letter in Fire | `#error` | "a is a slider letter. Insert the formula from its template, or type a number." |
| Undefined at shooter | `#error` | parser message (ADR 14) |
| Send failed | `#error` | "Shot not sent: <err>. Fire again." |
| Could not start | `#room-error` | "Could not start: <err>." |
| Win | `#end` | "You win." / "Team 2 wins." |
| Draw | `#end` | "Draw." + "Nobody is left." |
| Host left | `#end` | "The host left." + "The game can't continue without the host." |
| Desync | `#end` | "Out of sync." + "A message from the host was lost, so this game can't continue. Start a new one from the lobby." |
| Version mismatch | `#end` | "Different version." + "Reload the page, then join again." |
| Game full | `#end` | "Game full." + "The host started with the seats already taken." |
| Engine error | `#end` | "Engine error." + "<err>. This game can't continue on this device." |
| Incompatible listing | lobby row | "Different version. Reload the page." |
| Storage blocked | library | "Can't save in this browser; saved formulas last until you close the tab." |

`#end-message` holds the headline and explanation; the e2e test matches `/win/i`, `/host left/i`,
`/full/i`, which this copy keeps.

### 12. Accessibility and responsive floor

- Every control has a `<label>` or an `aria-label`. Focus is visible everywhere:
  `:focus-visible { outline: 3px solid var(--mark); outline-offset: 2px }`.
- All text is at least 4.5:1 and every graphical object that carries meaning is at least 3:1
  (table in 2). Touch targets are at least 44 px under `(pointer: coarse)`.
- `<meta name="viewport" content="width=device-width, initial-scale=1">` and
  `<meta name="color-scheme" content="light dark">`.
- The canvas gets `role="img"` with `aria-label` "Board", and its text alternative is the status
  bar, the roster and `#last-shot`.
- Untrusted text (game names, peer formulas, saved names) only ever goes through `textContent`
  or canvas `fillText`. No `innerHTML` anywhere in the client.

### 13. Review against defaults (second pass)

Revised after checking the first plan against the generic look:
- Dark theme first drafted as near-black with neon trajectories (oscilloscope). That is a stock
  dark-plus-acid-accent look, so it became a chalkboard green tied to the classroom.
- Monospace formula inputs read as code and as a stock "data" font, so formulas use STIX Two Text.
- Lobby games as rounded cards would be the SaaS kit; the games are tabular, so they stay a table.
- A graph-paper background on the whole page was removed. The grid appears only on the board,
  where it does a job (scale and frame).
- A "∎" after the win headline was cut (one accessory too many).
- No numbered markers, all-caps labels, middle-dot meta strings or arrow-suffixed buttons. The
  template preview's "→" is maths notation for "gives", not decoration.

### 14. Selector contract for the e2e test

These stay as they are: `#host-name`, `#host-field` (a `select` with values `xy`/`disc`),
`#host-seats`, `#games tr` with an enabled button named "Join", `#room-players li` (exactly one per
player), `#start`, `#game`, `#end` (via `hidden`), `#fire`, `#mode-explicit`, `#mode-parametric`
(visible native radios), `#input-a`, `#input-b`, `#error`, `#end-message`, `window.__state`.

Changes:
- The host form gains no second button. The e2e clicks `#host-form button`, so either keep a
  single button or change the test to `#host-form button[type=submit]`.
- `tests/e2e.mjs` gains `".css": "text/css"` in its MIME map for `static/style.css`.

## Consequences

- One new stylesheet (`static/style.css`) and one Google Fonts request. Without network access
  to Google, the fallbacks apply and nothing breaks.
- `render.ts` grows: frame-aware grid, labels and the animation prefix. It stays pure drawing
  with no game state.
- `TEAM_COLORS` in TypeScript is replaced by CSS tokens, so colours have one source.
- Saved formulas are per browser and per field. They do not sync and are not shared with peers.
- Only plain formula text crosses the wire, so the protocol, the parser and the version check
  are untouched.
- No curve preview. Players learn from the frame-aware grid and from watching shots. A practice
  mode stays a possible later feature.
- Player names other than the short id remain out of scope (it would be a protocol change).
