// Networking layer (ADR 12): a lobby over plain Nostr relays and host-relayed game rooms over
// Trystero. It only carries and validates messages; it knows nothing about the game rules.
import { createEvent, joinRoom, selfId, subscribe } from "trystero";
import type { JsonValue } from "trystero";

export { selfId };

// Replaced by esbuild's `define` (scripts/build.mjs); undefined when run outside a bundle (tests).
declare const __BUILD_VERSION__: string;
declare const __LOBBY_TOPIC__: string;
/** Identifies this build; peers on another build cannot play together. */
export const BUILD_VERSION = typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : "dev";

const APP_ID = "graph-fight";
// Only the deploy build announces on the live topic (scripts/lobby-topic.mjs); anything else uses the dev one.
const LOBBY_TOPIC = typeof __LOBBY_TOPIC__ === "string" ? __LOBBY_TOPIC__ : "graph-fight:lobby:dev";
// Relays checked to accept and forward ephemeral events (ADR 12); re-check after a trystero bump.
const LOBBY_RELAYS = [
    "wss://relay.primal.net",
    "wss://relay.snort.social",
    "wss://offchain.pub",
    "wss://nostr-pub.wellorder.net",
];
const ANNOUNCE_MS = 3000;
const EXPIRE_MS = 10000;
const RECONNECT_MS = 5000;
const MAX_RECONNECT_MS = 60000;
/** Most lobby entries kept; a sender can mint free Nostr keys, so the list must be bounded. */
const MAX_LISTINGS = 100;
/** Largest relay frame parsed. */
const MAX_FRAME = 4096;

/** Upper bound on players in a room; also bounds `start.peers`. */
export const MAX_PLAYERS = 8;
/** Longest formula the Rust parser accepts. */
const MAX_EXPR = 256;
/** Longest id, seed or name accepted off the wire. */
const MAX_TEXT = 64;
/**
 * How long a seated peer's host link may stay down before it first rejoins the game room (ADR 18):
 * past the 23.3 s Trystero 0.26.0 keeps a pending answer, well before its 60 s re-announce. The
 * wait doubles after each rejoin that does not bring the host back.
 */
const REJOIN_MS = 25_000;
/** How long the host link may stay down before a seated peer gives the game up (ADR 18). */
const HOST_LOST_MS = 180_000;

export type Field = "xy" | "disc";
/** How strong a bot plays (ADR 21). */
export type BotLevel = "easy" | "medium" | "hard";
/** Where shot formulas are drawn from: the map's axes or the shooter's own frame (ADR 20). */
export type Frame = "map" | "player";

/** What a host advertises in the lobby; `locked` games need a password to join (ADR 24). */
export type Announce = { name: string; field: Field; frame: Frame; players: number; seats: number; locked: boolean };
/** The lobby wire format: `id` is the host's peer id and names the game room. */
export type Listing = Announce & { id: string; version: string };
/** A lobby entry; `compatible` is false when the host runs another build. */
export type OpenGame = Listing & { compatible: boolean };

export type Start = { type: "start"; seed: string; field: Field; frame: Frame; peers: string[]; version: string };
/** `cw` is the disc shot direction: clockwise when true, counter-clockwise when false (ADR 14). */
export type Shot = { type: "shot"; turn: number; exprs: [string] | [string, string]; cw: boolean };
export type Timeout = { type: "timeout"; turn: number };
export type Leave = { type: "leave"; peer: string };
export type GameMsg = Start | Shot | Timeout | Leave;
/** What the host broadcasts: `start` is seq 0, every later message is the previous seq + 1. */
export type Relayed = { seq: number; msg: GameMsg };

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isField = (v: unknown): v is Field => v === "xy" || v === "disc";
const isFrame = (v: unknown): v is Frame => v === "map" || v === "player";
const isCount = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** A bot's seat id in `start.peers` (ADR 21). Trystero peer ids are alphanumeric, so no peer has one. */
const BOT_ID = /^bot:(easy|medium|hard):([1-7])$/;
/** True for an id in the bot namespace, well-formed or not. */
export const isBot = (id: string) => id.startsWith("bot:");

