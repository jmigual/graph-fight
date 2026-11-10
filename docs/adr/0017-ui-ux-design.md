# 17. UI and UX design: graph paper, formula editor, saved formulas and templates

Status: Accepted (2026-11-09). Amends ADR 15 (canvas size constants, section 4). The board
follows ADR 20 (settled in section 4). Amended by 0021: the host's waiting room has `#bot-level`
and `#add-bot`, each bot is a `#room-players` `li` with a Remove button, and the roster names a
bot "Bot 1, hard" where a human's short id goes. Section 4 also settles each character's last shot
staying on the board and refilling the editor.

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

On review the user approved the proposal and added:
- Sharp canvas on HiDPI screens, "Your turn" in the tab title, and starter templates.
- "For the players I wanted to use emoji faces. They should look to the left or right and when
  they shoot they look a the direction that they shot. Every team should have a different face
  and the faces should also have a color in them. You can give them a cap with a color maybe."
- "For polar arenas it should also be possible to choose shooting clockwise or counter clock
  wise". The engine and protocol side (a direction flag in `shot`, θ mirrored for clockwise) is a
  separate change. This ADR covers only the control and how it is shown.

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
| `--face` | `#FFD54A` | `#FFD54A` | emoji head fill, same in both themes | 1.3 / 9.4 |
| `--face-line` | `#2B2118` | `#2B2118` | head and cap outline, eyes, mouth | 14.1 on paper, 11.2 on `--face` |

The yellow head is only 1.3:1 on the light paper, so the `--face-line` outline (14.1:1) marks its
edge there. On the board the head itself is 9.4:1.

**Team colours** `--team-1` .. `--team-8`. They are the Okabe-Ito hues, darkened for the pad and
lightened for the board. Teams 1 and 2 are vermilion and blue, the pair that stays distinct
under every common colour-vision deficiency, and the XY field only ever uses those two.

| Team | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Light | `#C2410C` | `#0B63B0` | `#00775A` | `#A63D8A` | `#806200` | `#8B4A1C` | `#6B46C1` | `#4F6F00` |
| Dark | `#FF9A5C` | `#6CB6F2` | `#3FD0A0` | `#F08BD0` | `#EBCB45` | `#E0A577` | `#B9A2F5` | `#B5D35E` |

All 16 values are at least 4.6:1 on their paper. Colour is never the only cue. A player is
identified by three things: cap colour, the team **number** (a tag above the cap, in the roster
and in the status line, "Team 3") and the team's **face** (section 4). Caps are outlined in
`--face-line`, so a cap whose colour is close to the yellow head (team 5 on the board) still has a
visible edge.

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
   `θ = 0` ray toward the disc centre is an axis with an arrowhead and the label `θ = 0`. On the
   shooter's own screen there is also a short arc arrow near the shooter showing which way θ grows
   for the chosen direction (section 7), and the label `π/2` on the ray 90° that way. Both flip as
   soon as the toggle changes. Other players do not know the direction before the shot, so their
   screens show only the `θ = 0` axis. When there is no current shooter (game over), the grid is
   drawn in the world frame from the centre.
3. **Obstacles** filled with `--obstacle` ("pencil shading").
4. **Craters** are "erased". Each crater is clipped and layers 1 and 2 are repainted inside it, so
   the grid shows through the hole.
5. **Board edge**: 2 px `--ink` rectangle or circle.
6. **Last trajectory**: 2.5 px stroke in the shooter's team colour with round caps and joins. Its
   formula is written beside the end point in STIX italic, 14 px, in the team colour, with a 4 px
   `--paper` halo (`strokeText` before `fillText`). The label is truncated to 32 characters plus an
   ellipsis and clamped inside the canvas. Peer formulas only reach the canvas through
   `fillText`/`strokeText`, which render text only.
