// Playable client: lobby, waiting room, game loop and end screen (ADR 7, 12, 14, 15).
import { Field as WasmField, Game as Sim } from "../pkg/index.js";
import type { Point } from "../pkg/index.js";
import { BUILD_VERSION, joinGame, joinLobby, MAX_PLAYERS, selfId } from "./net";
import type { Announce, Field, Game as Room, GameMsg, OpenGame, Shot, Start } from "./net";
import { draw, TEAM_COLORS } from "./render";

const TURN_MS = 60_000;
const PLAYERS_PER_TEAM = 3;
const PLAYER_RADIUS = 0.3;
// Arena constants are compiled into the bundle, so they never travel (ADR 8, 15).
const ARENAS = {
    xy: { x: 20, y: 10, obstacles: 30, minSize: 0.2, maxSize: 2, canvasWidth: 800 },
    disc: { x: 10, y: 10, obstacles: 20, minSize: 0.2, maxSize: 1.5, canvasWidth: 600 },
};
const LABELS = {
    xy: { explicit: ["y = f(x)"], parametric: ["x(t) =", "y(t) ="] },
    disc: { explicit: ["r = f(θ)"], parametric: ["r(t) =", "θ(t) ="] },
};

type Play = {
    sim: Sim;
    field: Field;
    /** `peers[i]` plays team `i`. */
    peers: string[];
    /** Number of applied shots and timeouts. */
    turn: number;
    shot: Point[];
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
                tr.style.color = "grey";
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
    const seats = Number(hostSeats.value);
    if (!Number.isInteger(seats) || seats < 2 || seats > MAX_PLAYERS) return;
    offer = { name: $<HTMLInputElement>("host-name").value, field, players: 1, seats };
    enterRoom(selfId);
};

function enterRoom(id: string) {
    hostId = id;
    connected = [];
    ended = false;
    $("error").textContent = "";
    room = joinGame(id, {
        onMessage,
        onShotRequest(from, shot) {
            if (play && !play.over && from === play.peers[play.sim.get_current_team_idx()] && shot.turn === play.turn) room?.relay(shot);
        },
        onVersionMismatch: () => end("Version mismatch: reload the page to get the same version as the host."),
        onDesync: () => end("Desynced: a message from the host was lost, so the game cannot continue."),
        onSendError(err) {
            if (play) play.pending = false;
            $("error").textContent = `Send failed: ${err}`;
            if (play) refresh(play);
        },
        onPeerJoin(peer) {
            connected.push(peer);
            roomChanged();
        },
        onPeerLeave(peer) {
            connected = connected.filter((p) => p !== peer);
            if (peer === hostId) end("Host left.");
            else roomChanged();
        },
    });
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
        $("error").textContent = `Could not start: ${err}`;
        return;
    }
    offer = null;
    lobby.announce(null);
};

$("leave").onclick = $("back").onclick = () => {
    room?.leave();
    room = null;
    if (play) clearTimeout(play.clock);
    play = null;
    if (offer) lobby.announce(null);
    offer = null;
    $("error").textContent = "";
    show("lobby");
};

function startGame(msg: Start) {
    if (!msg.peers.includes(selfId)) return end("Game full: the host did not give you a seat.");
    const a = ARENAS[msg.field];
    let sim: Sim;
    try {
        sim = new Sim(msg.field === "xy" ? WasmField.Xy : WasmField.Disc, a.x, a.y, a.obstacles, a.minSize, a.maxSize, new Uint32Array(msg.peers.length).fill(PLAYERS_PER_TEAM), PLAYER_RADIUS, BigInt(msg.seed));
    } catch (err) {
        return end(`Could not start the game: ${err}`);
    }
    const canvas = $<HTMLCanvasElement>("arena");
    canvas.width = a.canvasWidth;
    canvas.height = (a.canvasWidth * a.y) / a.x;
    play = { sim, field: msg.field, peers: msg.peers, turn: 0, shot: [], pending: false, over: false, deadline: 0 };
    setMode();
    show("game");
    changed(play);
}

/** The host owns the turn clock (ADR 12); everyone shows a countdown from the same event. */
function resetClock(p: Play) {
    clearTimeout(p.clock);
    p.deadline = Date.now() + TURN_MS;
    if (hostId === selfId) p.clock = setTimeout(() => room?.relay({ type: "timeout", turn: p.turn }), TURN_MS);
}

function onMessage(msg: GameMsg) {
    if (msg.type === "start") return startGame(msg);
    const p = play;
    if (!p || p.over) return;
    if (msg.type === "leave") {
        const team = p.peers.indexOf(msg.peer);
        if (team >= 0) p.sim.eliminate_team(team);
    } else {
        p.turn++;
        p.pending = false;
        p.shot = [];
        try {
            if (msg.type === "timeout") p.sim.skip_turn();
            else p.shot = (msg.exprs.length === 1 ? p.sim.fire(msg.exprs[0]) : p.sim.fire_param(msg.exprs[0], msg.exprs[1])).points;
        } catch {
            // Every peer parses identically, so a shot that fails here fails everywhere (ADR 7, 14).
            p.sim.skip_turn();
        }
    }
    changed(p);
}

/** After any applied message: end the game if it is decided, otherwise restart the clock. */
function changed(p: Play) {
    const winner = p.sim.winner();
    if (winner !== undefined) return end(p.peers[winner] === selfId ? "You win!" : `Team ${winner + 1} (${short(p.peers[winner])}) wins.`);
    if (p.sim.arena().teams.every((t) => t.players.every((pl) => !pl.alive))) return end("Draw: nobody is left.");
    resetClock(p);
    refresh(p);
}

function refresh(p: Play) {
    const team = p.sim.get_current_team_idx();
    const mine = p.peers[team] === selfId;
    draw($<HTMLCanvasElement>("arena"), { field: p.field, arena: p.sim.arena(), current: p.over ? null : team, shot: p.shot });
    const turnEl = $("turn");
    turnEl.textContent = p.over ? "" : `Team ${team + 1} (${short(p.peers[team])})${mine ? ", your turn" : ""}`;
    turnEl.style.color = TEAM_COLORS[team % TEAM_COLORS.length];
    $<HTMLButtonElement>("fire").disabled = p.over || p.pending || !mine;
}

function end(message: string) {
    if (ended) return;
    ended = true;
    if (play) {
        play.over = true;
        clearTimeout(play.clock);
        refresh(play);
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
        room.shoot({ type: "shot", turn: p.turn, exprs });
    } catch (err) {
        p.pending = false;
        $("error").textContent = String(err);
    }
    refresh(p);
};

setInterval(() => {
    if (play && !play.over) $("countdown").textContent = String(Math.max(0, Math.ceil((play.deadline - Date.now()) / 1000)));
}, 250);

// Read-only hook for the end-to-end tests: the state every peer must agree on (`me` is ours).
(window as unknown as { __state: () => unknown }).__state = () =>
    play && { turn: play.turn, current: play.sim.get_current_team_idx(), me: play.peers.indexOf(selfId), arena: play.sim.arena() };
