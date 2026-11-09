// Playable client: lobby, waiting room and end screen (ADR 12, 15).
import { Field as WasmField, Game as Sim } from "../pkg/index.js";
import { BUILD_VERSION, joinGame, joinLobby, MAX_PLAYERS, selfId } from "./net";
import type { Announce, Field, Game as Room, GameMsg, OpenGame, Start } from "./net";
import { draw } from "./render";

const PLAYERS_PER_TEAM = 3;
const PLAYER_RADIUS = 0.3;
// Arena constants are compiled into the bundle, so they never travel (ADR 8, 15).
const ARENAS = {
    xy: { x: 20, y: 10, obstacles: 30, minSize: 0.2, maxSize: 2, canvasWidth: 800 },
    disc: { x: 10, y: 10, obstacles: 20, minSize: 0.2, maxSize: 1.5, canvasWidth: 600 },
};

type Play = {
    sim: Sim;
    field: Field;
    /** `peers[i]` plays team `i`. */
    peers: string[];
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
    offer = { name: $<HTMLInputElement>("host-name").value, field, players: 1, seats: Number(hostSeats.value) };
    enterRoom(selfId);
};

function enterRoom(id: string) {
    hostId = id;
    connected = [];
    $("error").textContent = "";
    room = joinGame(id, {
        onMessage,
        onVersionMismatch: () => end("Version mismatch: reload the page to get the same version as the host."),
        onDesync: () => end("Desynced: a message from the host was lost, so the game cannot continue."),
        onSendError: (err) => ($("error").textContent = `Send failed: ${err}`),
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
    if (play) return;
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
    play = null;
    if (offer) lobby.announce(null);
    offer = null;
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
    play = { sim, field: msg.field, peers: msg.peers };
    show("game");
    draw(canvas, { field: msg.field, arena: sim.arena(), current: sim.get_current_team_idx(), shot: [] });
}

function onMessage(msg: GameMsg) {
    if (msg.type === "start") startGame(msg);
}

function end(message: string) {
    $("end-message").textContent = message;
    show(...(play ? ["game", "end"] : ["end"]));
}
