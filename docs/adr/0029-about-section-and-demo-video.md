# 29. About section and demo video

Status: Accepted (2026-11-10). Amends 0017 (the lobby page and the footer).

## Context

The lobby says nothing about what the game is, and the repository is not linked from the page. A
newcomer needs a short description and a look at a real game; returning players, who only want
the open games and the host form, must not have to scroll past it.

## Decision

- `<section id="about">` sits inside `<section id="lobby">`, after the open games and the host
  form, so nothing new is above them. It is hidden with the lobby in a room, a game and the end
  screen, with no code of its own. It has a heading, a short description from the README (what the
  game is, how a turn works, the two fields), a link to https://github.com/jmigual/graph-fight, and the
  video. The footer links the repository too, next to the version link; both open in a new tab, and
  the footer link's accessible name starts with its visible text ("GitHub, opens in a new tab").
- The video is `<video muted loop playsinline controls preload="none" poster="./demo-poster.jpg">`
  with a webm `<source>`. Its text alternative is the description beside it and a caption:
  `aria-describedby` points to both. `preload="none"` keeps the 400 KB file out of the lobby's load
  until someone plays it or it scrolls into view.
- `js/about.ts` (imported by `index.ts`, nothing else in it) plays the video when an
  `IntersectionObserver` reports it on screen and pauses it when it leaves, unless
  `prefers-reduced-motion: reduce` matches; then it never plays on its own, and the controls and
  the poster remain. A hidden section never intersects, so nothing plays in a game.
- `scripts/demo-video.mjs` records the clip: it serves `dist/` as e2e does, hosts a solo XY game
  against an Easy bot with the network cut (as e2e scenario S, ADR 21), types and fires two
  formulas, and writes `static/demo.webm` and `static/demo-poster.jpg` with Playwright's
  `recordVideo`. Run it after `npm run build` when the UI changes enough to date the clip; the
  files are committed and copied to `dist/` with the rest of `static/`.
- Size budget: about 8 to 15 s and well under 1 MB for the webm. The page is laid out at
  960x540 and recorded scaled down to 480x270, which gives 13 s and about 410 KB; the poster is a
  JPEG at quality 70 (about 50 KB). ffmpeg is not required.
- Styles use the ADR 17 tokens only. The section is one column on a phone and two from 960 px (text
  and video); the video scales to its container, with a 16:9 box so the layout does not jump when it
  loads.

## Consequences

- `dist/` grows by about 460 KB, fetched only on play or scroll-into-view.
- The clip shows the UI of the day it was recorded and goes stale as the UI changes; the recorder
  makes redoing it one command. The recording is not deterministic (the arena is random), so a
  re-run gives a different clip.
- The video's first seconds show the lobby, then the waiting room, then the game: it records the
  whole flow from page load, as nothing here trims it without ffmpeg.
- e2e AL checks the section's place and visibility, the repository link and the video's poster
  and `preload`; it does not play the video.
