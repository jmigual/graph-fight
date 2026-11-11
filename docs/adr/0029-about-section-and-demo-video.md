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
  with a webm `<source>`, an `aria-label` as its name and the caption (`aria-describedby`), which
  also says that the clip opens on the lobby and the waiting room and what each round shows. The description beside it is the
  text alternative. `preload="none"` keeps the 500 KB webm out of the lobby's load until someone
  plays it or it scrolls into view; the 55 KB poster loads with the page.
- `js/about.ts` (imported by `index.ts`, nothing else in it) plays the video when an
  `IntersectionObserver` reports it on screen and pauses it when it leaves. A pause the observer
  did not cause (the viewer's) stands until they press play again. With
  `prefers-reduced-motion: reduce` it never plays on its own, and the controls and the poster
  remain. A hidden section never intersects, so nothing plays in a game.
- `scripts/demo-video.mjs` records the clip: it serves `dist/` as e2e does, hosts a solo XY game
  against an Easy bot with the network cut (as e2e scenario S, ADR 21), types and fires two
  formulas, and writes `static/demo.webm` and `static/demo-poster.jpg` (or into a folder given as
  its argument, for a trial run). Run it after `npm run build` when the UI changes enough to date
  the clip; the files are committed and copied to `dist/` with the rest of `static/`.
- Pacing: the first clip (about 12 s) went by too fast to follow. The recorder now holds on the
  lobby for 4 s and on the waiting room for 3.5 s, then on the board for 3 s before the first
  turn. It types each formula at 220 ms a key, waits 1.5 s before Fire, waits for the pen
  (up to 1.4 s, ADR 17) and then keeps the result on screen for 2 s. Our shot and the bot's get the
  same treatment, so the bot's turn (it waits at least 1.5 s before firing, ADR 21) is shown as
  clearly as ours. The clip is about 35 s; each pause is a constant at the top of the script.
- Cache: a re-recording keeps the file names, and a browser keeps media past GitHub Pages'
  `max-age=600`, so viewers saw the old clip after 0.8.0. `scripts/build.mjs` rewrites the `src` and
  `poster` in `dist/index.html` to `demo.webm?v=<hash>` and `demo-poster.jpg?v=<hash>` (first 8 hex
  characters of the file's sha256, `scripts/versioned-media.mjs`); `static/index.html` stays plain.
- Quality and size: the first clip was Playwright's `recordVideo` scaled down to 480x270, which is
  blurry at the 448 CSS px the video has on a desktop (896 device px on a HiDPI screen, 984 on a
  phone) and made the formula and status text unreadable. The recorder now renders the 960x540 page at
  `deviceScaleFactor` 2 and takes a JPEG screenshot (quality 92) in a loop, each repeated for the
  frames that fell due while it was taken (about 12 distinct frames a second in a 15 fps clip). It
  pipes them into the ffmpeg that Playwright installs next to its Chromium (found from
  `chromium.executablePath()`; the script fails with a message if it is missing) and encodes
  1920x1080 VP9 with constant quality (`-crf 24`, `-b:v 0`, a keyframe every 10 s). That gives about
  480 KB for 12 s and about 750 KB for the 35 s paced clip, under a budget of about 1.5 MB for a
  lazy-loaded file; the flat board compresses well, so a lower CRF buys little. The bundled ffmpeg has only the VP9, MJPEG and PNG encoders and
  an MJPEG decoder, hence the JPEG frames. The poster is a 960x540 (CSS scale) JPEG at quality 80
  (about 56 KB), sharp at 2x on a desktop and 3x on a phone. The 0.7.0 clip was recorded on a
  `GRAPH_FIGHT_LOBBY=live` build, so the footer reads "v 0.7.0" rather than a `-dev+hash` id; the
  network is cut, so the lobby topic does not matter.
- Styles use the ADR 17 tokens only. The section is one column on a phone and two from 960 px (text
  and video); the video scales to its container, with a 16:9 box so the layout does not jump when it
  loads.

## Consequences

- `dist/` grows by about 540 KB; only the poster is fetched with the page, the webm on play or
  scroll-into-view.
- The clip shows the UI of the day it was recorded and goes stale as the UI changes; the recorder
  makes redoing it one command. The recording is not deterministic (the arena is random), so a
  re-run gives a different clip.
- The video's first seconds show the lobby, then the waiting room, then the game: it records the
  whole flow from page load, as the recorder does not trim it.
- e2e AL checks the section's place and visibility, the repository link and the video's poster
  and `preload`; it does not play the video.
