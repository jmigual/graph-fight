// Canvas rendering of the board (ADR 17, section 4). Pure drawing: it reads the arena and never
// touches game state. Everything is in CSS pixels; the backing store follows devicePixelRatio.
import type { Arena, Point } from "../pkg/index.js";
import type { Field } from "./net";

/** The last applied shot: the shooting team, its formula(s) and its trajectory in world coordinates. */
export type LastShot = { team: number; exprs: string[]; points: Point[] };

export type View = {
    field: Field;
    arena: Arena;
    /** Team whose current player shoots; the grid is drawn in its frame. `null` when the game is over. */
    current: number | null;
    shot: LastShot | null;
};

// Used only when the stylesheet lacks a token: the light palette of ADR 17.
const FALLBACK: Record<string, string> = {
    paper: "#EEF4EF",
    ink: "#14302A",
    "ink-soft": "#4B655D",
    grid: "#CFE0D5",
    "grid-major": "#A3C2AE",
    obstacle: "#3A4743",
    face: "#FFD54A",
    "face-line": "#2B2118",
    "team-1": "#C2410C",
    "team-2": "#0B63B0",
    "team-3": "#00775A",
    "team-4": "#A63D8A",
    "team-5": "#806200",
    "team-6": "#8B4A1C",
    "team-7": "#6B46C1",
    "team-8": "#4F6F00",
};
const UI_FONT = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
const MATH_FONT = '"STIX Two Text", "Cambria Math", "Times New Roman", serif';

type Colour = (token: string) => string;

/** Unit vector of the frame's +x (XY) or θ = 0 (disc) for a shooter at `pos`: toward the centre. */
function ahead(field: Field, pos: Point): Point {
    if (field === "xy") return { x: pos.x > 0 ? -1 : 1, y: 0 };
    const d = Math.hypot(pos.x, pos.y);
    return d === 0 ? { x: 1, y: 0 } : { x: -pos.x / d, y: -pos.y / d };
}

/** Draws `view` on `canvas`, which CSS sizes to the arena's ratio (ADR 17, section 4). */
export function draw(canvas: HTMLCanvasElement, view: View) {
    const ctx = canvas.getContext("2d");
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!ctx || !w || !h) return;
    const dpr = devicePixelRatio || 1;
    const [bw, bh] = [Math.round(w * dpr), Math.round(h * dpr)];
    if (canvas.width !== bw || canvas.height !== bh) [canvas.width, canvas.height] = [bw, bh];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = ctx.lineJoin = "round";

    const css = getComputedStyle(document.documentElement);
    const colour: Colour = (token) => css.getPropertyValue(`--${token}`).trim() || FALLBACK[token];
    const rem = parseFloat(css.fontSize) || 16;
    const { field, arena } = view;
    const scale = w / (2 * arena.xMax);
    // World y points up, canvas y points down.
    const at = (p: Point): [number, number] => [(p.x + arena.xMax) * scale, (arena.yMax - p.y) * scale];
    const circle = (x: number, y: number, r: number) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
    };
    const text = (s: string, x: number, y: number, fill: string, halo: number) => {
        ctx.strokeStyle = colour("paper");
        ctx.lineWidth = 2 * halo;
        ctx.strokeText(s, x, y);
        ctx.fillStyle = fill;
        ctx.fillText(s, x, y);
    };

    const team = view.current === null ? null : arena.teams[view.current];
    const shooter = team?.players[team.currentPlayer];
    const origin = shooter?.shape.pos ?? { x: 0, y: 0 };
    const forward = ahead(field, origin);

    ctx.save();
    if (field === "disc") {
        circle(w / 2, h / 2, arena.yMax * scale);
        ctx.clip();
    }
    paper(ctx, colour, view, at, scale, origin, forward, w, h);
    axes(ctx, colour, text, rem, view, at, scale, origin, forward, w, h);
    ctx.fillStyle = colour("obstacle");
    for (const o of arena.obstacles) {
        circle(...at(o.pos), o.radius * scale);
        ctx.fill();
    }
    // Craters are erased: paper and grid show through.
    if (arena.holes.length > 0) {
        ctx.save();
        ctx.beginPath();
        for (const c of arena.holes) {
            const [x, y] = at(c.pos);
            ctx.moveTo(x + c.radius * scale, y);
            ctx.arc(x, y, c.radius * scale, 0, 2 * Math.PI);
        }
        ctx.clip();
        paper(ctx, colour, view, at, scale, origin, forward, w, h);
        axes(ctx, colour, text, rem, view, at, scale, origin, forward, w, h);
        ctx.restore();
    }
    ctx.restore();

    ctx.strokeStyle = colour("ink");
    ctx.lineWidth = 2;
    if (field === "disc") {
        circle(w / 2, h / 2, arena.yMax * scale - 1);
        ctx.stroke();
    } else {
        ctx.strokeRect(1, 1, w - 2, h - 2);
    }

    const shot = view.shot;
    if (shot && shot.points.length > 0) {
        const ink = colour(`team-${(shot.team % 8) + 1}`);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        shot.points.forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
        ctx.stroke();
    }

    arena.teams.forEach((t, ti) =>
        t.players.forEach((player) => {
            const [x, y] = at(player.shape.pos);
            const r = player.shape.radius * scale;
            ctx.fillStyle = colour(`team-${(ti % 8) + 1}`);
            ctx.strokeStyle = colour("face-line");
            ctx.lineWidth = 1.5;
            circle(x, y, r);
            ctx.globalAlpha = player.alive ? 1 : 0.4;
            ctx.fill();
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (player === shooter) {
                ctx.strokeStyle = colour("ink");
                ctx.lineWidth = 2;
                circle(x, y, r + 4);
                ctx.stroke();
            }
        }),
    );
}

