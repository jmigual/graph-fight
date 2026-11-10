// The room: the connection to the game room and the waiting room, until a game starts (ADR 12, 16, 21, 22, 23, 24).
import { BUILD_ID, inviteFragment, isHostRun, joinGame, parseBot, parseLocal, selfId } from "./net";
import type { Announce, Game as Room } from "./net";
import { $, show } from "./dom";
import { FIELD_NAMES, FRAME_NAMES, games, lobby, passwordDialog } from "./lobby";
import { acceptShot, clearEnded, dropGame, end, ended, onMessage, play, refresh, testArena } from "./game";
import { clearError, seatName, setLive, short, showError, TITLE } from "./status";

/** sessionStorage key of our seat, kept until the game ends so a reload can rejoin (ADR 16). */
export const SEAT_KEY = "graph-fight-seat";
export const MISMATCH = ["Different version.", "Reload the page, then join again."] as const;
export const HOST_LEFT = ["The host left.", "The game can't continue without the host."] as const;
const REMOVED = ["The host removed you from this game.", "Join another game from the lobby."] as const;
const UNREACHABLE = ["Wrong password, or the host can't be reached.", "Check the password or the link with the host, then join again."] as const;
const NO_HOST = ["The host can't be reached.", "The game may be gone. Join another one from the lobby."] as const;

/** What a seated peer keeps to rejoin: the room, its private token, its build, its seat id and the room password (ADR 24). */
export type Seat = { hostId: string; token: string; version: string; me: string; key?: string };

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
/** The offer of the room we are in (ADR 17, section 6). */
let roomInfo: Announce | undefined;

/** Forgets the stored seat and takes our own id as the seat id again, for a seat from an earlier game. */
export function dropSeat() {
    sessionStorage.removeItem(SEAT_KEY);
    me = selfId;
}

/** Hosts a game: advertises `next` unless it is `hidden` (a private link), and enters our own room with its `password`. */
export function hostRoom(next: Announce, hidden: boolean, share: boolean, password: string) {
    offer = next;
    unlisted = hidden;
    shareInvite = share;
    enterRoom(selfId, undefined, password);
}

/** Joins room `id`: our own when hosting, from a stored `seat` after a reload, with the room `password` of a private game (ADR 24). */
export function enterRoom(id: string, seat?: Seat, password = seat?.key ?? "") {
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

export function toLobby() {
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