/** The level and number of a bot's seat id, or undefined for a human's. */
export function parseBot(id: string): { level: BotLevel; n: number } | undefined {
    const m = BOT_ID.exec(id);
    return m ? { level: m[1] as BotLevel, n: Number(m[2]) } : undefined;
}

/** A local (hot-seat) player's seat id in `start.peers` (ADR 22); like a bot's, no peer can have one. */
const LOCAL_ID = /^local:([1-7])$/;
/** True for an id in the local-player namespace, well-formed or not. */
export const isLocal = (id: string) => id.startsWith("local:");

/** The number of a local player's seat id, or undefined for any other. */
export function parseLocal(id: string): number | undefined {
    const m = LOCAL_ID.exec(id);
    return m ? Number(m[1]) : undefined;
}

/** A seat the host's page plays, a bot's or a local player's: the seat book never binds it to a peer (ADR 21, 22). */
export const isHostRun = (id: string) => isBot(id) || isLocal(id);

/**
 * Returns the game message if `v` has the right shape and sizes, otherwise undefined. A `start`
 * without `frame` comes from a build before ADR 20: it reads as `map` so that `versionGate` can
 * turn it away as another version instead of it being dropped. A `start` seat that begins with
 * `bot:` must be a well-formed bot id (ADR 21), and one that begins with `local:` a well-formed
 * local player's id (ADR 22).
 */
export function parseGameMsg(v: unknown): GameMsg | undefined {
    if (!isObj(v)) return undefined;
    switch (v.type) {
        case "start": {
            const frame = v.frame === undefined ? "map" : v.frame;
            if (isText(v.seed) && isField(v.field) && isFrame(frame) && isText(v.version) && Array.isArray(v.peers) && v.peers.length > 0 && v.peers.length <= MAX_PLAYERS && v.peers.every((p) => isText(p) && (!isBot(p) || BOT_ID.test(p)) && (!isLocal(p) || LOCAL_ID.test(p)))) {
                return { type: "start", seed: v.seed, field: v.field, frame, peers: v.peers, version: v.version };
            }
            return undefined;
        }
        case "shot":
            if (isCount(v.turn) && Array.isArray(v.exprs) && (v.exprs.length === 1 || v.exprs.length === 2) && v.exprs.every((e) => isText(e, MAX_EXPR)) && typeof v.cw === "boolean") {
                return { type: "shot", turn: v.turn, exprs: v.exprs as Shot["exprs"], cw: v.cw };
            }
            return undefined;
        case "timeout":
            return isCount(v.turn) ? { type: "timeout", turn: v.turn } : undefined;
        case "leave":
            return isText(v.peer) ? { type: "leave", peer: v.peer } : undefined;
        default:
            return undefined;
    }
}

/**
 * Decides what to do with a game-room payload (ADR 12, 16, 23). A payload from the host must be a
 * sequenced broadcast, our private seat token `{seat}` or `{type: "kick"}`, which removes us from
 * the game; the host additionally takes a bare `shot`, `rejoin {token}` or `quit` from other peers
 * as a request; everything else is dropped.
 */
export function routeIncoming(
    hostId: string,
    self: string,
    from: string,
    data: unknown,
):
    | { kind: "relayed"; seq: number; msg: GameMsg }
    | { kind: "seat"; token: string }
    | { kind: "kicked" }
    | { kind: "request"; shot: Shot }
    | { kind: "rejoin"; token: string }
    | { kind: "quit" }
    | undefined {
    if (from === hostId) {
        if (isObj(data) && isText(data.seat)) return { kind: "seat", token: data.seat };
        if (isObj(data) && data.type === "kick") return { kind: "kicked" };
        if (!isObj(data) || !isCount(data.seq)) return undefined;
        const msg = parseGameMsg(data.msg);
        return msg && { kind: "relayed", seq: data.seq, msg };
    }
    if (self !== hostId || !isObj(data)) return undefined;
    if (data.type === "rejoin") return isText(data.token) ? { kind: "rejoin", token: data.token } : undefined;
    if (data.type === "quit") return { kind: "quit" };
    const msg = parseGameMsg(data);
    return msg?.type === "shot" ? { kind: "request", shot: msg } : undefined;
}

