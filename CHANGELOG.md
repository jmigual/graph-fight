# Changelog

## 0.9.0 — 2026-11-11
- A player who is killed leaves a splash of blood.

## 0.8.1 — 2026-11-10
- The About video always shows the latest recording; browsers no longer keep playing an old copy.

## 0.8.0 — 2026-11-10
- In a formula you can leave out the * after a number: 2x, 2θ, 3pi, 2sin(x) and 2(x+1) work, and so does 2a with a slider letter.
- Formula sliders take less space: each slider is two lines, the range with its value, then `min ≤ a ≤ max  Step: step` in small underlined boxes, as on Desmos.
- The demo video in About is sharper.
- The changelog page shows the site icon.

## 0.7.0 — 2026-11-10
- Team games: the host picks Teams, the number of teams and the players per team, and players join a team or the other in the waiting room, so more people can play on the XY plane. A team's players take its characters in turn, and a player who leaves hands their characters to their teammates. The host also picks 1, 2 or 3 characters per player, in any game.
- The Help bar lines up with the page and the board fits the window, on touch screens too. The Test arena button now sits in "Open games", on a phone the test arena shows the editor right under the board, and the coordinates hint links to the help.

## 0.6.0 — 2026-11-10
- Every screen is centred, and the board grows to fill a wide window and stays in view while you scroll during a game.
- In the editor, Fire sits right after the formula, Insert sits beside each saved formula, and the turn state is clearer.
- When a game ends, the result shows instead of the editor.
- An empty lobby suggests adding a bot and explains the coordinates, and the waiting room's player rows are ruled.

## 0.5.0 — 2026-11-10
- A test arena, opened from the lobby, tries formulas offline: place players and obstacles anywhere, fire from any player and see what the shot hits, as often as you like.
- The lobby has an About section below the host form with a short description, a demo video and a link to the GitHub repo; the footer links it too.
- A Help button in the page header explains how to play, writing formulas, how the map-centred and player-centred coordinates work, and the sliders and templates.

## 0.4.0 — 2026-11-10
- The host can add local players who take turns on the host's screen.
- The host can remove a guest in the waiting room or kick a player during a game.
- Password games and private-link games with invite links; the host can let guests share the invite link, and password fields have a Show toggle. Typed passwords are strengthened before they key the room.
- Joining a public game gives up with "The host can't be reached." instead of waiting forever.
- The formula editor gets the right formula back after a rehost or after a player quits.
- A logo in the lobby header and a favicon.
- The footer version opens this changelog.

## 0.3.0 — 2026-11-10
- Each character's last shot stays on the board as a faint path, and its formula comes back in the editor on its next turn.
- The host's own shot animates again after Fire.
- Formulas accept `th` for θ and `π` for pi, and typing `theta` or `pi` in a formula input gives θ or π.
- The footer shows the build version.
- Games from local and test builds use a separate lobby from the live site.
- Internal code cleanup.

## 0.2.0 — 2026-11-10
- The host can add Easy, Medium and Hard bots to a game, and play alone against them.

## 0.1.0 — 2026-11-10
- First release: XY fields for 2 players and polar disc fields for 2 to 8, with the shot formula as `y = f(x)`, `r = f(θ)` or a parametric pair.
- Formula editor with helper buttons, saved formulas and templates with sliders.
- Rejoin a game in progress after a dropped connection or a reload.
- The host picks map-centred or player-centred coordinates.
- Graph-paper design in light and dark themes.