type At = (p: Point) => [number, number];
type Text = (s: string, x: number, y: number, fill: string, halo: number) => void;

/** Layers 1 and 2 without the axes: paper and the grid in the shooter's frame. */
function paper(ctx: CanvasRenderingContext2D, colour: Colour, view: View, at: At, scale: number, origin: Point, forward: Point, w: number, h: number) {
    const { arena } = view;
    ctx.fillStyle = colour("paper");
    ctx.fillRect(0, 0, w, h);
    const [ox, oy] = at(origin);
    ctx.lineWidth = 1;
    for (const major of [false, true]) {
        ctx.beginPath();
        if (view.field === "xy") {
            for (let k = Math.ceil(-arena.xMax - origin.x); k <= arena.xMax - origin.x; k++) {
                if ((k % 5 === 0) !== major) continue;
                ctx.moveTo(ox + k * scale, 0);
                ctx.lineTo(ox + k * scale, h);
            }
            for (let k = Math.ceil(-arena.yMax - origin.y); k <= arena.yMax - origin.y; k++) {
                if ((k % 5 === 0) !== major) continue;
                ctx.moveTo(0, oy - k * scale);
                ctx.lineTo(w, oy - k * scale);
            }
        } else {
            const reach = Math.hypot(origin.x, origin.y) + arena.yMax;
            for (let k = 1; k <= reach; k++) {
                if ((k % 5 === 0) !== major) continue;
                ctx.moveTo(ox + k * scale, oy);
                ctx.arc(ox, oy, k * scale, 0, 2 * Math.PI);
            }
            if (!major) {
                const base = Math.atan2(-forward.y, forward.x);
                for (let i = 1; i < 12; i++) {
                    ctx.moveTo(ox, oy);
                    ctx.lineTo(ox + reach * scale * Math.cos(base + (i * Math.PI) / 6), oy + reach * scale * Math.sin(base + (i * Math.PI) / 6));
                }
            }
        }
        ctx.strokeStyle = colour(major ? "grid-major" : "grid");
        ctx.stroke();
    }
}

/** The axes through the shooter: +x and +y on XY, the θ = 0 ray on the disc, numbered 5, 10, 15. */
function axes(ctx: CanvasRenderingContext2D, colour: Colour, text: Text, rem: number, view: View, at: At, scale: number, origin: Point, forward: Point, w: number, h: number) {
    const [ox, oy] = at(origin);
    const ink = colour("ink-soft");
    const [fx, fy] = [forward.x, -forward.y];
    ctx.strokeStyle = ctx.fillStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let reach: number;
    if (view.field === "xy") {
        reach = fx > 0 ? w - ox : ox;
        ctx.moveTo(0, oy);
        ctx.lineTo(w, oy);
        ctx.moveTo(ox, h);
        ctx.lineTo(ox, 0);
        ctx.stroke();
        arrowhead(ctx, fx > 0 ? w - 3 : 3, oy, fx > 0 ? 0 : Math.PI);
        arrowhead(ctx, ox, 3, -Math.PI / 2);
    } else {
        reach = (Math.hypot(origin.x, origin.y) + view.arena.yMax) * scale - 3;
        ctx.moveTo(ox, oy);
        ctx.lineTo(ox + fx * reach, oy + fy * reach);
        ctx.stroke();
        arrowhead(ctx, ox + fx * reach, oy + fy * reach, Math.atan2(fy, fx));
    }
    // Numbers sit beside the axis, on its lower side.
    const [nx, ny] = fx > 0 || (fx === 0 && fy > 0) ? [-fy, fx] : [fy, -fx];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${0.8 * rem}px ${UI_FONT}`;
    // On the disc the end of the axis is kept for the θ = 0 label.
    const free = reach - (view.field === "disc" ? 56 : 12);
    for (const k of [5, 10, 15]) {
        if (k * scale > free) break;
        text(String(k), ox + fx * k * scale + nx * 10, oy + fy * k * scale + ny * 10, ink, 2);
    }
    if (view.field === "disc") {
        ctx.font = `italic 14px ${MATH_FONT}`;
        const d = reach - 28;
        text("θ = 0", ox + fx * d + nx * 12, oy + fy * d + ny * 12, ink, 3);
    }
}

function arrowhead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) {
    const [l, s] = [9, 4];
    const [c, n] = [Math.cos(angle), Math.sin(angle)];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - l * c - s * n, y - l * n + s * c);
    ctx.lineTo(x - l * c + s * n, y - l * n - s * c);
    ctx.closePath();
    ctx.fill();
}
