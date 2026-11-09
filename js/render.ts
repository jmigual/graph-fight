// Canvas rendering of the board (ADR 17, section 4). Pure drawing: it reads the arena and never
// touches game state. Everything is in CSS pixels; the backing store follows devicePixelRatio.
import type { Arena, Point } from "../pkg/index.js";
import type { Field } from "./net";

/** Where a face looks: a unit world vector, and the side of its cap brim (1 right, -1 left). */
export type Look = { dir: Point; side: 1 | -1 };

/** The last applied shot: the shooting team, its formula(s) and its trajectory in world coordinates. */
export type LastShot = { team: number; exprs: string[]; points: Point[] };

export type View = {
    field: Field;
    arena: Arena;
    /** Team whose current player shoots; the grid is drawn in its frame. `null` when the game is over. */
    current: number | null;
    /** The current shooter is ours: on the disc we show which way θ grows and our face looks there. */
    mine: boolean;
    /** The chosen disc direction (ADR 14); counter-clockwise when absent. */
    cw?: boolean;
    shot: LastShot | null;
    /** Gaze set by each player's last shot, keyed by `lookKey`; others look toward the centre. */
    looks: Map<string, Look>;
    /** Teams whose seat holder is disconnected (ADR 16). */
    absent: number[];
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
const EYE_WHITE = "#FFFFFF";
const UI_FONT = '"Atkinson Hyperlegible Next", system-ui, sans-serif';
const MATH_FONT = '"STIX Two Text", "Cambria Math", "Times New Roman", serif';
/** Drawn head radius (CSS px) from which the full face is drawn. */
const FULL_FACE = 9;
const LABEL_MAX = 32;

type Colour = (token: string) => string;

export const lookKey = (team: number, player: number) => `${team}:${player}`;

/** Unit vector of the frame's +x (XY) or θ = 0 (disc) for a shooter at `pos`: toward the centre. */
function ahead(field: Field, pos: Point): Point {
    if (field === "xy") return { x: pos.x > 0 ? -1 : 1, y: 0 };
    const d = Math.hypot(pos.x, pos.y);
    return d === 0 ? { x: 1, y: 0 } : { x: -pos.x / d, y: -pos.y / d };
}

/** Looks along `dir`; the brim keeps its side while looking nearly straight up or down. */
function lookAlong(prev: Look, dir: Point): Look {
    const d = Math.hypot(dir.x, dir.y);
    const unit = { x: dir.x / d, y: dir.y / d };
    return { dir: unit, side: Math.abs(unit.x) < 0.25 ? prev.side : unit.x < 0 ? -1 : 1 };
}

const restLook = (field: Field, pos: Point) => lookAlong({ dir: { x: 1, y: 0 }, side: 1 }, ahead(field, pos));

/**
 * The shooter's gaze after firing `points` (ADR 17, section 4): from the first point to the first
 * one at least 0.5 units away, or the last. `undefined` (keep the gaze) when the shot has no heading.
 */
export function lookAfterShot(field: Field, prev: Look | undefined, points: Point[]): Look | undefined {
    if (points.length < 2) return undefined;
    const [a] = points;
    const b = points.find((p) => Math.hypot(p.x - a.x, p.y - a.y) >= 0.5) ?? points[points.length - 1];
    if (b.x === a.x && b.y === a.y) return undefined;
    return lookAlong(prev ?? restLook(field, a), { x: b.x - a.x, y: b.y - a.y });
}

/** A shot's formulas with the mode's variables, e.g. `y = 2*sin(x)` or `r = t, θ = 0.5`. */
export function shotText(field: Field, exprs: string[]): string {
    const names = field === "xy" ? (exprs.length === 1 ? ["y"] : ["x", "y"]) : exprs.length === 1 ? ["r"] : ["r", "θ"];
    return exprs.map((e, i) => `${names[i]} = ${e}`).join(", ");
}

/** The canvas label of a shot: its text cut to 32 characters. */
export function shotLabel(field: Field, exprs: string[]): string {
    const text = shotText(field, exprs);
    const chars = Array.from(text);
    return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX).join("")}…` : text;
}

let frame = 0;

/**
 * Draws `view` on `canvas`, which CSS sizes to the arena's ratio. With `before` (the board as it
 * was before the shot), `view.shot` is first drawn with a pen on that board, then the final frame
 * replaces it (ADR 17, section 5). Any later call cancels a running animation.
 */
export function draw(canvas: HTMLCanvasElement, view: View, before?: View) {
    cancelAnimationFrame(frame);
    const shot = view.shot;
    if (!before || !shot || shot.points.length < 2) return paint(canvas, view, true);
    const points = shot.points;
    const length = [0];
    for (let i = 1; i < points.length; i++) length.push(length[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const total = length[length.length - 1];
    // Constant pen speed: 700 ms up to the arena's width, at most 1400 ms.
    const ms = 700 * Math.min(2, Math.max(1, total / (2 * view.arena.xMax)));
    const start = performance.now();
    const step = (now: number) => {
        const k = (now - start) / ms;
        if (k >= 1) return paint(canvas, view, true);
        const n = length.findIndex((l) => l > k * total);
        paint(canvas, { ...before, shot: { ...shot, points: points.slice(0, n) } }, false);
        frame = requestAnimationFrame(step);
    };
    step(start);
}

function paint(canvas: HTMLCanvasElement, view: View, labelled: boolean) {
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
    const turn = view.cw ? -1 : 1;
    const aiming = field === "disc" && view.mine && !!shooter;

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

    if (aiming && shooter) {
        // Which way θ grows, and the π/2 ray that way: only the shooter knows the direction.
        const [x, y] = at(origin);
        const base = Math.atan2(-forward.y, forward.x);
        const r = Math.max(20, shooter.shape.radius * scale * 1.55 + 10);
        const end = base - turn * 1.2;
        ctx.strokeStyle = ctx.fillStyle = colour("ink-soft");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r, base - turn * 0.3, end, turn > 0);
        ctx.stroke();
        arrowhead(ctx, x + r * Math.cos(end), y + r * Math.sin(end), end - (turn * Math.PI) / 2);
        const quarter = base - (turn * Math.PI) / 2;
        ctx.font = `italic 14px ${MATH_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        text("π/2", x + (r + 18) * Math.cos(quarter), y + (r + 18) * Math.sin(quarter), colour("ink-soft"), 3);
    }

    const shot = view.shot;
    if (shot && shot.points.length > 0) {
        const ink = colour(`team-${(shot.team % 8) + 1}`);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        shot.points.forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
        ctx.stroke();
        if (labelled) {
            // Peer formulas reach the canvas only as text (fillText/strokeText).
            const label = shotLabel(field, shot.exprs);
            ctx.font = `italic 14px ${MATH_FONT}`;
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            const width = ctx.measureText(label).width;
            const [x, y] = at(shot.points[shot.points.length - 1]);
            text(label, clamp(x + 8, 6, w - width - 6), clamp(y - 8, 18, h - 6), ink, 4);
        }
    }

    const tags: [string, number, number, string][] = [];
    arena.teams.forEach((t, ti) =>
        t.players.forEach((player, pi) => {
            const ours = player === shooter;
            let look = view.looks.get(lookKey(ti, pi)) ?? restLook(field, player.shape.pos);
            if (ours && aiming) {
                // The θ = 0 vector turned +90° (counter-clockwise) or -90° (clockwise).
                look = lookAlong(look, { x: -turn * forward.y, y: turn * forward.x });
            }
            const state = !player.alive ? "dead" : view.absent.includes(ti) ? "away" : "here";
            const [x, y] = at(player.shape.pos);
            const top = face(ctx, colour, x, y, player.shape.radius * scale, ti, look, state, ours, text);
            tags.push([String(ti + 1), x, top, colour(`team-${(ti % 8) + 1}`)]);
        }),
    );
    // Number tags carry team identity on small screens: above every face and inside the canvas.
    ctx.font = `700 11px ${UI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const [s, x, y, fill] of tags) text(s, clamp(x, 8, w - 8), Math.max(y, 14), fill, 3);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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

/**
 * A player as an emoji-style face at its true hit radius `r` (ADR 17, section 4): team cap, a
 * mouth per team, eyes following `look`. Returns the y where its number tag sits.
 */
function face(ctx: CanvasRenderingContext2D, colour: Colour, x: number, y: number, r: number, team: number, look: Look, state: "here" | "away" | "dead", current: boolean, text: Text) {
    const full = r >= FULL_FACE;
    const lw = full ? 1.5 : 1;
    const line = colour("face-line");
    const cap = colour(`team-${(team % 8) + 1}`);
    const halo = r + lw / 2 + 1.5;
    const ring = halo + 3 + 1;
    const s = look.side;
    const [gx, gy] = [look.dir.x, -look.dir.y];
    const outline = () => {
        ctx.strokeStyle = line;
        ctx.lineWidth = lw;
        ctx.stroke();
    };

    ctx.fillStyle = colour("paper");
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, 2 * Math.PI);
    ctx.fill();
    if (current) {
        ctx.strokeStyle = colour("ink");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, ring, 0, 2 * Math.PI);
        ctx.stroke();
    }

    const faded = state === "dead" ? 0.4 : 1;
    ctx.globalAlpha = faded;
    ctx.fillStyle = colour("face");
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    outline();
    ctx.globalAlpha = 1;

    // Cap: a brim toward the gaze's side, under a dome over the top 40 % of the head.
    const capY = y - 0.2 * r;
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(x + s * 0.75 * r, capY, 0.8 * r, Math.max(1, 0.13 * r), 0, 0, 2 * Math.PI);
    ctx.fill();
    outline();
    const a = Math.asin(0.2);
    ctx.beginPath();
    ctx.arc(x, y, r, Math.PI + a, -a);
    ctx.closePath();
    ctx.fill();
    outline();

    ctx.globalAlpha = faded;
    ctx.strokeStyle = ctx.fillStyle = line;
    ctx.lineWidth = lw;
    const shift = 0.1 * r * gx;
    const er = 0.2 * r;
    const ey = y + 0.15 * r;
    const eyes = [x - 0.35 * r + shift, x + 0.35 * r + shift];
    ctx.beginPath();
    for (const ex of eyes) {
        if (state === "dead") {
            const d = 0.8 * er;
            ctx.moveTo(ex - d, ey - d);
            ctx.lineTo(ex + d, ey + d);
            ctx.moveTo(ex + d, ey - d);
            ctx.lineTo(ex - d, ey + d);
        } else if (state === "away") {
            ctx.moveTo(ex - er, ey + 0.2 * er);
            ctx.lineTo(ex + er, ey + 0.2 * er);
        }
    }
    ctx.stroke();
    if (state === "here") {
        for (const ex of eyes) {
            if (full) {
                ctx.fillStyle = EYE_WHITE;
                ctx.beginPath();
                ctx.arc(ex, ey, er, 0, 2 * Math.PI);
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = line;
            }
            ctx.beginPath();
            ctx.arc(ex + 0.4 * er * gx, ey + 0.4 * er * gy, Math.max(1, 0.5 * er), 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    // Team 8's brows, below the brim and over the eye tops: two V strokes, one V line when small.
    if (team % 8 === 7 && state !== "dead") {
        ctx.lineWidth = 1.5 * lw;
        ctx.beginPath();
        const [l, rr] = eyes;
        if (full) {
            ctx.moveTo(l - 1.2 * er, ey - 1.1 * er);
            ctx.lineTo(l + 0.9 * er, ey - 0.4 * er);
            ctx.moveTo(rr + 1.2 * er, ey - 1.1 * er);
            ctx.lineTo(rr - 0.9 * er, ey - 0.4 * er);
        } else {
            ctx.moveTo(l - er, ey - 1.1 * er);
            ctx.lineTo((l + rr) / 2, ey - 0.2 * er);
            ctx.lineTo(rr + er, ey - 1.1 * er);
        }
        ctx.stroke();
    }

    mouth(ctx, state === "dead" ? 2 : team % 8, x + shift, y + 0.6 * r, r, s, lw, line, cap);
    ctx.globalAlpha = 1;

    if (state === "away" && full) {
        ctx.font = `700 ${Math.max(9, 0.7 * r)}px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        text("z", x - s * r, y - 0.7 * r, colour("ink"), 2);
    }
    return y - (current ? ring + 1 : halo);
}

