// Playable client: lobby, waiting room, game loop and end screen (ADR 7, 12, 14, 15).
import { Field as WasmField, Game as Sim } from "../pkg/index.js";
import { BUILD_VERSION, joinGame, joinLobby, MAX_PLAYERS, selfId } from "./net";
import type { Announce, Field, Game as Room, GameMsg, OpenGame, Shot, Start } from "./net";
import { draw, lookAfterShot, lookKey } from "./render";
import type { LastShot, Look, View } from "./render";

const TURN_MS = 60_000;
const PLAYERS_PER_TEAM = 3;
const PLAYER_RADIUS = 0.3;
// Arena constants are compiled into the bundle, so they never travel (ADR 8, 15).
const ARENAS = {
    xy: { x: 20, y: 10, obstacles: 30, minSize: 0.2, maxSize: 2 },
    disc: { x: 10, y: 10, obstacles: 20, minSize: 0.2, maxSize: 1.5 },
};
/** sessionStorage key of our seat, kept until the game ends so a reload can rejoin (ADR 16). */
const SEAT_KEY = "graph-fight-seat";
const MISMATCH = "Version mismatch: reload the page to get the same version as the host.";
const LABELS = {
    xy: { explicit: ["y = f(x)"], parametric: ["x(t) =", "y(t) ="] },
    disc: { explicit: ["r = f(θ)"], parametric: ["r(t) =", "θ(t) ="] },
};

/** What a seated peer keeps to rejoin: the room, its private token, its build and its seat id. */
type Seat = { hostId: string; token: string; version: string; me: string };

