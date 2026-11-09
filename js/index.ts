// Local preview of the renderer: `#disc` in the URL shows the disc field, otherwise the xy field.
import { Field, Game } from "../pkg/index.js";
import { draw } from "./render";

const disc = location.hash === "#disc";
const sim = disc
    ? new Game(Field.Disc, 10, 10, 20, 0.2, 1.5, new Uint32Array([3, 3, 3, 3]), 0.3, 1n)
    : new Game(Field.Xy, 20, 10, 30, 0.2, 2, new Uint32Array([3, 3]), 0.3, 1n);
const canvas = document.getElementById("arena") as HTMLCanvasElement;
canvas.width = disc ? 600 : 800;
canvas.height = disc ? 600 : 400;
const shot = sim.fire(disc ? "1+θ" : "x");
draw(canvas, { field: disc ? "disc" : "xy", arena: sim.arena(), current: sim.get_current_team_idx(), shot: shot.points });