/** The mouth of team `kind` (0-based, ADR 17 table) centred at (`x`, `y`); kind 2 is the flat line. */
function mouth(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, r: number, side: number, lw: number, line: string, cap: string) {
    const hw = 0.25 * r;
    ctx.lineWidth = lw;
    ctx.strokeStyle = ctx.fillStyle = line;
    ctx.beginPath();
    switch (kind) {
        case 0: // grin: a filled D
            ctx.moveTo(x - hw, y - 0.1 * r);
            ctx.arc(x, y - 0.1 * r, hw, Math.PI, 0, true);
            ctx.closePath();
            ctx.fill();
            return;
        case 1: // smirk, raised on the gaze side
            ctx.moveTo(x - side * hw, y);
            ctx.quadraticCurveTo(x, y + 0.1 * r, x + side * hw, y - 0.12 * r);
            break;
        case 2: // calm
            ctx.moveTo(x - hw, y);
            ctx.lineTo(x + hw, y);
            break;
        case 3: // surprised: an O
            ctx.arc(x, y, Math.max(1, 0.12 * r), 0, 2 * Math.PI);
            break;
        case 4: // grimace: a box with a teeth line
            ctx.rect(x - hw, y - 0.16 * r, 2 * hw, 0.32 * r);
            ctx.fillStyle = EYE_WHITE;
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.moveTo(x - hw, y);
            ctx.lineTo(x + hw, y);
            break;
        case 5: // frown
            ctx.arc(x, y + 0.2 * r, hw, Math.PI + 0.5, 2 * Math.PI - 0.5);
            break;
        case 6: // tongue out: a smile with a tongue in the team colour
            ctx.arc(x, y - 0.2 * r, hw, 0.5, Math.PI - 0.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x + 0.06 * r, y + 0.03 * r, Math.max(1, 0.17 * r), 0, Math.PI);
            ctx.closePath();
            ctx.fillStyle = cap;
            ctx.fill();
            ctx.lineWidth = 1;
            break;
        default: // determined: a short flat mouth
            ctx.moveTo(x - 0.6 * hw, y);
            ctx.lineTo(x + 0.6 * hw, y);
    }
    ctx.stroke();
}
