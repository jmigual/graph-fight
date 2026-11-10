// The game: turn loop, shots, bots, restore and the per-character shot memory, and the end screen
// (ADR 7, 12, 14, 15, 16, 17, 21, 22).
import { Bot, Field as WasmField, Frame as WasmFrame, Game as Sim, Level } from "../pkg/index.js";
import type { BotShot } from "../pkg/index.js";
import { parseItem } from "./library";
import starters from "./starters.json" with { type: "json" };
import { DEFAULT_K, isLocal, parseBot, selfId } from "./net";
import type { Field, Frame, GameMsg, Shot, Start } from "./net";
import { $, show } from "./dom";
import { initArena } from "./arena";
import { initEditor, sliderError } from "./editor";
import { draw, lookAfterShot, lookKey, olderPaths } from "./render";
import type { LastShot, Look, View } from "./render";
import { aliveCounts, clearError, cueTurn, describeTurn, ourWin, renderRoster, renderStatus, setText, showError } from "./status";
import { dropSeat, HOST_LEFT, hostId, me, room, SEAT_KEY } from "./index";

const TURN_MS = 60_000;
const PLAYER_RADIUS = 0.3;
const BOT_LEVELS = { easy: Level.Easy, medium: Level.Medium, hard: Level.Hard };
/** The templates bots search: the starters (ADR 17, section 8), checked like a saved list. */
const BOT_TEMPLATES = starters.flatMap((s) => parseItem(s) ?? []);
/** How long a bot searches before it yields to the page (ADR 21). */
const BOT_SLICE_MS = 10;
/** A bot fires no sooner than this after its turn starts, so the others can follow the game. */
const BOT_MIN_MS = 1500;
// Arena constants are compiled into the bundle, so they never travel (ADR 8, 15).
const ARENAS = {
    xy: { x: 20, y: 10, obstacles: 30, minSize: 0.2, maxSize: 2 },
    disc: { x: 10, y: 10, obstacles: 20, minSize: 0.2, maxSize: 1.5 },
};

type Play = {
    sim: Sim;
    /** The game's `start.seed`, which tells two games of one host apart. */
    seed: string;
    field: Field;
    frame: Frame;
    /** `peers[i]` plays team `i`. */
    peers: string[];
    /** Number of applied shots and timeouts. */
    turn: number;
    shot: LastShot | null;
    /** What the last message did, in words: the text alternative of the board (ADR 17). */
    note: string;
    /** Display only, never in `__state`: each player's gaze after its last shot (ADR 17). */
    looks: Map<string, Look>;
    /** Each player's last shot, keyed by `lookKey`: its path stays on the board and its formula refills the editor on its next turn. */
    shots: Map<string, LastShot>;
    /** The board as last drawn, where the next shot's animation starts. */
    view?: View;
    /**
     * Turn starts so far: the start, each shot and timeout, and each leave that passes the turn on.
     * Unlike `turn`, it moves when a quit or a kick hands the turn to the next team; a replay counts
     * the same starts again in the same order.
     */
    starts: number;
    /** Our shot is sent and not yet applied. */
    pending: boolean;
    over: boolean;
    deadline: number;
    clock?: ReturnType<typeof setTimeout>;
};

export let play: Play | null = null;
/** Set by the first end message, which stays: later ones (host left after a win) are ignored. */
export let ended = false;
/**
 * The game (its `start.seed`) and the last turn start (`Play.starts`) that ran `restore`, kept across
 * `startGame`: a rejoin replays the same `start` and turns we already lived, and must not overwrite
 * what we typed since. Another game, even from the same host, starts afresh.
 */
let restored = { seed: "", starts: 0 };

function startGame(msg: Start) {
    if (!msg.peers.includes(me)) {
        // Our stored seat is from an earlier game in this room (the host hosted again): drop it,
        // we may hold a fresh seat under our own id.
        dropSeat();
    }
    if (!msg.peers.includes(me)) return end("Game full.", "The host started with the seats already taken.");
    const a = ARENAS[msg.field];
    let sim: Sim;
    try {
        sim = new Sim(msg.field === "xy" ? WasmField.Xy : WasmField.Disc, msg.frame === "map" ? WasmFrame.Map : WasmFrame.Player, a.x, a.y, a.obstacles, a.minSize, a.maxSize, new Uint32Array(msg.peers.length).fill(DEFAULT_K), PLAYER_RADIUS, BigInt(msg.seed));
    } catch (err) {
        return end("Could not start the game.", `${err}`);
    }
    $("game").dataset.field = msg.field;
    // The direction is shown on the disc only and starts counter-clockwise in every game (ADR 17).
    $("direction").hidden = msg.field !== "disc";
    $<HTMLInputElement>("dir-ccw").checked = true;
    play = { sim, seed: msg.seed, field: msg.field, frame: msg.frame, peers: msg.peers, turn: 0, shot: null, note: "", looks: new Map(), shots: new Map(), starts: 0, pending: false, over: false, deadline: 0 };
    setMode();
    show("game");
    changed(play, true);
}

