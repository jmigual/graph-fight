// Playable client: lobby, waiting room, game loop and end screen (ADR 7, 12, 14, 15).
import init, { Field as WasmField, Game as Sim } from "../pkg/index.js";
import { BUILD_VERSION, joinGame, joinLobby, MAX_PLAYERS, selfId } from "./net";
import type { Announce, Field, Game as Room, GameMsg, OpenGame, Shot, Start } from "./net";
import { initEditor, sliderError } from "./editor";
import { draw, lookAfterShot, lookKey } from "./render";
import type { LastShot, Look, View } from "./render";
import { aliveCounts, clearError, cueTurn, describeTurn, renderRoster, renderStatus, setText, short, showError, TITLE } from "./status";

// Fetches `index_bg.wasm`, which sits next to the bundle in dist/.
await init();

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
const MISMATCH = ["Different version.", "Reload the page, then join again."] as const;
const HOST_LEFT = ["The host left.", "The game can't continue without the host."] as const;
/** Long and short (below 480 px) names of a field in the lobby (ADR 17, section 6). */
const FIELD_NAMES = { xy: ["XY plane", "XY"], disc: ["Polar disc", "Disc"] };
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
    /** What the last message did, in words: the text alternative of the board (ADR 17). */
    note: string;
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
/** The open games the lobby last listed, and the offer of the room we are in (ADR 17, section 6). */
let games: OpenGame[] = [];
let roomInfo: Announce | undefined;
/** Set by the first end message, which stays: later ones (host left after a win) are ignored. */
let ended = false;