type Play = {
    sim: Sim;
    field: Field;
    /** `peers[i]` plays team `i`. */
    peers: string[];
    /** Number of applied shots and timeouts. */
    turn: number;
    shot: LastShot | null;
    /** Display only, never in `__state`: each player's gaze after its last shot (ADR 17). */
    looks: Map<string, Look>;
    /** The board as last drawn, where the next shot's animation starts. */
    view?: View;
    /** Our shot is sent and not yet applied. */
    pending: boolean;
    over: boolean;
    deadline: number;
    clock?: ReturnType<typeof setTimeout>;
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SECTIONS = ["lobby", "room", "game", "end"];
const show = (...names: string[]) => SECTIONS.forEach((s) => ($(s).hidden = !names.includes(s)));
const short = (id: string) => id.slice(0, 6);

// One lobby connection for the page's lifetime; the host withdraws its listing once the game starts.
const lobby = joinLobby(renderLobby);
let room: Room | null = null;
let hostId = "";
/** Our seat id in `start.peers`: `selfId`, or after a reload the id we had when the game started. */
let me = selfId;
/** What we advertise while hosting a game that has not started. */
let offer: Announce | null = null;
let connected: string[] = [];
let play: Play | null = null;
/** Set by the first end message, which stays: later ones (host left after a win) are ignored. */
let ended = false;

function renderLobby(games: OpenGame[]) {
    $("games").replaceChildren(
        ...games.map((g) => {
            const tr = document.createElement("tr");
            const cell = (text: string) => {
                const td = tr.appendChild(document.createElement("td"));
                td.textContent = text;
                return td;
            };
            cell(g.name);
            cell(g.field);
            cell(`${g.players}/${g.seats}`);
            if (g.compatible) {
                const join = document.createElement("button");
                join.textContent = "Join";
                join.disabled = g.players >= g.seats;
                join.onclick = () => enterRoom(g.id);
                cell("").append(join);
            } else {
                tr.className = "muted";
                cell("different version — reload");
            }
            return tr;
        }),
    );
}

const hostField = $<HTMLSelectElement>("host-field");
const hostSeats = $<HTMLInputElement>("host-seats");
hostSeats.max = String(MAX_PLAYERS);
hostField.onchange = () => {
    // The xy field is exactly two players (ADR 5).
    hostSeats.disabled = hostField.value === "xy";
    if (hostSeats.disabled) hostSeats.value = "2";
};
$<HTMLFormElement>("host-form").onsubmit = (e) => {
    e.preventDefault();
    const field = hostField.value === "xy" ? "xy" : "disc";
    offer = { name: $<HTMLInputElement>("host-name").value, field, players: 1, seats: Number(hostSeats.value) };
    enterRoom(selfId);
};

function enterRoom(id: string, seat?: Seat) {
    hostId = id;
    me = seat?.me ?? selfId;
    connected = [];
    ended = false;
    $("error").textContent = "";
    $("room-error").textContent = "";
    $("room-status").textContent = seat ? "Rejoining…" : "";
    room = joinGame(id, {
        onMessage,
        onShotRequest(from, shot) {
            if (play && !play.over && from === play.peers[play.sim.get_current_team_idx()] && shot.turn === play.turn) room?.relay(shot);
        },
        onVersionMismatch: () => end(MISMATCH),
        onDesync: () => end("Desynced: a message from the host was lost, so the game cannot continue."),
        onSendError(err) {
            if (play) play.pending = false;
            $("error").textContent = `Send failed: ${err}`;
            if (play) refresh(play);
        },
        onSeat(token) {
            sessionStorage.setItem(SEAT_KEY, JSON.stringify({ hostId, token, version: BUILD_VERSION, me } satisfies Seat));
        },
        onPeerJoin(peer) {
            connected.push(peer);
            roomChanged();
        },
        onPeerLeave(peer) {
            connected = connected.filter((p) => p !== peer);
            // A seated peer in a game waits for the host to come back; a host that quits relays its
            // own leave. Without a game yet (waiting room, or a stored seat not yet replayed),
            // the host leaving ends it.
            if (peer === hostId && (!play || !sessionStorage.getItem(SEAT_KEY))) end("Host left.");
            else roomChanged();
        },
    }, seat?.token);
    roomChanged();
    show("room");
}

function roomChanged() {
    if (play || ended) return;
    const all = [selfId, ...connected];
    $("room-players").replaceChildren(
        ...all.map((id) => {
            const li = document.createElement("li");
            li.textContent = short(id) + (id === selfId ? " (you)" : "") + (id === hostId ? " (host)" : "");
            return li;
        }),
    );
    $("start").hidden = !offer;
    $<HTMLButtonElement>("start").disabled = all.length < 2;
    if (offer) lobby.announce({ ...offer, players: all.length });
}

$("start").onclick = () => {
    if (!room || !offer) return;
    const seed = crypto.getRandomValues(new BigUint64Array(1))[0].toString();
    try {
        // Delivered to our own onMessage, which starts the game.
        room.relay({ type: "start", seed, field: offer.field, peers: [selfId, ...connected].slice(0, offer.seats), version: BUILD_VERSION });
    } catch (err) {
        $("room-error").textContent = `Could not start: ${err}`;
        return;
    }
    offer = null;
    lobby.announce(null);
};

function toLobby() {
    sessionStorage.removeItem(SEAT_KEY);
    room?.leave();
    room = null;
    if (play) clearTimeout(play.clock);
    play = null;
    if (offer) lobby.announce(null);
    offer = null;
    $("error").textContent = "";
    $("room-error").textContent = "";
    show("lobby");
}
$("leave").onclick = $("back").onclick = toLobby;
$("quit").onclick = () => {
    if (!confirm("Leave the game? Your team will be out.")) return;
    room?.quit();
    toLobby();
};
// A host leaving ends the game for everyone, so it says so. Registered before any room is
// joined, so it runs before Trystero's own beforeunload handler closes the links.
addEventListener("beforeunload", () => {
    if (hostId === selfId) room?.quit();
});

function startGame(msg: Start) {
    if (!msg.peers.includes(me)) {
        // Our stored seat is from an earlier game in this room (the host hosted again): drop it,
        // we may hold a fresh seat under our own id.
        sessionStorage.removeItem(SEAT_KEY);
        me = selfId;
    }
    if (!msg.peers.includes(me)) return end("Game full: the host did not give you a seat.");
    const a = ARENAS[msg.field];
    let sim: Sim;
    try {
        sim = new Sim(msg.field === "xy" ? WasmField.Xy : WasmField.Disc, a.x, a.y, a.obstacles, a.minSize, a.maxSize, new Uint32Array(msg.peers.length).fill(PLAYERS_PER_TEAM), PLAYER_RADIUS, BigInt(msg.seed));
    } catch (err) {
        return end(`Could not start the game: ${err}`);
    }
    $("game").dataset.field = msg.field;
    play = { sim, field: msg.field, peers: msg.peers, turn: 0, shot: null, looks: new Map(), pending: false, over: false, deadline: 0 };
    setMode();
    show("game");
    changed(play, true);
}

/** The host owns the turn clock (ADR 12); everyone shows a countdown from the same event. */
function resetClock(p: Play) {
    clearTimeout(p.clock);
    p.deadline = Date.now() + TURN_MS;
    const turn = p.turn;
    if (hostId === selfId) p.clock = setTimeout(() => room?.relay({ type: "timeout", turn }), TURN_MS);
}

function onMessage(msg: GameMsg) {
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
            if (msg.peer === hostId) return end("Host left.");
            const team = p.peers.indexOf(msg.peer);
            if (team < 0) return;
            const before = p.sim.get_current_team_idx();
            p.sim.eliminate_team(team);
            newTurn = p.sim.get_current_team_idx() !== before;
        } else {
            p.turn++;
            p.pending = false;
            p.shot = null;
            try {
                if (msg.type === "timeout") p.sim.skip_turn();
                else {
                    const team = p.sim.get_current_team_idx();
                    const key = lookKey(team, p.sim.arena().teams[team].currentPlayer);
                    const points = (msg.exprs.length === 1 ? p.sim.fire(msg.exprs[0], msg.cw) : p.sim.fire_param(msg.exprs[0], msg.exprs[1], msg.cw)).points;
                    p.shot = { team, exprs: msg.exprs, points };
                    const look = lookAfterShot(p.field, p.looks.get(key), points);
                    if (look) p.looks.set(key, look);
                }
            } catch {
                // Every peer parses identically, so a shot that fails here fails everywhere (ADR 7, 14).
                p.sim.skip_turn();
            }
        }
    } catch (err) {
        // The engine itself failed, so this peer's state can no longer be trusted.
        return end(`Engine error: ${err}`);
    }
    changed(p, newTurn);
}