/** Host: relays `shot` if `from` is the current team's seat and the shot is for the current turn (ADR 12). */
export function acceptShot(from: string, shot: Shot) {
    if (play && !play.over && from === play.peers[play.sim.get_current_team_idx()] && shot.turn === play.turn) room?.relay(shot);
}

/**
 * Host: if the current team is a bot's, searches its shot on the bot's own copy of the game in
 * `BOT_SLICE_MS` slices, and sends it like a remote request once `BOT_MIN_MS` have passed since the
 * turn started. It gives up when the game or the turn moves on meanwhile (ADR 21).
 */
async function playBot(p: Play) {
    const id = p.peers[p.sim.get_current_team_idx()];
    const level = parseBot(id)?.level;
    if (!level) return;
    const turn = p.turn;
    const due = Date.now() + BOT_MIN_MS;
    const live = () => play === p && !p.over && p.turn === turn;
    const bot = new Bot(p.sim, BOT_LEVELS[level], BOT_TEMPLATES);
    try {
        let shot: BotShot | undefined;
        while (!shot) {
            if (!live()) return;
            const until = performance.now() + BOT_SLICE_MS;
            do {
                shot = bot.think(1);
            } while (!shot && performance.now() < until);
            if (!shot) await yieldToPage();
        }
        await new Promise((ok) => setTimeout(ok, due - Date.now()));
        if (live()) acceptShot(id, { type: "shot", turn, exprs: shot.exprs as Shot["exprs"], cw: shot.cw });
    } finally {
        bot.free();
    }
}

/** Lets the page handle its events. A message, unlike a timer, is not throttled in a hidden tab. */
function yieldToPage() {
    return new Promise<void>((ok) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => {
            port1.close();
            ok();
        };
        port2.postMessage(null);
    });
}

/** The host owns the turn clock (ADR 12); everyone shows a countdown from the same event. */
function resetClock(p: Play) {
    clearTimeout(p.clock);
    p.deadline = Date.now() + TURN_MS;
    const turn = p.turn;
    if (hostId === selfId) p.clock = setTimeout(() => room?.relay({ type: "timeout", turn }), TURN_MS);
}

export function onMessage(msg: GameMsg) {
    if (ended) return; // a replay after the end must not restart the game
    // A later start opens the host's replay (ADR 16): the game is rebuilt from it.
    if (msg.type === "start") return startGame(msg);
    const p = play;
    if (!p || p.over) return;
    // A leave from a peer without a seat changes nothing. One from a seated peer only restarts the
    // clock when it passes the turn on, so joining and leaving cannot stall the shooter.
    let newTurn = true;
    try {
        if (msg.type === "leave") {
            if (msg.peer === hostId) return end(...HOST_LEFT);
            const team = p.peers.indexOf(msg.peer);
            if (team < 0) return;
            const before = p.sim.get_current_team_idx();
            p.sim.eliminate_team(team);
            newTurn = p.sim.get_current_team_idx() !== before;
            p.note = `Team ${team + 1} left the game.`;
        } else {
            p.turn++;
            p.pending = false;
            p.shot = null;
            const team = p.sim.get_current_team_idx();
            const alive = aliveCounts(p.sim.arena());
            const key = lookKey(team, p.sim.arena().teams[team].currentPlayer);
            // Only the engine call is in here: anything else failing must not skip a second turn.
            try {
                if (msg.type === "timeout") p.sim.skip_turn();
                else p.shot = { team, exprs: msg.exprs, cw: msg.cw, points: (msg.exprs.length === 1 ? p.sim.fire(msg.exprs[0], msg.cw) : p.sim.fire_param(msg.exprs[0], msg.exprs[1], msg.cw)).points };
            } catch {
                // Every peer parses identically, so a shot that fails here fails everywhere (ADR 7, 14).
                p.sim.skip_turn();
            }
            if (p.shot) {
                const look = lookAfterShot(p.field, p.looks.get(key), p.shot.points);
                if (look) p.looks.set(key, look);
                p.shots.set(key, p.shot);
            }
            p.note = describeTurn(p.field, team, msg, !!p.shot, alive, aliveCounts(p.sim.arena()));
        }
    } catch (err) {
        // The engine itself failed, so this peer's state can no longer be trusted.
        return end("Engine error.", `${err}. This game can't continue on this device.`);
    }
    changed(p, newTurn);
}