7. **Players are emoji-style faces** drawn with canvas paths, not Unicode emoji (glyphs cannot
   change gaze and look different on every OS). The head is the hit circle at its true radius;
   nothing is enlarged, so what you see is what can be hit.
   - **Head**: `--face` disc with a `--face-line` outline (1.5 px, 1 px when small), inside a
     1.5 px `--paper` halo that separates it from adjacent obstacles.
   - **Cap** in the team colour, outlined in `--face-line`: a dome over the top ~40 % of the head
     plus a brim reaching 0.55 r beyond the head on the side the face looks to.
   - **Team number**: a tag above the cap, Atkinson 700, 11 CSS px, team colour with a 3 px
     `--paper` halo. It has a fixed CSS size, so it stays legible when the head is tiny.
   - **Face per team.** All teams have the same two eyes, so gaze reads the same everywhere. The
     mouth and brows differ:

     | Team | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
     |---|---|---|---|---|---|---|---|---|
     | Face | grin (filled D) | smirk (raised on the gaze side) | calm (flat line) | surprised (O ring) | grimace (box with teeth line) | frown (down arc) | tongue out (smile, tongue in team colour) | determined (V brows, short flat mouth) |

   - **Gaze.** Each player has a world-space gaze vector. Pupils shift 0.4 of the eye radius
     along it, and the eyes and mouth shift 0.1 r toward its horizontal side. The brim sits on
     the side of the gaze's screen x; when |x| < 0.25 (looking straight up or down) the brim keeps
     its previous side, initially right. Rules:
     - Default before a player has shot: toward the centre. On XY that is the shot direction (ADR
       4 mirrors right-hand shooters). On the disc it is the frame's `θ = 0`.
     - While we aim on the disc, our own shooter looks toward the chosen side: the frame's `θ = 0`
       vector turned +90° for counterclockwise or -90° for clockwise (section 7). Only our screen
       shows this.
     - After a shot, on every screen, the shooter looks along the shot's initial heading: from the
       first trajectory point to the first point at least 0.5 units away (or the last point if
       none is that far). An empty shot leaves the gaze unchanged. The gaze stays until that
       player shoots again.
     - Gaze is UI state in `index.ts`, keyed by team and player index. It is not in `__state` and
       not synchronised. It resets to the default on a new game, and after a reload it is
       rebuilt from the replayed log (see "Settled in S2" below).
   - **States.** Current shooter: a 2 px `--ink` ring 3 px outside the halo; it is also the origin
     of the grid. Dead: X eyes, flat mouth, head at 40 % alpha, cap kept so the team stays
     identifiable. Disconnected (reconnection work): closed eyes (two short lines), plus a small
     "z" at full detail.
   - **Detail by drawn radius** (CSS px). At 9 px or more the full face is drawn: eye whites,
     pupils, mouth, team 8's brows. Between 5 and 9 px: pupils as dots, a 1 px mouth, team 8's
     brows as one V line, no eye whites. Typical sizes are about 12 px on desktop XY, 10 px on
     a desktop disc and 5.4 px on a 390 px phone. On phones, cap colour and the number tag carry
     identity and the face shapes are a bonus. Pinch zoom is not disabled.

**Sharp canvas (amends ADR 15).** The backing store follows the displayed size:
`canvas.width = round(clientWidth * devicePixelRatio)` (height likewise), and
`ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`, so `render.ts` works in CSS pixels and all sizes above
are CSS px. A `ResizeObserver` on the canvas redraws. `canvasWidth` is removed from `ARENAS`, and
ADR 15's "canvas 800 x 400 / 600 x 600" no longer applies. The arena constants that feed the
engine do not change. CSS sizes the canvas by the field's ratio (`--ratio: 2` for XY, `1` for the
disc): `aspect-ratio: var(--ratio); width: min(100%, calc((100dvh - 7rem) * var(--ratio)))`, so
the whole board fits the viewport without distortion.

Settled in S2 (`js/render.ts`): an "N px halo" is a `--paper` stroke 2N px wide under the text.
The disc numbers its `θ = 0` axis 5, 10, 15 like the XY `+x` axis, leaving the end of the axis to
the `θ = 0` label. Grid rays are all `--grid`. The board redraws on `document.fonts`
`loadingdone`, since the game's fonts may load only once the game section is shown. A missing
token falls back to its light value.
Faces: eye whites are plain white (not a token). Heads under 5 px use the 5 to 9 px face. Eyes
and mouth shift 0.1 r times the gaze's x. A disconnected face keeps its team mouth; a dead one
shows as dead even when disconnected. The direction arc and `π/2` are drawn above the obstacles
so they stay visible. The board redraws when the set of disconnected seats changes.
After a reload the rejoin replays the whole log (ADR 16), so each gaze is rebuilt from the
replayed shots; it is still display only and matches the other screens. Number tags are drawn
after all faces, kept inside the canvas. The board also redraws when `devicePixelRatio` changes.
Shot label: the mode's variables, `y = …`, `x = …, y = …`, `r = …`, `r = …, θ = …`; it appears
with the final frame. The pen takes 700 ms for a path up to the arena's width (`2 x_max`) and
scales with length up to 1400 ms. During the animation the grid stays in the shooter's frame.