/** After any applied message: end the game if it is decided, otherwise (on a new turn) restart the clock. */
function changed(p: Play, newTurn: boolean) {
    const winner = p.sim.winner();
    if (winner !== undefined) return end(p.peers[winner] === me ? "You win!" : `Team ${winner + 1} (${short(p.peers[winner])}) wins.`);
    if (p.sim.arena().teams.every((t) => t.players.every((pl) => !pl.alive))) return end("Draw: nobody is left.");
    if (newTurn) {
        $("error").textContent = "";
        resetClock(p);
    }
    refresh(p);
}

function refresh(p: Play) {
    const team = p.sim.get_current_team_idx();
    const mine = p.peers[team] === me;
    const view: View = { field: p.field, arena: p.sim.arena(), current: p.over ? null : team, mine, shot: p.shot, looks: new Map(p.looks), absent: absentTeams(p) };
    // A new shot is drawn with a pen on the board as it was, unless motion is reduced (ADR 17).
    const animate = p.view && p.shot && p.shot !== p.view.shot && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw($<HTMLCanvasElement>("arena"), view, animate ? p.view : undefined);
    p.view = view;
    const turnEl = $("turn");
    turnEl.textContent = p.over ? "" : `Team ${team + 1} (${short(p.peers[team])})${mine ? ", your turn" : ""}`;
    $<HTMLButtonElement>("fire").disabled = p.over || p.pending || !mine;
}

/** Teams whose seat this page knows is disconnected (ADR 16). */
const absentTeams = (p: Play) => (room && !p.over ? room.absent().map((id) => p.peers.indexOf(id)).filter((t) => t >= 0) : []);

// The board redraws when its size, the colour scheme or the fonts change (ADR 17), which also
// ends a running shot animation on its final frame.
const redraw = () => play?.view && draw($<HTMLCanvasElement>("arena"), play.view);
new ResizeObserver(redraw).observe($("arena"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
document.fonts.addEventListener("loadingdone", redraw);

function end(message: string) {
    if (ended) return;
    ended = true;
    sessionStorage.removeItem(SEAT_KEY);
    if (play) {
        play.over = true;
        clearTimeout(play.clock);
        refresh(play);
    } else {
        // No game to show: leave the room, or the host's next game there would seat this page.
        room?.leave();
    }
    $("end-message").textContent = message;
    show(...(play ? ["game", "end"] : ["end"]));
}

const parametric = () => $<HTMLInputElement>("mode-parametric").checked;
function setMode() {
    if (!play) return;
    const [a, b] = LABELS[play.field][parametric() ? "parametric" : "explicit"];
    $("label-a").textContent = a;
    $("label-b").textContent = b ?? "";
    $("wrap-b").hidden = !parametric();
}
document.querySelectorAll("input[name=mode]").forEach((el) => ((el as HTMLInputElement).onchange = setMode));

$<HTMLFormElement>("shot-form").onsubmit = (e) => {
    e.preventDefault();
    const p = play;
    if (!p || !room || $<HTMLButtonElement>("fire").disabled) return;
    const a = $<HTMLInputElement>("input-a").value;
    const b = $<HTMLInputElement>("input-b").value;
    const exprs: Shot["exprs"] = parametric() ? [a, b] : [a];
    $("error").textContent = "";
    p.pending = true;
    try {
        // The shooter checks locally, so a bad formula never costs the turn (ADR 14).
        if (exprs.length === 1) p.sim.check(exprs[0]);
        else p.sim.check_param(exprs[0], exprs[1]);
        room.shoot({ type: "shot", turn: p.turn, exprs, cw: false });
    } catch (err) {
        p.pending = false;
        $("error").textContent = String(err);
    }
    refresh(p);
};

setInterval(() => {
    const p = play;
    if (p && !p.over) $("countdown").textContent = String(Math.max(0, Math.ceil((p.deadline - Date.now()) / 1000)));
    const away = p && !p.over && room ? room.absent().map((id) => `Team ${p.peers.indexOf(id) + 1} (${short(id)})`) : [];
    $("absent").textContent = away.length ? `Disconnected: ${away.join(", ")}` : "";
    if (p?.view && String(absentTeams(p)) !== String(p.view.absent)) refresh(p);
}, 250);

// Read-only hook for the end-to-end tests: the state every peer must agree on (`me` is ours).
(window as unknown as { __state: () => unknown }).__state = () =>
    play && { turn: play.turn, current: play.sim.get_current_team_idx(), me: play.peers.indexOf(me), arena: play.sim.arena() };

// After a reload, rejoin the game we hold a seat in (ADR 16).
const saved = sessionStorage.getItem(SEAT_KEY);
if (saved) {
    const seat = JSON.parse(saved) as Seat;
    if (seat.version === BUILD_VERSION) enterRoom(seat.hostId, seat);
    else end(MISMATCH);
}