/** Puts the formulas, mode and disc direction of a character's last shot back in the editor. */
function restore(shot: LastShot) {
    $<HTMLInputElement>(shot.exprs.length === 2 ? "mode-parametric" : "mode-explicit").checked = true;
    $<HTMLInputElement>(shot.cw ? "dir-cw" : "dir-ccw").checked = true;
    $<HTMLInputElement>("input-a").value = shot.exprs[0];
    $<HTMLInputElement>("input-b").value = shot.exprs[1] ?? "";
    setMode();
}

/** After any applied message: end the game if it is decided, otherwise (on a new turn) restart the clock. */
function changed(p: Play, newTurn: boolean) {
    const winner = p.sim.winner();
    if (winner !== undefined) {
        const id = p.peers[winner];
        return end(playsHere(id) ? ourWin(id, hotSeat(p)) : `Team ${winner + 1} wins.`);
    }
    if (p.sim.arena().teams.every((t) => t.players.every((pl) => !pl.alive))) return end("Draw.", "Nobody is left.");
    if (newTurn) {
        p.starts++;
        clearError();
        resetClock(p);
        // Our turn starts (or a local player's): say so to screen readers, and on a device with a keyboard put the cursor in the formula (ADR 17, 22).
        const team = p.sim.get_current_team_idx();
        const mine = playsHere(p.peers[team]);
        cueTurn(mine ? p.peers[team] : null, hotSeat(p));
        // Our character's last formula comes back (each local player's own, since characters are per team); one that has not fired leaves the editor as it is.
        const last = mine && p.shots.get(lookKey(team, p.sim.arena().teams[team].currentPlayer));
        const fresh = p.seed !== restored.seed || p.starts > restored.starts;
        if (fresh) restored = { seed: p.seed, starts: p.starts };
        if (last && fresh) restore(last);
        if (mine && matchMedia("(pointer: fine)").matches) $("input-a").focus();
        if (hostId === selfId) void playBot(p);
    }
    refresh(p);
}

/** This page plays seat `id`: it is ours, or we host and it is a local player's (ADR 22). */
const playsHere = (id: string) => id === me || (hostId === selfId && isLocal(id));
/** We host a game with local players: several people share this screen, so the host's own turn is named too (ADR 22). */
const hotSeat = (p: Play) => hostId === selfId && p.peers.some(isLocal);

export function refresh(p: Play) {
    const team = p.sim.get_current_team_idx();
    const mine = playsHere(p.peers[team]);
    const view: View = { field: p.field, frame: p.frame, arena: p.sim.arena(), current: p.over ? null : team, mine, cw: clockwise(), shot: p.shot, shots: new Map(p.shots), looks: new Map(p.looks), absent: absentTeams(p) };
    // A new shot is drawn with a pen on the board as it was, unless motion is reduced (ADR 17).
    const animate = p.view && p.shot && p.shot !== p.view.shot && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw($<HTMLCanvasElement>("arena"), view, animate ? p.view : undefined);
    p.view = view;
    renderStatus({ over: p.over, team, seat: p.peers[team], mine, hotSeat: hotSeat(p), hostDown: hostLinkDown(), away: !mine && view.absent.includes(team) });
    setText($("last-shot"), p.note);
    // The editor goes once every team played here is out.
    const out = !p.over && p.peers.every((id, t) => !playsHere(id) || view.arena.teams[t].players.every((pl) => !pl.alive));
    $("shot-form").hidden = out;
    $("out-note").hidden = !out;
    renderRoster(view.arena, p.peers, me, view.current, view.absent, mine, hostId === selfId && !p.over ? (team) => kickTeam(p, team) : undefined);
    $<HTMLButtonElement>("fire").disabled = p.over || p.pending || !mine || hostLinkDown();
}

/** Host: once confirmed, removes the guest playing `team`; the team is out as after a quit (ADR 23). */
function kickTeam(p: Play, team: number) {
    if (confirm(`Kick Team ${team + 1}? Their team will be out.`)) room?.kick(p.peers[team]);
}

/** We are a guest and our link to the host is down (ADR 16): the board is frozen until the replay arrives. */
const hostLinkDown = () => hostId !== selfId && !!room?.absent().includes(hostId);

/** Teams whose seat this page knows is disconnected (ADR 16). */
const absentTeams = (p: Play) => (room && !p.over ? room.absent().map((id) => p.peers.indexOf(id)).filter((t) => t >= 0) : []);

