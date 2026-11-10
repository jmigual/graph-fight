// Playable client: lobby, waiting room, game loop and end screen (ADR 7, 12, 14, 15).
import init, { Bot, Field as WasmField, Frame as WasmFrame, Game as Sim, Level } from "../pkg/index.js";
import type { BotShot } from "../pkg/index.js";
import { parseItem } from "./library";
import starters from "./starters.json" with { type: "json" };
import { BUILD_VERSION, inviteFragment, isHostRun, isLocal, joinGame, joinLobby, MAX_PLAYERS, newToken, parseBot, parseInvite, parseLocal, selfId, stretchPassword } from "./net";
import type { Announce, Field, Frame, Game as Room, GameMsg, OpenGame, Shot, Start } from "./net";
import { initEditor, sliderError } from "./editor";
import { draw, lookAfterShot, lookKey, olderPaths } from "./render";
import type { LastShot, Look, View } from "./render";
import { aliveCounts, clearError, cueTurn, describeTurn, ourWin, renderRoster, renderStatus, seatName, setLive, setText, short, showError, TITLE } from "./status";

// Fetches `index_bg.wasm`, which sits next to the bundle in dist/.
await init();

const TURN_MS = 60_000;
const PLAYERS_PER_TEAM = 3;
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
/** sessionStorage key of our seat, kept until the game ends so a reload can rejoin (ADR 16). */
const SEAT_KEY = "graph-fight-seat";
const MISMATCH = ["Different version.", "Reload the page, then join again."] as const;
const HOST_LEFT = ["The host left.", "The game can't continue without the host."] as const;
const REMOVED = ["The host removed you from this game.", "Join another game from the lobby."] as const;
const UNREACHABLE = ["Wrong password, or the host can't be reached.", "Check the password or the link with the host, then join again."] as const;
const NO_HOST = ["The host can't be reached.", "The game may be gone. Join another one from the lobby."] as const;
/** Long and short (below 480 px) names of a field in the lobby (ADR 17, section 6). */
const FIELD_NAMES = { xy: ["XY plane", "XY"], disc: ["Polar disc", "Disc"] };
/** Long and short names of a shot frame, shown after the field (ADR 20). */
const FRAME_NAMES = { map: ["map-centred", "map"], player: ["player-centred", "player"] };
const LABELS = {
    xy: { explicit: ["y = f(x)"], parametric: ["x(t) =", "y(t) ="] },
    disc: { explicit: ["r = f(θ)"], parametric: ["r(t) =", "θ(t) ="] },
};

/** What a seated peer keeps to rejoin: the room, its private token, its build, its seat id and the room password (ADR 24). */
type Seat = { hostId: string; token: string; version: string; me: string; key?: string };

