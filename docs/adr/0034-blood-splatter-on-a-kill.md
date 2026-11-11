# 34. Blood splatter on a kill

Status: Accepted (2026-11-11). Amends 0017 (the board drawing and its colour tokens).

## Context

A killed player only changes face (X eyes, faded), which is easy to miss on a wide board where a
head is about 12 px. A kill should be seen, in the style of the board: flat shapes, no gore. The
board is drawn by `js/render.ts` and must stay display only: nothing here may touch the engine, the
wire messages or the turn state (ADR 2, 7).

## Decision

- **Look.** A splat is flat red circles in the new `--blood` token (light `#B3171F`, dark
  `#F0525A`, next to `--danger`; `FALLBACK` in `render.ts` holds the light one): a blob over the
  player, five big blobs close to it and eight small droplets further out, at 2.2 head radii per
  splat unit so they read beside a small head. It is drawn with the static board as a stain on the
  ground: over the paper, grid and axes, under the obstacles, shots and faces (layer 2a of
  ADR 17), so the dead player's face sits on it and a shot's pen and label stay on top.
  `--blood` is 6.2:1 on the light paper and 3.8:1 on the dark one, but only 1.41:1 and 1.04:1
  against `--obstacle`, which is why an obstacle covers a splat instead of the splat covering it.
  A splat next to an obstacle is partly hidden by it, and a crater's repaint clears it too; that is accepted.
- **Lasting mark.** `paint` draws a splat under every dead player on every frame (no state).
  A rejoin replay, a redraw and reduced motion show the marks and animate nothing. The end screen
  waits for the animation of the shot that ends the game, bursts included (ADR 17, section 5), then
  shows the marks.
- **Burst.** When `draw` animates a shot, each player alive in the previous view and dead in the new
  one is a kill. The pen's first point within its radius starts a 400 ms burst: the same blobs move
  out from the player (fast, then settling) and end exactly as the lasting mark, which takes over.
  The player shows dead from that moment. The animation runs until the last burst ends, even if the
  pen is done. Under `prefers-reduced-motion` `game.ts` already draws without `before`, so there is
  no burst, only the mark.
- **Determinism.** `splatShape(seed)` is pure (a small seeded generator); the seed is
  `team * 256 + player`, known to every peer, so all see the same splat. Each player dies once, so the
  turn adds nothing. No `Math.random`, nothing sent. Shapes are cached by seed, so a frame allocates
  no shapes.
- **Test arena.** Players are never out there (ADR 25), so no splat and no change; `arena.ts` is untouched.
- **Alternatives.** Particles with physics or a per-frame random scatter: more code, and not the
  same on each peer. A canvas of its own for the marks: the static board is already redrawn in one pass.

## Consequences

- `render.ts` gains `splatShape`, `splat` and a kill pass in `draw`; `game.ts` is unchanged.
- A replay animates the pen and the kills of the last replayed shot like a live one, as before for the pen.
- `tests/render.test.mjs` checks `splatShape` is deterministic; e2e X checks that a dead player has
  `--blood` pixels around it, which fails without the feature.