// The board redraws when its size, the pixel ratio, the colour scheme or the fonts change (ADR 17),
// which also ends a running shot animation on its final frame.
const redraw = () => (play?.view ? draw($<HTMLCanvasElement>("arena"), play.view) : testArena.redraw());
new ResizeObserver(redraw).observe($("arena"));
// A query for the current ratio fires once when it changes (another screen, zoom), then re-arms.
function watchRatio() {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => (redraw(), watchRatio()), { once: true });
}
watchRatio();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
document.fonts.addEventListener("loadingdone", redraw);

export function end(headline: string, detail = "") {
    if (ended) return;
    ended = true;
    sessionStorage.removeItem(SEAT_KEY);
    cueTurn(null, false);
    if (play) {
        play.over = true;
        clearTimeout(play.clock);
        refresh(play);
    }
    // Leave the room, or the host's next game there would seat this page, and a guest would keep
    // rejoining a gone host (ADR 18). The host stays so its last broadcast is not cut off.
    if (!play || hostId !== selfId) room?.leave();
    $("end-message").textContent = headline;
    $("end-detail").textContent = detail;
    show(...(play ? ["game", "end"] : ["end"]));
    $("end-message").focus();
}

for (const id of ["input-a", "input-b"]) $(id).addEventListener("input", clearError);

const clockwise = () => $<HTMLInputElement>("dir-cw").checked;
document.querySelectorAll("input[name=dir]").forEach((el) => ((el as HTMLInputElement).onchange = () => play && refresh(play)));
const parametric = () => $<HTMLInputElement>("mode-parametric").checked;
const editor = initEditor();
// The offline test arena (ADR 25) shares the game's board and editor.
export const testArena = initArena(editor, show, ARENAS, PLAYER_RADIUS);
function setMode() {
    if (play) editor.refresh(play.field, parametric());
}
document.querySelectorAll("input[name=mode]").forEach((el) => ((el as HTMLInputElement).onchange = setMode));

$<HTMLFormElement>("shot-form").onsubmit = (e) => {
    e.preventDefault();
    const p = play;
    if (!p || !room || $<HTMLButtonElement>("fire").disabled) return;
    const a = $<HTMLInputElement>("input-a").value;
    const b = $<HTMLInputElement>("input-b").value;
    const exprs: Shot["exprs"] = parametric() ? [a, b] : [a];
    clearError();
    const unfilled = sliderError(exprs);
    if (unfilled) {
        showError(unfilled);
        return;
    }
    try {
        // The shooter checks locally, so a bad formula never costs the turn (ADR 14).
        if (exprs.length === 1) p.sim.check(exprs[0]);
        else p.sim.check_param(exprs[0], exprs[1]);
        p.pending = true;
        // The host applies its own shot inside `shoot`, and that refresh starts the pen. A redraw
        // after it would end the animation on its final frame, so only Fire is disabled here.
        $<HTMLButtonElement>("fire").disabled = true;
        const shot: Shot = { type: "shot", turn: p.turn, exprs, cw: p.field === "disc" && clockwise() };
        // A local player's shot goes through the same check as a remote request, for its own seat (ADR 22).
        const seat = p.peers[p.sim.get_current_team_idx()];
        if (isLocal(seat)) acceptShot(seat, shot);
        else room.shoot(shot);
    } catch (err) {
        p.pending = false;
        showError(String(err));
        refresh(p);
    }
};

setInterval(() => {
    const p = play;
    const left = p && !p.over ? Math.max(0, p.deadline - Date.now()) : 0;
    $("countdown").textContent = p && !p.over ? String(Math.ceil(left / 1000)) : "";
    $("timer").classList.toggle("low", !!p && !p.over && left <= 10_000);
    $("timer-fill").style.width = `${(100 * left) / TURN_MS}%`;
    if (p?.view && String(absentTeams(p)) !== String(p.view.absent)) refresh(p);
}, 250);

// Read-only hook for the end-to-end tests: the state every peer must agree on (`me` is ours);
// `faint` counts the older paths on the board (ADR 17).
(window as unknown as { __state: () => unknown }).__state = () =>
    play && { turn: play.turn, current: play.sim.get_current_team_idx(), me: play.peers.indexOf(me), arena: play.sim.arena(), shot: play.shot, faint: olderPaths(play.shots, play.sim.arena(), play.shot).length };

/** Drops the game, for a page that goes back to the lobby. */
export function dropGame() {
    if (play) clearTimeout(play.clock);
    play = null;
}

/** Lets the next room end its game: `ended` stays set until a room is entered again. */
export function clearEnded() {
    ended = false;
}
