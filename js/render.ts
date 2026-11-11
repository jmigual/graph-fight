// Canvas rendering of the board (ADR 17, section 4). Pure drawing: it reads the arena and never
// touches game state. Everything is in CSS pixels; the backing store follows devicePixelRatio.
import type { Arena, Point } from "../pkg/index.js";
import type { Field, Frame } from "./net";

/** Where a face looks: a unit world vector, and the side of its cap brim (1 right, -1 left). */
export type Look = { dir: Point; side: 1 | -1 };

/** An applied shot: the shooting team, its formula(s), its disc direction and its trajectory in world coordinates. */
export type LastShot = { team: number; exprs: string[]; cw: boolean; points: Point[] };

export type View = {
    field: Field;
    /** The game's shot frame (ADR 20): the grid shows the map's axes, or the current shooter's frame. */
    frame: Frame;
    arena: Arena;
    /** Team whose current player shoots, `null` when the game is over (the player frame's grid is then the map's). */
    current: number | null;
    /** The current shooter is ours: we show where its formula starts and which way it goes; on the disc our face looks there. */
    mine: boolean;
    /** The chosen disc direction (ADR 14); counter-clockwise when absent. */
    cw?: boolean;
    /** The newest shot: drawn with the pen, labelled, and at full weight. */
    shot: LastShot | null;
    /** Each player's last shot, keyed by `lookKey`; those of living players but the newest are drawn faint. */
    shots: Map<string, LastShot>;
    /** Gaze set by each player's last shot, keyed by `lookKey`; others look toward the centre. */
    looks: Map<string, Look>;
    /** Teams whose seat holder is disconnected (ADR 16). */
    absent: number[];
    /** Test arena (ADR 25): what the newest shot hit, players by `lookKey` and obstacles by index, ringed in `--danger`. */
    hits?: { players: string[]; obstacles: number[] };
    /** Test arena: the selected obstacle, ringed in `--mark`. */
    picked?: number;
};

// Used only when the stylesheet lacks a token: the light palette of ADR 17.
const FALLBACK: Record<string, string> = {
    paper: "#EEF4EF",
    ink: "#14302A",
    "ink-soft": "#4B655D",
    grid: "#CFE0D5",
    "grid-major": "#A3C2AE",
    obstacle: "#3A4743",
    mark: "#2347B5",
    danger: "#B42318",
    blood: "#B3171F",
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
/** A splat's unit in head radii: the heads are small on a wide board, and the splat must read beside them. */
const SPLAT_SIZE = 2.2;
/** How long the burst of a kill takes, from the pen reaching the player (ADR 34). */
const BURST_MS = 400;

type Colour = (token: string) => string;

export const lookKey = (team: number, player: number) => `${team}:${player}`;

/** The shots to draw faint: each living player's last one, except `newest` (ADR 17, section 4). */
export function olderPaths(shots: Map<string, LastShot>, arena: Arena, newest: LastShot | null): LastShot[] {
    return arena.teams.flatMap((t, ti) =>
        t.players.flatMap((pl, pi) => {
            const shot = shots.get(lookKey(ti, pi));
            return shot && shot !== newest && pl.alive ? [shot] : [];
        }),
    );
}

/** A blob of a splat, in splat units (`SPLAT_SIZE` head radii): its polar position about the player and its own radius. */
export type Droplet = { angle: number; dist: number; size: number };

/**
 * The shape of a kill's splat (ADR 34), the same for the same `seed`: a few big blobs near the
 * player and small droplets flung further out. Display only; the seed is the same on every peer.
 */
export function splatShape(seed: number): Droplet[] {
    // mulberry32: a few lines and enough for a doodle.
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: 13 }, (_, i) => {
        const big = i < 5;
        return {
            angle: ((i + 0.8 * next()) * 2 * Math.PI) / (big ? 5 : 8),
            dist: big ? 0.6 + 0.5 * next() : 1.7 + 1.5 * next(),
            size: big ? 0.5 + 0.3 * next() : 0.15 + 0.25 * next(),
        };
    });
}

const splats = new Map<number, Droplet[]>();

/**
 * Flat splat of a player of head radius `head` at (`x`, `y`) in `fill`. At `p` = 1 it is the lasting mark;
 * before that the blobs are on their way out from the player, fast first and settling (ADR 34).
 */