/**
 * Applies the host's broadcasts in order. Everything is dropped until `start` (seq 0) arrives,
 * so a late joiner never sees a game it missed the beginning of. After that, a repeat is
 * dropped and a gap (a message we never got) calls `onGap` once, since our state can no longer
 * match the others'; everything is then dropped until the next seq 0. A `start` at seq 0
 * always begins a fresh run: it opens the host's replay (ADR 16).
 */
export function sequencer(deliver: (msg: GameMsg) => void, onGap: () => void) {
    let next: number | null = null;
    return function accept(seq: number, msg: GameMsg) {
        if (seq === 0 && msg.type === "start") next = 0;
        if (next === null || seq < next) return;
        if (seq > next) {
            next = null;
            onGap();
            return;
        }
        next = seq + 1;
        deliver(msg);
    };
}

/**
 * Returns the listing if `v` has the right shape and sizes, otherwise undefined. A listing from
 * another build than `version` may lack `frame` (builds before ADR 20) or `locked` (before ADR 24);
 * they read as `map` and unlocked, and it is only ever shown as incompatible (ADR 12).
 */
export function parseListing(v: unknown, version: string): Listing | undefined {
    if (!isObj(v) || !isText(v.id) || !isText(v.version) || !isText(v.name) || !isField(v.field) || !isCount(v.players, MAX_PLAYERS) || !isCount(v.seats, MAX_PLAYERS)) {
        return undefined;
    }
    const old = v.version !== version;
    const frame = v.frame === undefined && old ? "map" : v.frame;
    const locked = v.locked === undefined && old ? false : v.locked;
    if (!isFrame(frame) || typeof locked !== "boolean") return undefined;
    return { id: v.id, version: v.version, name: v.name, field: v.field, frame, players: v.players, seats: v.seats, locked };
}

/** An invite link's fragment (ADR 24): the host's id, the room password and our build. */
export const inviteFragment = (hostId: string, key: string) => `#${new URLSearchParams({ join: hostId, key, v: BUILD_VERSION })}`;

/**
 * Reads an invite link's fragment (ADR 24). The link is untrusted input: undefined unless it names
 * a host and a key, and carries a build version, each at most `MAX_TEXT` long.
 */