Settled with ADR 20 (`js/render.ts`, `js/index.ts`): the host picks the shot frame. The host form
has a "Coordinates" select, `#host-frame`, after Field: "Map-centred (like Graphwar)" (default,
`map`) and "Player-centred" (`player`). The lobby's Field cell adds it ("XY plane, map-centred",
short "XY, map") and so does the waiting room's info line ("Polar disc, player-centred, 3 seats").
In the player-centred frame the board is as described above and in section 7. In the
map-centred frame shots are in map coordinates on both fields, so the graph paper does not
follow the shooter. It shows the map's own axes from the centre on every screen and every turn.
On XY: lines every 1 unit (major every 5) through integer map coordinates, the `+x` axis (arrow at the right edge) and `+y` axis (arrow at the top) through the centre, and 5,
10, 15 under `+x`. On the disc: circles every 1 unit (major every 5) and rays every 30° about the
centre, the `θ = 0` axis along the map's `+x` with its arrowhead, the number 5 and the `θ = 0`
label, and `π/2`, `π`, `3π/2` near the rim on the quarter-turn rays. On our own turn the old arc
and `π/2` beside the shooter are replaced by where our formula starts and which way it sweeps,
drawn above the obstacles and under the faces. On XY: a line from the `x` axis to our face, the
label `x ≈ -7.32` (two decimals) on the far side of the axis, clear of the face and of the axis
numbers below it, and a 40 px
arrow from our face toward the other half. On the disc: a line from the centre toward our face,
an arc from the `θ = 0` axis to it labelled `θ₀ ≈ 0.61` (the engine's value, in `[0, 2π]`, ADR 20),
and a short arc arrow about the centre just inside our face turning the chosen way (section 7).
While we aim on the disc our face looks along that sweep: the direction from the centre to us
turned +90° (counterclockwise) or -90° (clockwise); on XY the resting gaze already faces the sweep.
Section 7's "Meaning" is now "counterclockwise sweeps θ up from `θ₀`, clockwise down", seen from
above the map rather than from the shooter, in the map-centred frame. The resting gaze (toward the
centre) and the gaze after a shot (from the shot's first points) are the same in both frames.

Settled with the per-character shot memory (`js/render.ts`, `js/index.ts`): every applied shot is
also kept per character in `Play.shots`, keyed by `lookKey` like the gaze, so a reload that
replays the log (ADR 16) rebuilds it. Display only; nothing travels. Two uses:
- **Board.** Each living character's last shot stays drawn: 1.5 px at half opacity in its team
  token (`--team-1`..`--team-8`, so both themes keep their contrast), under the newest shot, which
  keeps its 2.5 px full-colour stroke, its label and its pen animation. During the animation the
  previous newest is already one of the faint paths. A character's path goes with its death, at the
  final frame of the shot that killed it; a newest shot is drawn even if its shooter died of it. A
  turn without a shot (timeout, failed formula) leaves every path faint. Not a new token, since
  the opacity is the team token's own; with 8 teams that is at most 24 thin lines, and the label
  stays on the newest only. `olderPaths` in `render.ts` picks them.
- **Formula box.** When one of our characters' turn starts, the editor takes that character's last
  formulas: mode, both expressions (the second is emptied for an explicit shot) and the CW/CCW
  radio, which stays hidden on XY. A character that has not fired leaves the editor as it is, so
  it may hold the previous shooter's text, but one that has fired never gets another's.
`window.__state()` gains `faint`, the number of faint paths, for the e2e test (ADR 15's hook
stays read-only and the same on every peer).
Also settled (`js/index.ts`): the host's own shot applies synchronously inside `room.shoot`, so
the Fire handler must not redraw afterwards. It only disables Fire, and refreshes on a refused
shot, or a redraw of the unchanged shot would end the pen on its final frame.

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
  Gaze changes instantly. The shooter's new gaze is applied together with the final frame of the
  trajectory, so the face turns when the pen lands.
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
| |                                           | | (disc only:)           |
| |                                           | | (o)↺ Counterclockwise  |
| |                                           | | ( )↻ Clockwise         |
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
alive flags before and after the shot. On the disc it names the direction: "Team 2 fired
r = θ/2, clockwise."

While it is our turn the tab title is "Your turn | Graph fight!". Otherwise it is "Graph fight!".

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
- **Direction (disc only).** A `fieldset` with the legend "Direction", directly above the
  Save/Fire row and hidden on XY. It holds two visible native radios, `name="dir"`: `#dir-ccw`
  "Counterclockwise" (checked by default) and `#dir-cw` "Clockwise". They use the mode switch's
  segmented style. Each label starts with an inline SVG arc arrow (`aria-hidden`,
  `currentColor`, 1.25em) turning that way; Unicode ↺/↻ were not used because their rendering
  varies between fonts.
  - Meaning, in the shooter's frame (ADR 5): θ = 0 points from the shooter to the disc centre.
    Facing the centre, counterclockwise (θ grows, the current behaviour) sweeps to the shooter's
    **left**, and clockwise (θ mirrored by the engine) sweeps to the **right**. "Left" is the
    `θ = 0` vector turned +90°; this is also the gaze while aiming (section 4).
  - The toggle applies to both disc modes; the engine change decides this, so confirm it there.
    If it only applies to one mode, hide the toggle in the other.
  - Keyboard: native radio-group arrows. Changing it redraws only our board: the θ arc arrow, the
    `π/2` label and our face's gaze. Nothing is sent until Fire; the shot then carries the
    engine change's direction flag.
  - It resets to counterclockwise when a game starts and otherwise keeps its value across turns.
    Saved formulas do not store a direction, and Insert leaves the toggle alone.

### 8. Saved formulas and templates

One list, "Saved formulas", below the editor. Any saved formula that contains slider letters is a
**template** and shows sliders. There is no separate store or screen.

**Saving.** **Save** (secondary, next to Fire) opens an inline row under the editor: "Name"
input prefilled with the formula text (cut to 64 characters), plus **Save formula** and
**Cancel** (Escape cancels). Saving stores the current field, mode and input text(s) and does not
validate the formula, so unfinished work can be saved; Fire validates. Slider letters are
detected when saving. A letter right after a digit or `.` (`2a`), or right before a `.` (`a.5`,
`a.`), blocks the save with "Put * between a number and a slider: 2*a." (naming the slider that was found). Without that check,
substitution would silently turn `2a` with `a = 1.5` into `21.5` and `a.5` with `a = 1` into `1.5`.

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
Settled in S5 (`js/library.ts`): an empty step is stored as `null`; read also requires |number| <= 1e6,
`min < max`, `min <= value <= max`, `step > 0`, no `2a`-style slider, and slider keys equal to the
formulas' slider letters. If the stored text exists but does not fully validate (corrupt JSON,
another version, or any invalid item), `loadItems` returns its valid items (none if the top level is
bad), no starters, and `available: false`, and `saveItems` refuses to overwrite it, so a bad read
never destroys the original; the UI shows the storage notice. `available: false` also means storage
could not be read (empty list) or the first write failed.

**Starter templates.** When the storage key is absent (first visit), the list is seeded with the
templates below and written to storage. Deleted starters stay deleted, because the key then
exists. Each one parses once its values are inserted, is finite at the start of its range (so it
is not rejected as undefined at the shooter, ADR 14), and is far below 256 characters at any
slider value. The values are the defaults the sliders start at.

| Field, mode | Name | Formula(s) | Sliders (min, max, step, value) |
|---|---|---|---|
| XY, function | Line | `a*x` | a: -2, 2, 0.05, 0.5 |
| XY, function | Parabola | `a*(x - b)^2` | a: -0.5, 0.5, 0.01, -0.02; b: -20, 20, 0.5, 0 |
| XY, function | Wave | `a*sin(b*x)` | a: 0, 5, 0.1, 2; b: 0, 3, 0.05, 1 |
| XY, function | Hop | `a*exp(-((x-b)/c)^2)` | a: -5, 5, 0.1, 3; b: -20, 20, 0.1, 0; c: 0.2, 5, 0.1, 1 |
| XY, parametric | Straight line | `t*cos(a)`, `t*sin(a)` | a: -3.14, 3.14, 0.01, 0.5 |
| XY, parametric | Cycloid | `d*(t - a*sin(t))`, `a*(1 - cos(t))` | a: 0, 3, 0.1, 1.5; d: -1, 1, 2, 1 |
| Disc, function | Spiral | `a*θ` | a: -3, 3, 0.1, 1 |
| Disc, function | Wave | `a*sin(b*θ)` | a: 0, 5, 0.1, 1; b: 1, 8, 1, 4 |
| Disc, parametric | Straight shot | `-t`, `0` | none |
| Disc, parametric | Bend | `-t`, `a*t` | a: -0.3, 0.3, 0.005, 0.05 |

Settled with ADR 20 (`js/starters.json`): shots are in map coordinates, offset to start at the
shooter, so some starters changed. On XY, `x` is the map's: Parabola puts its vertex at map
`x = b`, and Hop its bump at map `x = b`. Parametric XY shots are not mirrored, so Straight line
takes its direction as an angle `a` in the map, and Cycloid has `d = 1` to roll right or `-1` to
roll left. Line and Wave are unchanged. Spiral allows negative `a` (inward). "Circle"
(`a*sin(θ)`) no longer drew a circle and "Rose" no longer drew petals; one wavy orbit, "Wave",
replaces both. A constant angle cancels out, so "Straight shot" is the line through the centre and
has no slider, and "Bend" bends that line around the centre. There are 10 starters. They are
written for the default map-centred frame. In a player-centred game the disc "Straight shot" and
"Bend" (`r = −t`) point away from the centre and leave the disc at once; `r = t` is the straight
shot there. The starters are not changed per frame.

Verification has two parts. The S5 unit test substitutes every starter at its min, default and
max values and requires no slider letters left and at most 256 characters. A Rust test in
`tests/starters.rs` substitutes the same values and runs `Formula::parse` with the mode's variable
(`x`, `θ` or `t`), requiring a finite value at the start: at several shooter positions `x` on
both halves and angles `θ₀` (ADR 20), and at `t = 0`. The WASM build cannot run under the node test
runner, so the Rust test does not call `check`/`check_param`. The starters are shared, not copied:
both tests read `js/starters.json`, and Rust substitutes with its own small tokenizer.

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
| Current, ours | "aiming", bold | ring + grid origin; on the disc our face looks to the chosen side | "Your turn", swatch, timer |
| Current, other | "aiming" | ring + grid origin | "Team 2 is aiming" |
| Waiting | nothing | face looking toward the centre or along its last shot | |
| Disconnected (reconnection work) | "disconnected", `--ink-soft` | closed eyes | when current: "Team 2 is disconnected. The timer will skip its turn." |
| Eliminated | strikethrough + "out" | X eyes, faded head, cap kept | ours: editor replaced by "Your team is out. Watch the rest or leave." |
| We lost the host link (reconnection) | | board frozen | "Reconnecting to the host…" in `--ink-soft`, Fire disabled |

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
- Faces are drawn paths with a dark emoji-style outline, not OS emoji, so they match across
  platforms and can turn their eyes.
- No numbered markers, all-caps labels, middle-dot meta strings or arrow-suffixed buttons. The
  template preview's "→" is maths notation for "gives", not decoration.

### 14. Selector contract for the e2e test

These stay as they are: `#host-name`, `#host-field` (a `select` with values `xy`/`disc`),
`#host-seats`, `#games tr` with an enabled button named "Join", `#room-players li` (exactly one per
player), `#start`, `#game`, `#end` (via `hidden`), `#fire`, `#mode-explicit`, `#mode-parametric`
(visible native radios), `#input-a`, `#input-b`, `#error`, `#end-message`, `window.__state`.
New: `#dir-ccw`, `#dir-cw` (disc only, visible native radios). The default is counterclockwise,
which is the current engine behaviour, so the existing disc scenarios need no change.

Changes:
- The host form gains no second button. The e2e clicks `#host-form button`, so either keep a
  single button or change the test to `#host-form button[type=submit]`.
- `tests/e2e.mjs` gains `".css": "text/css"` in its MIME map for `static/style.css`.

Settled in S1 (`static/index.html`, `static/style.css`): `index.ts` sets `data-field` (`xy`/`disc`) on
`#game`; CSS uses it for `--ratio` on the canvas and to show the field's notation in the mode labels
(the radios take their visible text as accessible name, so the label stays in the name, WCAG 2.5.3; the "Function"/"Parametric" names in section 7 are dropped). The `#direction` fieldset carries
`hidden` until a disc game starts (S7). "Seats" is hidden by CSS while
`#host-seats` is disabled. The start hints and "Waiting for the host to start." are static text that CSS
shows from the state of `#start`. `#quit` is hidden by CSS once `#end` is shown. The `#rejoin` line is not
built: ADR 16 rejoins on reload without asking. `Leave game` asks `confirm("Leave the game? Your team
will be out.")`, so the e2e test accepts dialogs. "Could not start" goes to `#room-error`.

Settled in S4/S6 (`js/editor.ts`): a helper that would push its input past `maxlength` inserts nothing. The
Save row is `#save-row` with `#save-name`, `#save-confirm` ("Save formula"), `#save-cancel` and `#save-error`; the
storage notice is `#saved-notice`. A saved formula goes to the front of the list, so the list reads newest first
within its mode group (a mode heading per group); starters keep the table's order. A template's sliders sit in a
`<details>` "Sliders", open for a template just saved. The preview line, **Insert** and **Delete** are always
visible, so Insert works at the default values without opening it. The "Too long with these values" message
shows live under the preview and disables Insert while it applies. A value typed in the number field widens the
limits on `change` (blur or Enter), not per keystroke. Fire's slider-letter error names every letter: "a is a
slider letter. ... or type a number." for one, "a and b are slider letters. ... or type numbers." for several.

Settled in S3 (`js/index.ts`): the last-shot line also says "Team N ran out of time." for a timeout, "Team N left the game."
for a quit, and "fired a formula that failed, so the turn was skipped" for a shot that every peer's engine rejects; on the
disc it says "counterclockwise" as well as "clockwise". The error line is emptied and refilled 50 ms later, so a repeated
identical error is announced again; `aria-invalid` is set with the text and removed with it. Editing either input, a new
turn and Fire clear it. The roster shows one state word: "out", else "disconnected", else "aiming". The
waiting room's open-seat line (`#room-seats`) also carries the host's "More players than seats" text. A guest takes the
room's name and field from the lobby listing it joined from; after a reload the heading falls back to "Waiting room". The
empty lobby shows `#no-games` instead of the table. The tab title is also restored when the game ends or on leaving, and it does not say "Your turn" while the host link is down.
When a turn starts that is ours, `#turn-cue` (visually hidden, polite) says "Your turn" and, on a pointer-fine device, the first
formula input gets focus. `#last-shot` and `#turn` are only written when their text changes, and the status code lives in `js/status.ts`.
`aria-invalid` marks formula and slider errors only, and only the visible inputs.

Settled in S7 (`js/index.ts`): the Direction fieldset is shown when a disc game starts, hidden on XY, and `#dir-ccw` is
checked then. It applies to both disc modes (`fire` and `fire_param` both take the flag, ADR 14). On XY the shot always
carries `cw: false`. Changing it redraws only our board. `__state` also returns the last `shot` (ADR 15).

Settled in S8 (`js/index.ts`): a guest whose host link is down (`Game.absent()` lists the host) sees "Reconnecting to the
host…" in `--ink-soft` and Fire is disabled; the host sees "Team 2 is disconnected. The timer will skip its turn." when the current
team's seat is away (the countdown beside it already gives the time). Both update when the set of disconnected seats changes. The `#absent` line is gone, since the roster and the status bar carry
it. The guest-side state is not in the e2e test: the link is down for less than one tick on a quick reconnect, so a test
could not tell it from a miss. It was checked by hand with a 20 ms sampler. "Leave game" while the host link is down
still leaves this page, although `quit` is then dropped and the seat stays held (ADR 16).

## Consequences

- One new stylesheet (`static/style.css`) and one Google Fonts request. Without network access
  to Google, the fallbacks apply and nothing breaks.
- `render.ts` grows: frame-aware grid, faces, labels and the animation prefix. It stays pure
  drawing with no game state. Gaze is UI state passed in by `index.ts`.
- ADR 15's fixed canvas sizes are replaced by a backing store that follows the displayed size
  times `devicePixelRatio`. The engine's arena constants are unchanged.
- On a 390 px phone the faces are about 5 px in radius. Team identity there rests on cap colour
  and the number tag; the faces stay at the true hit radius instead of being enlarged.
- The direction toggle depends on the separate engine and protocol change (direction flag in
  `shot`). Until that merges, the toggle stays unwired.
- `TEAM_COLORS` in TypeScript is replaced by CSS tokens, so colours have one source.
- Saved formulas are per browser and per field. They do not sync and are not shared with peers.
- Templates send only plain formula text, so they need no change to the protocol or the parser.
- No curve preview. Players learn from the frame-aware grid and from watching shots. A practice
  mode stays a possible later feature.
- Player names other than the short id remain out of scope (it would be a protocol change).