function renderLobby(list: OpenGame[]) {
    games = list;
    $("no-games").hidden = list.length > 0;
    $("games-table").hidden = list.length === 0;
    $("games").replaceChildren(
        ...list.map((g) => {
            const tr = document.createElement("tr");
            const cell = (text: string) => {
                const td = tr.appendChild(document.createElement("td"));
                td.textContent = text;
                return td;
            };
            cell(g.name);
            if (g.compatible) {
                const [long, short] = FIELD_NAMES[g.field];
                const field = cell("");
                for (const [cls, name] of [["long", long], ["short", short]]) {
                    const span = field.appendChild(document.createElement("span"));
                    span.className = cls;
                    span.textContent = name;
                }
                cell(`${g.players} of ${g.seats}`);
                const full = g.players >= g.seats;
                const join = document.createElement("button");
                join.textContent = full ? "Full" : "Join";
                join.disabled = full;
                join.onclick = () => enterRoom(g.id);
                cell("").append(join);
            } else {
                tr.className = "muted";
                cell("Different version. Reload the page.").colSpan = 3;
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
    roomInfo = id === selfId ? offer ?? undefined : games.find((g) => g.id === id);
    clearError();
    $("room-error").textContent = "";
    $("room-title").textContent = roomInfo?.name || "Waiting room";
    $("room-info").textContent = roomInfo ? `${FIELD_NAMES[roomInfo.field][0]}, ${roomInfo.seats} seats` : "";
    $("room-status").textContent = seat ? "Rejoining…" : "";
    room = joinGame(id, {
        onMessage,
        onShotRequest(from, shot) {
            if (play && !play.over && from === play.peers[play.sim.get_current_team_idx()] && shot.turn === play.turn) room?.relay(shot);
        },
        onVersionMismatch: () => end(...MISMATCH),
        onDesync: () => end("Out of sync.", "A message from the host was lost, so this game can't continue. Start a new one from the lobby."),
        onSendError(err) {
            if (play) play.pending = false;
            showError(`Shot not sent: ${err}. Fire again.`, false);
            if (play) refresh(play);
        },
        onSeat(token) {
            sessionStorage.setItem(SEAT_KEY, JSON.stringify({ hostId, token, version: BUILD_VERSION, me } satisfies Seat));
        },
        onPeerJoin(peer) {
            // A rejoined room (ADR 18) reports peers we already had.
            if (!connected.includes(peer)) connected.push(peer);
            roomChanged();
        },
        onPeerLeave(peer) {
            connected = connected.filter((p) => p !== peer);
            // A seated peer in a game waits for the host to come back; a host that quits relays its
            // own leave. Without a game yet (waiting room, or a stored seat not yet replayed),
            // the host leaving ends it.
            if (peer === hostId && (!play || !sessionStorage.getItem(SEAT_KEY))) end(...HOST_LEFT);
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
    const open = roomInfo ? roomInfo.seats - all.length : 0;
    $("room-seats").textContent = open > 0 ? `${open} ${open === 1 ? "seat" : "seats"} open` : roomInfo && offer && open < 0 ? `More players than seats: the first ${roomInfo.seats} to join play.` : "";
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
        $("room-error").textContent = `Could not start: ${err}.`;
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
    clearError();
    $("room-error").textContent = "";
    document.title = TITLE;
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
    if (!msg.peers.includes(me)) return end("Game full.", "The host started with the seats already taken.");
    const a = ARENAS[msg.field];
    let sim: Sim;
    try {
        sim = new Sim(msg.field === "xy" ? WasmField.Xy : WasmField.Disc, a.x, a.y, a.obstacles, a.minSize, a.maxSize, new Uint32Array(msg.peers.length).fill(PLAYERS_PER_TEAM), PLAYER_RADIUS, BigInt(msg.seed));
    } catch (err) {
        return end("Could not start the game.", `${err}`);
    }
    $("game").dataset.field = msg.field;
    // The direction is shown on the disc only and starts counter-clockwise in every game (ADR 17).
    $("direction").hidden = msg.field !== "disc";
    $<HTMLInputElement>("dir-ccw").checked = true;
    play = { sim, field: msg.field, peers: msg.peers, turn: 0, shot: null, note: "", looks: new Map(), pending: false, over: false, deadline: 0 };
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
                else p.shot = { team, exprs: msg.exprs, points: (msg.exprs.length === 1 ? p.sim.fire(msg.exprs[0], msg.cw) : p.sim.fire_param(msg.exprs[0], msg.exprs[1], msg.cw)).points };
            } catch {
                // Every peer parses identically, so a shot that fails here fails everywhere (ADR 7, 14).
                p.sim.skip_turn();
            }
            if (p.shot) {
                const look = lookAfterShot(p.field, p.looks.get(key), p.shot.points);
                if (look) p.looks.set(key, look);
            }
            p.note = describeTurn(p.field, team, msg, !!p.shot, alive, aliveCounts(p.sim.arena()));
        }
    } catch (err) {
        // The engine itself failed, so this peer's state can no longer be trusted.
        return end("Engine error.", `${err}. This game can't continue on this device.`);
    }
    changed(p, newTurn);
}

/** After any applied message: end the game if it is decided, otherwise (on a new turn) restart the clock. */
function changed(p: Play, newTurn: boolean) {
    const winner = p.sim.winner();
    if (winner !== undefined) return end(p.peers[winner] === me ? "You win." : `Team ${winner + 1} wins.`);
    if (p.sim.arena().teams.every((t) => t.players.every((pl) => !pl.alive))) return end("Draw.", "Nobody is left.");
    if (newTurn) {
        clearError();
        resetClock(p);
        // Our turn starts: say so to screen readers, and on a device with a keyboard put the cursor in the formula (ADR 17).
        const mine = p.peers[p.sim.get_current_team_idx()] === me;
        cueTurn(mine);
        if (mine && matchMedia("(pointer: fine)").matches) $("input-a").focus();
    }
    refresh(p);
}

function refresh(p: Play) {
    const team = p.sim.get_current_team_idx();
    const mine = p.peers[team] === me;
    const view: View = { field: p.field, arena: p.sim.arena(), current: p.over ? null : team, mine, cw: clockwise(), shot: p.shot, looks: new Map(p.looks), absent: absentTeams(p) };
    // A new shot is drawn with a pen on the board as it was, unless motion is reduced (ADR 17).
    const animate = p.view && p.shot && p.shot !== p.view.shot && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    draw($<HTMLCanvasElement>("arena"), view, animate ? p.view : undefined);
    p.view = view;
    renderStatus({ over: p.over, team, mine, hostDown: hostLinkDown(), away: !mine && view.absent.includes(team) });
    setText($("last-shot"), p.note);
    const out = !p.over && view.arena.teams[p.peers.indexOf(me)]?.players.every((pl) => !pl.alive);
    $("shot-form").hidden = out;
    $("out-note").hidden = !out;
    renderRoster(view.arena, p.peers, me, view.current, view.absent);
    $<HTMLButtonElement>("fire").disabled = p.over || p.pending || !mine || hostLinkDown();
}

/** We are a guest and our link to the host is down (ADR 16): the board is frozen until the replay arrives. */
const hostLinkDown = () => hostId !== selfId && !!room?.absent().includes(hostId);

/** Teams whose seat this page knows is disconnected (ADR 16). */
const absentTeams = (p: Play) => (room && !p.over ? room.absent().map((id) => p.peers.indexOf(id)).filter((t) => t >= 0) : []);

// The board redraws when its size, the pixel ratio, the colour scheme or the fonts change (ADR 17),
// which also ends a running shot animation on its final frame.
const redraw = () => play?.view && draw($<HTMLCanvasElement>("arena"), play.view);
new ResizeObserver(redraw).observe($("arena"));
// A query for the current ratio fires once when it changes (another screen, zoom), then re-arms.
function watchRatio() {
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener("change", () => (redraw(), watchRatio()), { once: true });
}
watchRatio();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
document.fonts.addEventListener("loadingdone", redraw);

function end(headline: string, detail = "") {
    if (ended) return;
    ended = true;
    sessionStorage.removeItem(SEAT_KEY);
    cueTurn(false);
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
function setMode() {
    if (!play) return;
    editor.refresh(play.field, parametric());
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
    clearError();
    const unfilled = sliderError(exprs);
    if (unfilled) {
        showError(unfilled);
        return;
    }
    p.pending = true;
    try {
        // The shooter checks locally, so a bad formula never costs the turn (ADR 14).
        if (exprs.length === 1) p.sim.check(exprs[0]);
        else p.sim.check_param(exprs[0], exprs[1]);
        room.shoot({ type: "shot", turn: p.turn, exprs, cw: p.field === "disc" && clockwise() });
    } catch (err) {
        p.pending = false;
        showError(String(err));
    }
    refresh(p);
};

setInterval(() => {
    const p = play;
    const left = p && !p.over ? Math.max(0, p.deadline - Date.now()) : 0;
    $("countdown").textContent = p && !p.over ? String(Math.ceil(left / 1000)) : "";
    $("timer").classList.toggle("low", !!p && !p.over && left <= 10_000);
    $("timer-fill").style.width = `${(100 * left) / TURN_MS}%`;
    if (p?.view && String(absentTeams(p)) !== String(p.view.absent)) refresh(p);
}, 250);

// Read-only hook for the end-to-end tests: the state every peer must agree on (`me` is ours).
(window as unknown as { __state: () => unknown }).__state = () =>
    play && { turn: play.turn, current: play.sim.get_current_team_idx(), me: play.peers.indexOf(me), arena: play.sim.arena(), shot: play.shot };

// After a reload, rejoin the game we hold a seat in (ADR 16).
const saved = sessionStorage.getItem(SEAT_KEY);
if (saved) {
    const seat = JSON.parse(saved) as Seat;
    if (seat.version === BUILD_VERSION) enterRoom(seat.hostId, seat);
    else end(...MISMATCH);
}