export function parseInvite(hash: string): { hostId: string; key: string; version: string } | undefined {
    const p = new URLSearchParams(hash.replace(/^#/, ""));
    const [hostId, key, version] = [p.get("join"), p.get("key"), p.get("v")];
    return hostId && key && isText(hostId) && isText(key) && isText(version) ? { hostId, key, version } : undefined;
}

/**
 * The open-games list built from lobby announcements. Entries are keyed by the event's
 * pubkey (so a sender can only overwrite its own entry), ignore our own game, expire
 * `expireMs` after their last refresh, and stop growing at `MAX_LISTINGS`. `apply` and
 * `expire` return true when the list changed.
 */
export function lobbyBook(self: string, version: string, expireMs = EXPIRE_MS) {
    const entries = new Map<string, { game: OpenGame; at: number }>();

    function apply(key: string, content: unknown, now: number): boolean {
        if (isObj(content) && content.withdraw === true) return entries.delete(key);
        const listing = parseListing(content, version);
        if (!listing || listing.id === self) return false;
        const game = { ...listing, compatible: listing.version === version };
        const prev = entries.get(key);
        if (!prev && entries.size >= MAX_LISTINGS) return false;
        entries.set(key, { game, at: now });
        return !prev || JSON.stringify(prev.game) !== JSON.stringify(game);
    }

    function expire(now: number): boolean {
        let changed = false;
        for (const [key, e] of entries) {
            if (now - e.at >= expireMs) {
                entries.delete(key);
                changed = true;
            }
        }
        return changed;
    }

    return { apply, expire, list: () => [...entries.values()].map((e) => e.game) };
}

/** Extracts `{pubkey, content}` (content JSON-decoded) from a relay `["EVENT", sub, event]` frame. */
export function parseRelayEvent(frame: string): { pubkey: string; content: unknown } | undefined {
    if (frame.length > MAX_FRAME) return undefined;
    try {
        const msg: unknown = JSON.parse(frame);
        const event = Array.isArray(msg) && msg[0] === "EVENT" ? msg[2] : undefined;
        if (!isObj(event) || !isText(event.pubkey, MAX_TEXT) || typeof event.content !== "string") return undefined;
        return { pubkey: event.pubkey, content: JSON.parse(event.content) };
    } catch {
        // Relays and peers are untrusted: a frame that is not JSON is dropped.
        return undefined;
    }
}

export type Lobby = {
    /** Advertise (or update) the game this client hosts; null withdraws it. Sent at once. */
    announce(info: Announce | null): void;
    /** Withdraw our game, if any, and disconnect from the relays. */
    leave(): Promise<void>;
};

/**
 * Join the lobby: Nostr events over WebSocket on a few public relays, no WebRTC. `onChange`
 * receives the full list of open games whenever it changes.
 */
export function joinLobby(onChange: (games: OpenGame[]) => void): Lobby {
    const book = lobbyBook(selfId, BUILD_VERSION);
    const sockets = new Set<WebSocket>();
    let mine: Announce | null = null;
    let closed = false;
    const emit = () => onChange(book.list());

    // Reconnects with a doubling delay while a relay stays unreachable.
    function connect(url: string, delay = RECONNECT_MS) {
        if (closed) return;
        const ws = new WebSocket(url);
        let opened = false;
        sockets.add(ws);
        ws.onopen = () => {
            opened = true;
            ws.send(subscribe("lobby", LOBBY_TOPIC));
            announceMine([ws]);
        };
        ws.onmessage = (e) => {
            if (closed) return;
            const event = parseRelayEvent(String(e.data));
            if (event && book.apply(event.pubkey, event.content, Date.now())) emit();
        };
        ws.onclose = () => {
            sockets.delete(ws);
            const wait = opened ? RECONNECT_MS : delay;
            setTimeout(() => connect(url, opened ? RECONNECT_MS : Math.min(delay * 2, MAX_RECONNECT_MS)), wait);
        };
    }

    async function publish(content: Listing | { withdraw: true }, to: Iterable<WebSocket> = sockets) {
        const event = await createEvent(LOBBY_TOPIC, JSON.stringify(content));
        for (const ws of to) if (ws.readyState === WebSocket.OPEN) ws.send(event);
    }
    // A lost announcement is replaced by the next one, so failures are only logged.
    const logFailure = (err: unknown) => console.warn("lobby publish failed", err);
    function announceMine(to?: Iterable<WebSocket>) {
        if (mine) publish({ ...mine, id: selfId, version: BUILD_VERSION }, to).catch(logFailure);
    }

    LOBBY_RELAYS.forEach((url) => connect(url));
    const announceTimer = setInterval(() => announceMine(), ANNOUNCE_MS);
    const expireTimer = setInterval(() => book.expire(Date.now()) && emit(), 1000);

    return {
        announce(info) {
            mine = info;
            if (info) announceMine();
            else publish({ withdraw: true }).catch(logFailure);
        },
        async leave() {
            closed = true;
            clearInterval(announceTimer);
            clearInterval(expireTimer);
            if (mine) await publish({ withdraw: true }).catch(logFailure);
            sockets.forEach((ws) => ws.close());
        },
    };
}

/** Passes messages on, except a `start` from another build, which goes to `onMismatch`. */
export function versionGate(version: string, deliver: (msg: GameMsg) => void, onMismatch: (theirs: string) => void) {
    return (msg: GameMsg) => (msg.type === "start" && msg.version !== version ? onMismatch(msg.version) : deliver(msg));
}

/**
 * Numbers the host's outgoing messages (ADR 12) and keeps them in `log` for replays (ADR 16).
 * `stamp` throws, without consuming a number, for a message the peers would drop (invalid or
 * over a cap, which would strand them), for a second `start` (peers would keep the first game;
 * a rematch needs a new room) and for anything before `start`.
 */
export function outbox() {
    let seq = -1;
    const log: Relayed[] = [];
    return {
        started: () => seq >= 0,
        log: log as readonly Relayed[],
        stamp(msg: GameMsg): Relayed {
            if (!parseGameMsg(msg)) throw new Error("invalid message");
            if (msg.type === "start") {
                if (seq >= 0) throw new Error("start already relayed");
                seq = 0;
            } else if (seq < 0) {
                throw new Error("relay before start");
            } else {
                seq++;
            }
            log.push({ seq, msg });
            return { seq, msg };
        },
    };
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
/** A private seat token, or a private link's room password (ADR 24): 128 random bits as hex. */
export const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

/** The Trystero room of host `hostId`'s game (ADR 6, 12). */
const roomId = (hostId: string) => `game-${hostId}`;
/** PBKDF2-SHA256 rounds for a typed password (ADR 24): about 80 ms on a desktop, a few times that on a phone. */
const STRETCH_ROUNDS = 200_000;

/**
 * Turns a password someone typed into the room password of host `hostId`'s game (ADR 24). Trystero
 * derives its key from one SHA-256 of the password, the app id and the room, the encrypted offers sit
 * on public relays and the listing names the room, so a weak password could be guessed offline at
 * the speed of SHA-256. PBKDF2-SHA256 over `STRETCH_ROUNDS` rounds, salted with
 * `graph-fight:game-<hostId>`, makes each guess that much dearer. Returns 256 bits as hex.
 */
export async function stretchPassword(password: string, hostId: string): Promise<string> {
    const text = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveBits"]);
    const salt = text.encode(`${APP_ID}:${roomId(hostId)}`);
    return toHex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: STRETCH_ROUNDS }, base, 256)));
}