function splat(ctx: CanvasRenderingContext2D, fill: string, x: number, y: number, head: number, seed: number, p: number) {
    const r = SPLAT_SIZE * head;
    let drops = splats.get(seed);
    if (!drops) splats.set(seed, (drops = splatShape(seed)));
    const e = 1 - (1 - p) ** 3;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + 1.2 * r * e, y);
    ctx.arc(x, y, 1.2 * r * e, 0, 2 * Math.PI);
    for (const d of drops) {
        const [dx, dy] = [x + r * e * d.dist * Math.cos(d.angle), y - r * e * d.dist * Math.sin(d.angle)];
        ctx.moveTo(dx + r * d.size, dy);
        ctx.arc(dx, dy, r * d.size, 0, 2 * Math.PI);
    }
    ctx.fill();
}

/** `arena` with the players in `keys` (`lookKey`s) dead. */
function withDead(arena: Arena, keys: string[]): Arena {
    return { ...arena, teams: arena.teams.map((t, ti) => ({ ...t, players: t.players.map((pl, pi) => (keys.includes(lookKey(ti, pi)) ? { ...pl, alive: false } : pl)) })) };
}

/** Unit vector toward the centre for a player at `pos`: the player frame's +x (XY) or θ = 0 (disc), and the resting gaze. */
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

// The test arena (ADR 25): board coordinates, what a press is on, and a shot's words.
/** A hand-placed obstacle: its centre and radius, as `Game.sandbox` takes it. */
export type Disc = { x: number; y: number; r: number };
/** What a press on the board is on: a player as `[team, index]`, or an obstacle by index. */
export type Pick = { player: [number, number] } | { obstacle: number };

/** The world point under the CSS pixel (`x`, `y`) of a board `width` px wide: the inverse of `paint`'s mapping. */
export function toWorld(x: number, y: number, width: number, xMax: number, yMax: number): Point {
    const scale = width / (2 * xMax);
    return { x: x / scale - xMax, y: yMax - y / scale };
}

/**
 * What `p` is on: of the players (of `radius`) whose edge is within `slack` of it, the one with the
 * nearest centre; else the same among the obstacles; else `null`. Players are drawn above obstacles.
 */
export function pickAt(teams: Point[][], obstacles: Disc[], p: Point, radius: number, slack: number): Pick | null {
    const nearest = <T>(items: [T, Point, number][]) =>
        items
            .map(([item, q, r]) => [item, Math.hypot(q.x - p.x, q.y - p.y), r] as const)
            .filter(([, d, r]) => d - r <= slack)
            .sort((a, b) => a[1] - b[1])[0]?.[0];
    const player = nearest(teams.flatMap((spots, t) => spots.map((q, i): [[number, number], Point, number] => [[t, i], q, radius])));
    if (player) return { player };
    const obstacle = nearest(obstacles.map((o, i): [number, Point, number] => [i, o, o.r]));
    return obstacle === undefined ? null : { obstacle };
}

/** How the test arena names a player, 0-based indices in: "Team 1 player 2". */
export const playerName = (team: number, i: number) => `Team ${team + 1} player ${i + 1}`;

/** "a", "a and b", "a, b and c". */
const and = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** The words for a test shot, the board's text alternative: who fired what, whom it hit and where it stopped. */
export function describeTrial(field: Field, shooter: [number, number], exprs: string[], cw: boolean, hits: [number, number][], obstacles: number[]) {
    let text = `${playerName(...shooter)} fired ${shotText(field, exprs)}${field === "disc" ? (cw ? ", clockwise" : ", counterclockwise") : ""}.`;
    text += hits.length ? ` It hit ${and(hits.map(([t, i]) => playerName(t, i)))}.` : " It hit no player.";
    if (obstacles.length) text += ` It stopped in obstacle${obstacles.length > 1 ? "s" : ""} ${and(obstacles.map((i) => String(i + 1)))}.`;
    return text;
}

let frame = 0;
/** Settles the promise of the running animation. */
let settle = () => {};

/**
 * Draws `view` on `canvas`, which CSS sizes to the arena's ratio. With `before` (the board as it
 * was before the shot), `view.shot` is first drawn with a pen on that board, then the final frame
 * replaces it (ADR 17, section 5). Any later call cancels a running animation. The promise settles
 * once the final frame is drawn: when the pen and any kill bursts are done, or when a later call cancels the animation.
 */
