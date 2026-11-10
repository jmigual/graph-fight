# Changelog

## 0.5.0 — 2026-11-10
- A test arena, opened from the lobby, tries formulas offline: place players and obstacles anywhere, fire from any player and see what the shot hits, as often as you like.

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