/**
 * Host only (ADR 16): a private token for each seat in `peers` (`start.peers`) and the peer
 * currently holding each seat. The host's own seat, 0, and the seats the host plays, bots' (ADR 21)
 * and local players' (ADR 22), have no token (`""`), so nobody can claim them; a host-run seat has
 * no holder either.
 */
export function seatBook(peers: string[]) {
    const tokens = peers.map((p, i) => (i && !isHostRun(p) ? newToken() : ""));
    const holders = peers.map((p) => (isHostRun(p) ? undefined : p));
    const revoked = new Set<string>();
    return {
        tokens: tokens as readonly string[],
        /**
         * Takes a guest's seat away for good (ADR 23): its token stops working and the seat has no
         * holder. Returns the peer that held it, or undefined for the host's seat, a host-run seat,
         * an unknown one or one already revoked.
         */
        revoke(seat: string): string | undefined {
            const i = peers.indexOf(seat);
            if (i <= 0 || !tokens[i]) return undefined;
            const holder = holders[i];
            revoked.add(tokens[i]);
            tokens[i] = "";
            holders[i] = undefined;
            return holder;
        },
        /** True for the token of a revoked seat. */
        revoked: (token: string) => revoked.has(token),
        /** Moves the seat whose token is exactly `token` to `peer`; false for an unknown token. */
        rejoin(token: string, peer: string): boolean {
            // The host's and the host-run seats share the empty token.
            if (!token) return false;
            const i = tokens.indexOf(token);
            if (i > 0) holders[i] = peer;
            return i > 0;
        },
        /** The seat id (its entry in `peers`) that `peer` holds now, if any. */
        seatOf(peer: string): string | undefined {
            const i = holders.indexOf(peer);
            return i < 0 ? undefined : peers[i];
        },
        /** Seat ids, other than the host's and the host-run ones, whose holder is not `connected`. */
        absent: (connected: (peer: string) => boolean) => peers.filter((_, i) => i > 0 && holders[i] !== undefined && !connected(holders[i])),
    };
}

