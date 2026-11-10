// Playable client: lobby, waiting room, game loop and end screen (ADR 7, 12, 14, 15).
import init from "../pkg/index.js";
import { BUILD_ID, BUILD_VERSION, DEFAULT_K, inviteFragment, isHostRun, joinGame, joinLobby, MAX_PLAYERS, newToken, parseBot, parseInvite, parseLocal, selfId, stretchPassword } from "./net";
import type { Announce, Game as Room, OpenGame } from "./net";
import { $, show } from "./dom";
import "./help";
import { acceptShot, clearEnded, dropGame, end, ended, onMessage, play, refresh, testArena } from "./game";
import { clearError, seatName, setLive, short, showError, TITLE } from "./status";
import "./about";

// Fetches `index_bg.wasm`, which sits next to the bundle in dist/.
await init();

/** sessionStorage key of our seat, kept until the game ends so a reload can rejoin (ADR 16). */
export const SEAT_KEY = "graph-fight-seat";
const MISMATCH = ["Different version.", "Reload the page, then join again."] as const;
/** An invite from another build: the fragment is already gone, so the link has to be opened again. */
const INVITE_MISMATCH = ["Different version.", "Reload the page, then open the invite link again."] as const;
/** An invite opened while this page is in a game or a waiting room (ADR 24). */
const BUSY = "Finish or leave this game first, then open the invite link again.";
export const HOST_LEFT = ["The host left.", "The game can't continue without the host."] as const;
const REMOVED = ["The host removed you from this game.", "Join another game from the lobby."] as const;
const UNREACHABLE = ["Wrong password, or the host can't be reached.", "Check the password or the link with the host, then join again."] as const;
const NO_HOST = ["The host can't be reached.", "The game may be gone. Join another one from the lobby."] as const;
/** Long and short (below 480 px) names of a field in the lobby (ADR 17, section 6). */
const FIELD_NAMES = { xy: ["XY plane", "XY"], disc: ["Polar disc", "Disc"] };
/** Long and short names of a shot frame, shown after the field (ADR 20). */
const FRAME_NAMES = { map: ["map-centred", "map"], player: ["player-centred", "player"] };

/** What a seated peer keeps to rejoin: the room, its private token, its build, its seat id and the room password (ADR 24). */
type Seat = { hostId: string; token: string; version: string; me: string; key?: string };

$("build").textContent = `v ${BUILD_VERSION}`;
$("build").setAttribute("aria-label", `v ${BUILD_VERSION}, changelog, opens in a new tab`);

// One lobby connection for the page's lifetime; the host withdraws its listing once the game starts.
const lobby = joinLobby(renderLobby);
export let room: Room | null = null;
export let hostId = "";
/** Our seat id in `start.peers`: `selfId`, or after a reload the id we had when the game started. */
export let me = selfId;
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
/** The open games the lobby last listed, and the offer of the room we are in (ADR 17, section 6). */
let games: OpenGame[] = [];
let roomInfo: Announce | undefined;

/** Forgets the stored seat and takes our own id as the seat id again, for a seat from an earlier game. */
export function dropSeat() {
    sessionStorage.removeItem(SEAT_KEY);
    me = selfId;
}

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
    // While the password stretched, Join or a pasted invite may have entered another room.
    if (room || $("lobby").hidden) return forget("host-password");
    unlisted = hostVisibility.value === "link";
    shareInvite = hostVisibility.value !== "public" && $<HTMLInputElement>("host-share").checked;
    offer = { name: $<HTMLInputElement>("host-name").value, field, frame, players: 1, seats: Number(hostSeats.value), locked: hostVisibility.value === "password", teams: [], k: DEFAULT_K };
    forget("host-password");
    enterRoom(selfId, undefined, password);
};

// Password fields are masked; their Show toggle (aria-pressed) reveals the text (ADR 24).
const reveal = (button: HTMLButtonElement, shown: boolean) => {
    $<HTMLInputElement>(button.getAttribute("aria-controls") ?? "").type = shown ? "text" : "password";
    button.setAttribute("aria-pressed", String(shown));
};
document.querySelectorAll<HTMLButtonElement>("button.reveal").forEach((button) => (button.onclick = () => reveal(button, button.getAttribute("aria-pressed") !== "true")));
/** Empties a password field and masks it again, so a typed password does not stay on the page once used. */
function forget(id: string) {
    $<HTMLInputElement>(id).value = "";
    reveal(document.querySelector<HTMLButtonElement>(`button.reveal[aria-controls="${id}"]`)!, false);
}

const passwordDialog = $<HTMLDialogElement>("password-dialog");
/** The game whose password the dialog asks for. */
let asking = "";
function askPassword(id: string) {
    asking = id;
    passwordDialog.showModal();
}
// However the dialog closes (Join, Cancel, Escape, leaving the lobby), the typed password goes.
passwordDialog.addEventListener("close", () => forget("join-password"));
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
    clearEnded();
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
            sessionStorage.setItem(SEAT_KEY, JSON.stringify({ hostId, token, version: BUILD_ID, me, key: roomKey } satisfies Seat));
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
        room.relay({ type: "start", seed, field: offer.field, frame: offer.frame, peers, version: BUILD_ID });
    } catch (err) {
        $("room-error").textContent = `Could not start: ${err}.`;
        return;
    }
    offer = null;
    lobby.announce(null);
};

function toLobby() {
    // A join dialog left open would sit in the hidden lobby and could still join a room.
    passwordDialog.close();
    // An invite link pasted in the test arena goes through here: the room must not open in test mode (ADR 25).
    testArena.close();
    sessionStorage.removeItem(SEAT_KEY);
    room?.leave();
    room = null;
    dropGame();
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

/**
 * Joins the game an invite link names (ADR 24), and first takes the link out of the address bar so
 * a screenshot or a shared URL does not show the key. Returns false when the address holds none.
 */
function openInvite() {
    const invite = parseInvite(location.hash);
    if (!invite) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (invite.version === BUILD_ID) enterRoom(invite.hostId, undefined, invite.key);
    else end(...INVITE_MISMATCH);
    return true;
}
// A link pasted into this tab changes only the fragment, which does not reload the page.
addEventListener("hashchange", () => {
    if (!parseInvite(location.hash)) return;
    if (room && !ended) {
        // This page stays where it is. The key still goes from the address bar, or a reload would
        // follow the link instead of rejoining our seat (ADR 16).
        history.replaceState(null, "", location.pathname + location.search);
        if (play) showError(BUSY, false);
        else $("room-error").textContent = BUSY;
        return;
    }
    toLobby();
    // The last game's end must not swallow this one's (a version mismatch ends at once).
    clearEnded();
    openInvite();
});

// After a reload, rejoin the game we hold a seat in (ADR 16); an invite opened in this tab wins over it.
const saved = sessionStorage.getItem(SEAT_KEY);
if (!openInvite() && saved) {
    const seat = JSON.parse(saved) as Seat;
    if (seat.version === BUILD_ID) enterRoom(seat.hostId, seat);
    else end(...MISMATCH);
}
