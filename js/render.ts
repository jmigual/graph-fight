// Canvas rendering of the arena. Pure drawing: it reads the arena and never touches game state.
import type { Arena, Circle, Point } from "../pkg/index.js";
import type { Field } from "./net";

export const TEAM_COLORS = ["#d62728", "#1f77b4", "#2ca02c", "#ff7f0e", "#9467bd", "#17becf", "#8c564b", "#e377c2"];

const FIELD_COLOR = "white";

export type View = {
    field: Field;
    arena: Arena;
    /** Team whose player is highlighted, if any. */
    current: number | null;
    /** The last shot's trajectory, in world coordinates. */
    shot: Point[];
};

/** Draws `view` on `canvas`, whose aspect ratio must match the arena's (2:1 for xy, 1:1 for disc). */
export function draw(canvas: HTMLCanvasElement, { field, arena, current, shot }: View) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width, height } = canvas;
    const scale = width / (2 * arena.xMax);
    // World y points up, canvas y points down.
    const toCanvas = (p: Point): [number, number] => [(p.x + arena.xMax) * scale, (arena.yMax - p.y) * scale];
    const disc = (c: Circle, fill: string) => {
        const [x, y] = toCanvas(c.pos);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, c.radius * scale, 0, 2 * Math.PI);
        ctx.fill();
    };

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (field === "disc") {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, arena.yMax * scale, 0, 2 * Math.PI);
        ctx.clip();
    }
    ctx.fillStyle = FIELD_COLOR;
    ctx.fillRect(0, 0, width, height);
    arena.obstacles.forEach((o) => disc(o, "black"));
    arena.holes.forEach((h) => disc(h, FIELD_COLOR));
    ctx.restore();

    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    if (field === "disc") {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, arena.yMax * scale, 0, 2 * Math.PI);
        ctx.stroke();
    } else {
        ctx.strokeRect(0, 0, width, height);
    }

    if (shot.length > 0) {
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 2;
        ctx.beginPath();
        shot.forEach((p, i) => (i === 0 ? ctx.moveTo(...toCanvas(p)) : ctx.lineTo(...toCanvas(p))));
        ctx.stroke();
    }

    arena.teams.forEach((team, t) => {
        const color = TEAM_COLORS[t % TEAM_COLORS.length];
        team.players.forEach((player, i) => {
            if (player.alive) {
                disc(player.shape, color);
                if (t === current && i === team.currentPlayer) {
                    const [x, y] = toCanvas(player.shape.pos);
                    ctx.strokeStyle = "black";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, player.shape.radius * scale + 3, 0, 2 * Math.PI);
                    ctx.stroke();
                }
            } else {
                // Dead players are crossed out.
                const [x, y] = toCanvas(player.shape.pos);
                const r = player.shape.radius * scale;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - r, y - r);
                ctx.lineTo(x + r, y + r);
                ctx.moveTo(x + r, y - r);
                ctx.lineTo(x - r, y + r);
                ctx.stroke();
            }
        });
    });
}