export type GameHandlers = {
    /**
     * A broadcast from the host, in the order the host sent it. On the host this also fires
     * for its own `relay` calls, so every peer applies the same sequence. A `start` after the
     * first one opens a replay of the whole game (ADR 16): discard the game and rebuild it.
     */
    onMessage(msg: GameMsg): void;
    /**
     * Host only: a shooter asks for its `shot` to be applied (also called for the host's own
     * `shoot`). `from` is the seat id (its `start.peers` entry) the sender holds now. The
     * handler checks `from` is the current shooter and `shot.turn` is the current turn, then
     * calls `relay(shot)`; otherwise it ignores the request.
     */
    onShotRequest?(from: string, shot: Shot): void;
    /** The host's `start` came from a different build; we left the room, tell the user to reload. */
    onVersionMismatch(hostVersion: string): void;
    /** We missed a broadcast and hold no seat token to ask for a replay, so we left the room. */
    onDesync(): void;
    /** The host removed us from the game (ADR 23); we left the room. */
    onKicked(): void;
    /**
     * We joined without a seat and the host link never came up, even after joining the room again
     * once (ADR 24): 3 × `REJOIN_MS` in all. With a password, a wrong one looks the same as a host
     * that is gone, since no link is ever made. We left the room.
     */
    onUnreachable(): void;
    /**
     * We hold a seat and our link to the host has been down for `HOST_LOST_MS` (ADR 18). The host
     * keeps the game in memory only, so it cannot come back to it; we left the room.
     */
    onHostLost(): void;
    /** A send failed; the message may not have reached everyone. */
    onSendError(err: unknown): void;
    /** The host gave us our private seat token: keep it (never log or share it) to rejoin after a reload. */
    onSeat?(token: string): void;
    onPeerJoin?(peer: string): void;
    /** Connectivity only: a seated peer keeps its seat (ADR 16). Only a `quit` is relayed as `leave`. */
    onPeerLeave?(peer: string): void;
};

export type Game = {
    /** Ask the host to apply our shot. It takes effect only when the host broadcasts it. */
    shoot(shot: Shot): void;
    /**
     * Host only: broadcast `msg` to every peer and deliver it to our own `onMessage`. The
     * first message must be `start`, exactly once per room (a rematch needs a new room), and
     * its `peers` must only list peers already connected to us: one that joins later never
     * gets seq 0 and stays stuck. Throws on an invalid message instead of sending it.
     */
    relay(msg: GameMsg): void;
    /**
     * Give up our seat for good: the host relays `leave` for it. The host's own quit tells
     * everyone the game is over. Does nothing before `start`, or while our link to the host
     * is down (the seat then stays held).
     */
    quit(): void;
    /**
     * Host only: remove a guest (ADR 23). Before `start`, `seat` is the guest's peer id; in a game it
     * is a guest's seat id, whose token then stops working, and `leave {peer: seat}` is relayed, which
     * eliminates the team as a quit does. The peer is sent `{type: "kick"}`, and its id is ignored
     * from then on in this room (told again if it comes back). A rejoin with the revoked token gets
     * the same answer.
     */
    kick(seat: string): void;
    /**
     * Seat ids this page knows are disconnected (ADR 16): on the host, seats whose holder is
     * not connected; on another peer, the host while its link is down.
     */
    absent(): string[];
    leave(): void;
};

/**
 * Join room `game-<hostId>`; the host joins with its own `selfId`. Peers accept messages only
 * from the host. A seated peer whose link drops keeps its seat: with its seat `token` (passed
 * here after a reload) it asks the host for a replay of the game when the host link comes
 * back or when it sees a gap (ADR 16). While that link stays down it rejoins the room after
 * `REJOIN_MS`, then after twice as long each time, and gives up after `HOST_LOST_MS` (ADR 18).
 * Peer ids are announced by the peers themselves during signalling, so a modified client can
 * claim any id; that is accepted under ADR 7's trusted-peers model. A `password` (ADR 24) is
 * Trystero's room password: it encrypts the signalling, so only peers that know it connect. A typed
 * password goes through `stretchPassword` first; a private link's random key is used as it is.
 */