export function draw(canvas: HTMLCanvasElement, view: View, before?: View): Promise<void> {
    cancelAnimationFrame(frame);
    settle();
    const shot = view.shot;
    if (!before || !shot || shot.points.length < 2) {
        paint(canvas, view, true);
        return Promise.resolve();
    }
    const points = shot.points;
    const length = [0];
    for (let i = 1; i < points.length; i++) length.push(length[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const total = length[length.length - 1];
    // Constant pen speed: 700 ms up to the arena's width, at most 1400 ms.
    const ms = 700 * Math.min(2, Math.max(1, total / (2 * view.arena.xMax)));
    // Players this shot kills burst when the pen first touches them (ADR 34); the last burst may outlast the pen.
    const kills: { key: string; at: number }[] = [];
    before.arena.teams.forEach((t, ti) =>
        t.players.forEach((pl, pi) => {
            if (!pl.alive || view.arena.teams[ti]?.players[pi]?.alive !== false) return;
            const { pos, radius } = pl.shape;
            const i = points.findIndex((q) => Math.hypot(q.x - pos.x, q.y - pos.y) <= radius);
            kills.push({ key: lookKey(ti, pi), at: i < 0 || total === 0 ? ms : (ms * length[i]) / total });
        }),
    );
    kills.sort((a, b) => a.at - b.at);
    const end = kills.reduce((m, k) => Math.max(m, k.at + BURST_MS), ms);
    const bursts = new Map<string, number>();
    let shown = before;
    let burst = 0;
    const start = performance.now();
    return new Promise((done) => {
        settle = done;
        const step = (now: number) => {
            const t = now - start;
            if (t >= end) {
                paint(canvas, view, true);
                return done();
            }
            const k = Math.min(1, t / ms);
            const n = k < 1 ? length.findIndex((l) => l > k * total) : points.length;
            const gone = burst;
            while (burst < kills.length && kills[burst].at <= t) burst++;
            if (burst !== gone) shown = { ...before, arena: withDead(before.arena, kills.slice(0, burst).map((q) => q.key)) };
            for (let i = 0; i < burst; i++) bursts.set(kills[i].key, Math.min(1, (t - kills[i].at) / BURST_MS));
            paint(canvas, { ...shown, shot: { ...shot, points: points.slice(0, n) } }, k >= 1, bursts);
            frame = requestAnimationFrame(step);
        };
        step(start);
    });
}

function paint(canvas: HTMLCanvasElement, view: View, labelled: boolean, bursts?: Map<string, number>) {
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
    // The map frame's paper is the map's axes; the player frame's follows the shooter (ADR 20).
    const map = view.frame === "map";
    const frame = map ? { x: 0, y: 0 } : origin;
    const forward = map ? { x: 1, y: 0 } : ahead(field, origin);
    const turn = view.cw ? -1 : 1;
    const aiming = view.mine && !!shooter;

    ctx.save();
    if (field === "disc") {
        circle(w / 2, h / 2, arena.yMax * scale);
        ctx.clip();
    }
    paper(ctx, colour, view, at, scale, frame, forward, w, h);
    axes(ctx, colour, text, rem, view, at, scale, frame, forward, w, h);
    // The splats of the dead, on the ground: over the paper, under the obstacles and the faces; a burst in progress is a smaller, scattering one (ADR 34).
    for (let ti = 0; ti < arena.teams.length; ti++) {
        arena.teams[ti].players.forEach((pl, pi) => {
            if (!pl.alive) splat(ctx, colour("blood"), ...at(pl.shape.pos), pl.shape.radius * scale, ti * 256 + pi, bursts?.get(lookKey(ti, pi)) ?? 1);
        });
    }
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
        paper(ctx, colour, view, at, scale, frame, forward, w, h);
        axes(ctx, colour, text, rem, view, at, scale, frame, forward, w, h);
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
    // Test arena: the obstacles the shot stopped in, and the selected one just outside.
    ctx.lineWidth = 2.5;
    arena.obstacles.forEach((o, i) => {
        const [x, y] = at(o.pos);
        for (const [token, gap, on] of [["danger", 3, view.hits?.obstacles.includes(i)], ["mark", 7, view.picked === i]] as const) {
            if (!on) continue;
            ctx.strokeStyle = colour(token);
            circle(x, y, o.radius * scale + gap);
            ctx.stroke();
        }
    });

    if (aiming && shooter && map && field === "xy") {
        // Our x, where y = f(x) starts, and the way x sweeps: toward the other half (ADR 20).
        const [, cy] = at({ x: 0, y: 0 });
        const [x, y] = at(origin);
        const gap = shooter.shape.radius * scale + 8;
        const dir = origin.x > 0 ? -1 : 1;
        // The x label goes on the far side of the axis from our face, clear of the face and, below
        // the axis, of the axis numbers (centred 10 px under it).
        const side = y < cy ? 1 : -1;
        const ly = side > 0 ? Math.max(cy + 30, y + gap + 6) : Math.min(cy - 14, y - gap - 6);
        ctx.strokeStyle = ctx.fillStyle = colour("ink-soft");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (Math.abs(y - cy) > gap) {
            ctx.moveTo(x, cy);
            ctx.lineTo(x, y + side * gap);
        }
        ctx.moveTo(x + dir * gap, y);
        ctx.lineTo(x + dir * (gap + 40), y);
        ctx.stroke();
        arrowhead(ctx, x + dir * (gap + 40), y, dir > 0 ? 0 : Math.PI);
        ctx.font = `italic 14px ${MATH_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        text(`x ≈ ${origin.x.toFixed(2)}`, x, ly, colour("ink-soft"), 3);
    }
    if (aiming && shooter && !map && field === "disc") {
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
    if (aiming && shooter && map && field === "disc") {
        // Our θ₀ (the map angle where θ starts) and which way θ sweeps from it (ADR 20): only the
        // shooter knows the direction. Canvas angles are world angles negated.
        const [cx, cy] = at({ x: 0, y: 0 });
        const [x, y] = at(origin);
        // Where the engine's θ₀ rounds up to exactly 2π (a hair below the +x axis), this shows 0.00.
        const theta0 = (Math.atan2(origin.y, origin.x) + 2 * Math.PI) % (2 * Math.PI);
        const dist = Math.hypot(x - cx, y - cy);
        const gap = shooter.shape.radius * scale + 8;
        const a = 1.5 * scale;
        ctx.strokeStyle = ctx.fillStyle = colour("ink-soft");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + ((x - cx) * (dist - gap)) / dist, cy + ((y - cy) * (dist - gap)) / dist);
        ctx.moveTo(cx + a, cy);
        ctx.arc(cx, cy, a, 0, -theta0, true);
        // The sweep: an arc about the centre just inside our face, from θ₀ the chosen way.
        const r = dist - gap;
        const end = -theta0 - (turn * 48) / r;
        ctx.moveTo(cx + r * Math.cos(theta0), cy - r * Math.sin(theta0));
        ctx.arc(cx, cy, r, -theta0, end, turn > 0);
        ctx.stroke();
        arrowhead(ctx, cx + r * Math.cos(end), cy + r * Math.sin(end), end - (turn * Math.PI) / 2);
        ctx.font = `italic 14px ${MATH_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        text(`θ₀ ≈ ${theta0.toFixed(2)}`, cx + (a + 36) * Math.cos(-theta0 / 2), cy + (a + 36) * Math.sin(-theta0 / 2), colour("ink-soft"), 3);
    }

    // Older paths: thinner and a quarter transparent, in the team colour, under the newest.
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.75;
    for (const old of olderPaths(view.shots, arena, view.shot)) {
        ctx.strokeStyle = colour(`team-${(old.team % 8) + 1}`);
        ctx.beginPath();
        old.points.forEach((p, i) => (i === 0 ? ctx.moveTo(...at(p)) : ctx.lineTo(...at(p))));
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

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
            if (ours && aiming && field === "disc") {
                // Toward θ's sweep: along our orbit about the centre (map frame), or the frame's
                // θ = 0 vector turned +90° or -90° (player frame).
                look = lookAlong(look, map ? { x: -turn * origin.y, y: turn * origin.x } : { x: -turn * forward.y, y: turn * forward.x });
            }
            const state = !player.alive ? "dead" : view.absent.includes(ti) ? "away" : "here";
            const [x, y] = at(player.shape.pos);
            const top = face(ctx, colour, x, y, player.shape.radius * scale, ti, look, state, ours, text);
            if (view.hits?.players.includes(lookKey(ti, pi))) {
                // Test arena: a ring around a player the shot hit.
                ctx.strokeStyle = colour("danger");
                ctx.lineWidth = 2.5;
                circle(x, y, player.shape.radius * scale + 8);
                ctx.stroke();
            }
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

/** Layers 1 and 2 without the axes: paper and the grid in the frame at `origin` (the centre or the shooter) facing `forward`. */
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

/** The axes through `origin`: +x and +y on XY, the θ = 0 ray on the disc, numbered 5, 10, 15; the map's disc also labels π/2, π, 3π/2. */
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
        if (view.frame === "map") {
            ["π/2", "π", "3π/2"].forEach((s, i) => {
                const a = ((i + 1) * Math.PI) / 2;
                text(s, ox + d * Math.cos(a), oy - d * Math.sin(a), ink, 3);
            });
        }
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