type Play = {
    sim: Sim;
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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SECTIONS = ["lobby", "room", "game", "end"];
const show = (...names: string[]) => SECTIONS.forEach((s) => ($(s).hidden = !names.includes(s)));
$("build").textContent = `v ${BUILD_VERSION}`;
$("build").setAttribute("aria-label", `Build version ${BUILD_VERSION}`);

// One lobby connection for the page's lifetime; the host withdraws its listing once the game starts.
const lobby = joinLobby(renderLobby);
let room: Room | null = null;
let hostId = "";
/** Our seat id in `start.peers`: `selfId`, or after a reload the id we had when the game started. */
let me = selfId;
/** What we advertise while hosting a game that has not started. */
let offer: Announce | null = null;
/** Host: a private-link game, which is never announced (ADR 24). */
let unlisted = false;
/** Host: guests may share the invite link; a guest: the host said we may (ADR 24). */
let shareInvite = false;
/** The room password of the game we host or joined, "" for a public one (ADR 24). */
let roomKey = "";
let connected: string[] = [];
/** Host: the bot seat ids added in the waiting room, in the order they were added (ADR 21). */
let bots: string[] = [];
/** Host: the local players' seat ids added in the waiting room, in the order they were added (ADR 22). */
let locals: string[] = [];
let play: Play | null = null;
/** The open games the lobby last listed, and the offer of the room we are in (ADR 17, section 6). */
let games: OpenGame[] = [];
let roomInfo: Announce | undefined;
/** Set by the first end message, which stays: later ones (host left after a win) are ignored. */
let ended = false;
/** The last turn start (`Play.starts`) that ran `restore`, kept across `startGame`: a rejoin replays turns we already lived, and must not overwrite what we typed since. */
let restored = { host: "", starts: 0 };

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
            const name = cell(g.name);
            if (g.locked) {
                const lock = name.appendChild(document.createElement("span"));
                lock.className = "lock";
                lock.setAttribute("role", "img");
                lock.setAttribute("aria-label", "Password required");
            }
            if (g.compatible) {
                const [long, short] = FIELD_NAMES[g.field].map((name, i) => `${name}, ${FRAME_NAMES[g.frame][i]}`);
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
                join.onclick = () => (g.locked ? askPassword(g.id) : enterRoom(g.id));
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
const hostVisibility = $<HTMLSelectElement>("host-visibility");
hostVisibility.onchange = () => {
    $<HTMLInputElement>("host-password").disabled = hostVisibility.value !== "password";
    $<HTMLInputElement>("host-share").disabled = hostVisibility.value === "public";
};
$<HTMLFormElement>("host-form").onsubmit = async (e) => {
    e.preventDefault();
    const field = hostField.value === "xy" ? "xy" : "disc";
    const frame = $<HTMLSelectElement>("host-frame").value === "player" ? "player" : "map";
    // A password game is listed with a lock, and its typed password is stretched; a private link's
    // random key is used as it is and never leaves the link (ADR 24).
    const submit = $<HTMLButtonElement>("host-submit");
    submit.disabled = true;
    let password = "";
    try {
        if (hostVisibility.value === "link") password = newToken();
        else if (hostVisibility.value === "password") password = await stretchPassword($<HTMLInputElement>("host-password").value, selfId);
    } finally {
        submit.disabled = false;
    }
    unlisted = hostVisibility.value === "link";
    shareInvite = hostVisibility.value !== "public" && $<HTMLInputElement>("host-share").checked;
    offer = { name: $<HTMLInputElement>("host-name").value, field, frame, players: 1, seats: Number(hostSeats.value), locked: hostVisibility.value === "password" };
    enterRoom(selfId, undefined, password);
};

// Password fields are masked; their Show toggle (aria-pressed) reveals the text (ADR 24).
const reveal = (button: HTMLButtonElement, shown: boolean) => {
    $<HTMLInputElement>(button.getAttribute("aria-controls") ?? "").type = shown ? "text" : "password";
    button.setAttribute("aria-pressed", String(shown));
};
document.querySelectorAll<HTMLButtonElement>("button.reveal").forEach((button) => (button.onclick = () => reveal(button, button.getAttribute("aria-pressed") !== "true")));

const passwordDialog = $<HTMLDialogElement>("password-dialog");
/** The game whose password the dialog asks for. */
let asking = "";
function askPassword(id: string) {
    asking = id;
    $<HTMLInputElement>("join-password").value = "";
    reveal(passwordDialog.querySelector("button.reveal")!, false);
    passwordDialog.showModal();
}
$<HTMLFormElement>("password-form").onsubmit = async (e) => {
    e.preventDefault();
    const id = asking;
    const password = await stretchPassword($<HTMLInputElement>("join-password").value, id);
    // A second submit while this one stretched, Cancel or leaving the lobby closed the dialog already.
    if (!passwordDialog.open) return;
    passwordDialog.close();
    enterRoom(id, undefined, password);
};
$("password-cancel").onclick = () => passwordDialog.close();

/** Joins room `id`: our own when hosting, from a stored `seat` after a reload, with the room `password` of a private game (ADR 24). */
function enterRoom(id: string, seat?: Seat, password = seat?.key ?? "") {
    hostId = id;
    roomKey = password;
    // The host's choice was made in the form; a guest waits to be told.
    if (id !== selfId) shareInvite = false;
    me = seat?.me ?? selfId;
    connected = [];
    bots = [];
    locals = [];
    ended = false;
    roomInfo = id === selfId ? offer ?? undefined : games.find((g) => g.id === id);
    clearError();
    $("room-error").textContent = "";
    $("room-title").textContent = roomInfo?.name || "Waiting room";
    $("room-info").textContent = roomInfo ? `${FIELD_NAMES[roomInfo.field][0]}, ${FRAME_NAMES[roomInfo.frame][0]}, ${roomInfo.seats} seats` : "";
    $("room-status").textContent = seat ? "Rejoining…" : "";
    $<HTMLInputElement>("invite-link").value = roomKey ? `${location.origin}${location.pathname}${inviteFragment(id, roomKey)}` : "";
    $("copy-status").textContent = "";
    room = joinGame(id, {
        onMessage,
        onShotRequest: acceptShot,
        onVersionMismatch: () => end(...MISMATCH),
        onDesync: () => end("Out of sync.", "A message from the host was lost, so this game can't continue. Start a new one from the lobby."),
        onKicked: () => end(...REMOVED),
        onUnreachable: () => (roomKey ? end(...UNREACHABLE) : end(...NO_HOST)),
        onHostLost: () => end("Host unreachable.", "The host has been gone for 3 minutes, so this game can't continue. Start a new one from the lobby."),
        onSendError(err) {
            if (play) play.pending = false;
            showError(`Shot not sent: ${err}. Fire again.`, false);
            if (play) refresh(play);
        },
        onSeat(token) {
            sessionStorage.setItem(SEAT_KEY, JSON.stringify({ hostId, token, version: BUILD_VERSION, me, key: roomKey } satisfies Seat));
        },
        onPeerJoin(peer) {
            // A peer announcing a bot's or a local player's id is never seated (ADR 21, 22).
            if (isHostRun(peer)) return;
            // A rejoined room (ADR 18) reports peers we already had.
            if (!connected.includes(peer)) connected.push(peer);
            // Before the game starts, the host lets each guest share its invite link if it chose so (ADR 24).
            if (offer && shareInvite) room?.share(peer);
            roomChanged();
        },
        onShare() {
            shareInvite = true;
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
    }, seat?.token, roomKey || undefined);
    roomChanged();
    show("room");
}

function roomChanged() {
    if (play || ended) return;
    const all = [selfId, ...connected];
    const item = (text: string) => {
        const li = document.createElement("li");
        li.textContent = text;
        return li;
    };
    // A row with a Remove button named after `name`, which runs `remove`.
    const removable = (text: string, name: string, remove: () => void, fallback: string) => {
        const li = item(text);
        const button = li.appendChild(document.createElement("button"));
        button.type = "button";
        button.className = "secondary";
        button.textContent = "Remove";
        button.setAttribute("aria-label", `Remove ${name}`);
        button.onclick = () => {
            const at = [...$("room-players").querySelectorAll("button")].indexOf(button);
            remove();
            roomChanged();
            // The list was rebuilt: keep the keyboard on the next Remove, or on `fallback`.
            ($("room-players").querySelectorAll("button")[at] ?? $(fallback)).focus();
        };
        return li;
    };
    $("room-players").replaceChildren(
        ...all.map((id) => {
            const text = short(id) + (id === selfId ? " (you)" : "") + (id === hostId ? " (host)" : "");
            // The host can remove a guest; it is told, and its id is ignored from then on (ADR 23).
            const kick = () => {
                room?.kick(id);
                connected = connected.filter((p) => p !== id);
            };
            return offer && id !== selfId ? removable(text, short(id), kick, "add-local") : item(text);
        }),
        ...locals.map((id) => removable(seatName(id), seatName(id), () => (locals = locals.filter((l) => l !== id)), "add-local")),
        ...bots.map((id) => removable(seatName(id), `Bot ${parseBot(id)?.n}`, () => (bots = bots.filter((b) => b !== id)), "add-bot")),
    );
    // Bots and local players keep their seats; humans beyond the rest wait out the game (ADR 21, 22).
    const hostRun = bots.length + locals.length;
    const players = all.length + hostRun;
    const open = roomInfo ? roomInfo.seats - players : 0;
    $("room-seats").textContent = open > 0 ? `${open} ${open === 1 ? "seat" : "seats"} open` : roomInfo && offer && open < 0 ? `More players than seats: the first ${roomInfo.seats - hostRun} to join play.` : "";
    $("start").hidden = !offer;
    $<HTMLButtonElement>("start").disabled = players < 2;
    $("bots").hidden = !offer;
    for (const id of ["add-bot", "add-local"]) $<HTMLButtonElement>(id).disabled = !offer || hostRun >= offer.seats - 1;
    $("invite").hidden = !roomKey || !(offer || shareInvite);
    if (offer && !unlisted) lobby.announce({ ...offer, players });
}

$("copy-link").onclick = () => {
    const field = $<HTMLInputElement>("invite-link");
    // The clipboard needs a secure context and the page's focus; otherwise the link is selected to copy by hand.
    Promise.resolve()
        .then(() => navigator.clipboard.writeText(field.value))
        .then(
            () => setLive($("copy-status"), "Link copied."),
            () => {
                field.focus();
                field.select();
                setLive($("copy-status"), "Copy the selected link.");
            },
        );
};

/** The lowest seat number from 1 to 7 not in `taken`. */
const freeNumber = (taken: (number | undefined)[]) => [1, 2, 3, 4, 5, 6, 7].find((k) => !taken.includes(k));
const roomForHostRun = () => !!offer && bots.length + locals.length < offer.seats - 1;

$("add-bot").onclick = () => {
    const n = freeNumber(bots.map((id) => parseBot(id)?.n));
    if (n === undefined || !roomForHostRun()) return;
    bots.push(`bot:${$<HTMLSelectElement>("bot-level").value}:${n}`);
    roomChanged();
};
$("add-local").onclick = () => {
    const n = freeNumber(locals.map(parseLocal));
    if (n === undefined || !roomForHostRun()) return;
    locals.push(`local:${n}`);
    roomChanged();
};

$("start").onclick = () => {
    if (!room || !offer) return;
    const seed = crypto.getRandomValues(new BigUint64Array(1))[0].toString();
    try {
        // Delivered to our own onMessage, which starts the game.
        const peers = [selfId, ...connected.slice(0, offer.seats - 1 - bots.length - locals.length), ...locals, ...bots];
        room.relay({ type: "start", seed, field: offer.field, frame: offer.frame, peers, version: BUILD_VERSION });
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
        sim = new Sim(msg.field === "xy" ? WasmField.Xy : WasmField.Disc, msg.frame === "map" ? WasmFrame.Map : WasmFrame.Player, a.x, a.y, a.obstacles, a.minSize, a.maxSize, new Uint32Array(msg.peers.length).fill(PLAYERS_PER_TEAM), PLAYER_RADIUS, BigInt(msg.seed));
    } catch (err) {
        return end("Could not start the game.", `${err}`);
    }
    $("game").dataset.field = msg.field;
    // The direction is shown on the disc only and starts counter-clockwise in every game (ADR 17).
    $("direction").hidden = msg.field !== "disc";
    $<HTMLInputElement>("dir-ccw").checked = true;
    play = { sim, field: msg.field, frame: msg.frame, peers: msg.peers, turn: 0, shot: null, note: "", looks: new Map(), shots: new Map(), starts: 0, pending: false, over: false, deadline: 0 };
    setMode();
    show("game");
    changed(play, true);
}

/** Host: relays `shot` if `from` is the current team's seat and the shot is for the current turn (ADR 12). */
function acceptShot(from: string, shot: Shot) {
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
        const fresh = hostId !== restored.host || p.starts > restored.starts;
        if (fresh) restored = { host: hostId, starts: p.starts };
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

function refresh(p: Play) {
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

/**
 * Joins the game an invite link names (ADR 24), and first takes the link out of the address bar so
 * a screenshot or a shared URL does not show the key. Returns false when the address holds none.
 */
function openInvite() {
    const invite = parseInvite(location.hash);
    if (!invite) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (invite.version === BUILD_VERSION) enterRoom(invite.hostId, undefined, invite.key);
    else end(...MISMATCH);
    return true;
}
// A link pasted into this tab changes only the fragment, which does not reload the page.
addEventListener("hashchange", () => {
    if (!parseInvite(location.hash) || (room && !ended)) return;
    toLobby();
    // The last game's end must not swallow this one's (a version mismatch ends at once).
    ended = false;
    openInvite();
});

// After a reload, rejoin the game we hold a seat in (ADR 16); an invite opened in this tab wins over it.
const saved = sessionStorage.getItem(SEAT_KEY);
if (!openInvite() && saved) {
    const seat = JSON.parse(saved) as Seat;
    if (seat.version === BUILD_VERSION) enterRoom(seat.hostId, seat);
    else end(...MISMATCH);
}