export function joinGame(hostId: string, handlers: GameHandlers, token?: string, password?: string): Game {
    const isHost = hostId === selfId;
    let left = false;
    let seats: ReturnType<typeof seatBook> | undefined;

    // room.leave() takes a moment, so events from a room we left or replaced are dropped.
    function open() {
        const r = joinRoom({ appId: APP_ID, password }, roomId(hostId));
        const a = r.makeAction<JsonValue>("msg");
        const live = () => !left && r === room;
        a.onMessage = (data, { peerId }) => {
            if (live()) onData(data, peerId);
        };
        r.onPeerJoin = (id) => {
            if (live()) onPeerJoin(id);
        };
        r.onPeerLeave = (id) => {
            if (live()) onPeerLeave(id);
        };
        return [r, a] as const;
    }
    let [room, action] = open();
    const hostConnected = () => hostId in room.getPeers();

    // A seated peer whose host link stays down rejoins the room, which starts a fresh signalling
    // exchange, with a doubling wait so a gone host costs the relays little, and gives the game
    // up once the link has been down for HOST_LOST_MS (ADR 18).
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let downSince = 0;
    let wait = REJOIN_MS;
    function watch() {
        clearTimeout(watchdog);
        if (isHost || !token || left) return;
        downSince = Date.now();
        wait = REJOIN_MS;
        schedule();
    }
    function schedule() {
        watchdog = setTimeout(reopen, Math.min(wait, downSince + HOST_LOST_MS - Date.now()));
    }
    function reopen() {
        if (Date.now() - downSince >= HOST_LOST_MS) {
            leave();
            return handlers.onHostLost();
        }
        renew();
        wait *= 2;
        schedule();
    }
    /** Leaves the room and joins it again, with fresh signalling state (ADR 18). */
    function renew() {
        void room.leave();
        [room, action] = open();
    }
    // After a reload the host link is not up yet.
    watch();

    // A guest that has not reached the host yet, as the watchdog does, joins the room again after
    // REJOIN_MS, then gives up after twice that: a slow relay gets a second chance, while a host that
    // is gone or, with a password, a wrong one never makes a link (ADR 24).
    let joinTimer =
        isHost || token
            ? undefined
            : setTimeout(() => {
                  renew();
                  joinTimer = setTimeout(() => (leave(), handlers.onUnreachable()), 2 * REJOIN_MS);
              }, REJOIN_MS);

    function leave() {
        left = true;
        clearTimeout(watchdog);
        clearTimeout(joinTimer);
        void room.leave();
    }

    // Local deliveries are queued so a `relay` made from inside `onMessage` runs after it.
    const queue: GameMsg[] = [];
    let draining = false;
    function deliverLocal(msg: GameMsg) {
        queue.push(msg);
        if (draining) return;
        draining = true;
        try {
            for (let m = queue.shift(); m; m = queue.shift()) handlers.onMessage(m);
        } finally {
            draining = false;
        }
    }

    const out = outbox();
    function relay(msg: GameMsg) {
        if (!isHost) throw new Error("only the host relays");
        action.send(out.stamp(msg)).catch(handlers.onSendError);
        if (msg.type === "start") {
            const book = (seats = seatBook(msg.peers));
            // Each token goes to its own seat only, never broadcast; the host's and host-run seats have none.
            msg.peers.forEach((peer, i) => book.tokens[i] && action.send({ seat: book.tokens[i] }, { target: peer }).catch(handlers.onSendError));
        }
        deliverLocal(msg);
    }

    // Peers with a replay in flight, mapped to whether another one was asked for meanwhile.
    // Under backpressure Trystero queues the entries and a newer broadcast can overtake them;
    // the peer then sees a gap and asks again, which runs once this replay has drained.
    const replays = new Map<string, boolean>();
    function replay(peer: string) {
        if (replays.has(peer)) return void replays.set(peer, true);
        replays.set(peer, false);
        // A lost entry only costs the peer another rejoin, so it does not touch the host's UI.
        void Promise.allSettled(out.log.map((entry) => action.send(entry, { target: peer }))).then((results) => {
            results.forEach((r) => r.status === "rejected" && console.warn("replay send failed", r.reason));
            const again = replays.get(peer);
            replays.delete(peer);
            if (again) replay(peer);
        });
    }

    function rejoin(seatToken: string) {
        action.send({ type: "rejoin", token: seatToken }, { target: hostId }).catch(handlers.onSendError);
    }

    // Host only: peer ids removed from this game (ADR 23). Trystero ids last one page load, so a
    // reload comes back under a new id; only a rejoin with the revoked token is recognised then.
    const banned = new Set<string>();
    function ban(peer: string) {
        banned.add(peer);
        // A lost kick only leaves the peer waiting; it is told again whenever it comes back.
        action.send({ type: "kick" }, { target: peer }).catch((err) => console.warn("kick send failed", err));
    }

    const accept = sequencer(
        versionGate(BUILD_VERSION, handlers.onMessage, (hostVersion) => {
            leave();
            handlers.onVersionMismatch(hostVersion);
        }),
        () => {
            if (token) return rejoin(token);
            leave();
            handlers.onDesync();
        },
    );

    function onData(data: JsonValue, peerId: string) {
        if (banned.has(peerId)) return;
        const routed = routeIncoming(hostId, selfId, peerId, data);
        if (routed?.kind === "relayed") {
            accept(routed.seq, routed.msg);
        } else if (routed?.kind === "seat") {
            token = routed.token;
            handlers.onSeat?.(token);
        } else if (routed?.kind === "kicked") {
            leave();
            handlers.onKicked();
        } else if (routed && seats) {
            // Requests count only from the peer holding a seat now, and act for that seat.
            if (routed.kind === "rejoin") {
                if (seats.revoked(routed.token)) ban(peerId);
                else if (seats.rejoin(routed.token, peerId)) replay(peerId);
                return;
            }
            const seat = seats.seatOf(peerId);
            if (seat && routed.kind === "request") handlers.onShotRequest?.(seat, routed.shot);
            else if (seat && routed.kind === "quit") relay({ type: "leave", peer: seat });
        }
    }
    function onPeerJoin(id: string) {
        if (banned.has(id)) return ban(id);
        if (id === hostId) {
            clearTimeout(watchdog);
            clearTimeout(joinTimer);
        }
        if (id === hostId && token) rejoin(token);
        // A seated peer back under the same id may have missed the last broadcasts, which it
        // would otherwise only notice at the next one (ADR 16).
        else if (seats?.seatOf(id)) replay(id);
        handlers.onPeerJoin?.(id);
    }
    function onPeerLeave(id: string) {
        if (id === hostId) watch();
        handlers.onPeerLeave?.(id);
    }

    return {
        shoot(shot) {
            if (isHost) handlers.onShotRequest?.(selfId, shot);
            else if (hostConnected()) action.send(shot, { target: hostId }).catch(handlers.onSendError);
            else handlers.onSendError(new Error("not connected to the host")); // Trystero would only warn
        },
        relay,
        quit() {
            if (isHost) {
                if (out.started()) relay({ type: "leave", peer: selfId });
            } else if (token && hostConnected()) {
                action.send({ type: "quit" }, { target: hostId }).catch(handlers.onSendError);
            }
        },
        kick(seat) {
            if (!isHost) throw new Error("only the host kicks");
            if (!seats) return ban(seat);
            const holder = seats.revoke(seat);
            if (holder === undefined) return;
            ban(holder);
            relay({ type: "leave", peer: seat });
        },
        absent() {
            if (isHost) return seats ? seats.absent((id) => id in room.getPeers()) : [];
            return hostConnected() ? [] : [hostId];
        },
        leave,
    };
}
