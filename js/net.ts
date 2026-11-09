// Networking layer (ADR 12): a lobby over plain Nostr relays and host-relayed game rooms over
// Trystero. It only carries and validates messages; it knows nothing about the game rules.
import { createEvent, joinRoom, selfId, subscribe } from "trystero";
import type { JsonValue } from "trystero";

export { selfId };

const APP_ID = "graph-fight";
const LOBBY_TOPIC = "graph-fight:lobby";
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

export type Field = "xy" | "disc";

/** What a host advertises in the lobby. */
export type Announce = { name: string; field: Field; players: number; seats: number };
/** The lobby wire format and list entry: `id` is the host's peer id and names the game room. */
export type Listing = Announce & { id: string };
export type OpenGame = Listing;

export type Start = { type: "start"; seed: string; field: Field; peers: string[] };
export type Shot = { type: "shot"; turn: number; exprs: [string] | [string, string] };
export type Timeout = { type: "timeout"; turn: number };
export type Leave = { type: "leave"; peer: string };
export type GameMsg = Start | Shot | Timeout | Leave;
/** What the host broadcasts: `start` is seq 0, every later message is the previous seq + 1. */
export type Relayed = { seq: number; msg: GameMsg };

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const isField = (v: unknown): v is Field => v === "xy" || v === "disc";
const isCount = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;

/** Returns the game message if `v` has the right shape and sizes, otherwise undefined. */
export function parseGameMsg(v: unknown): GameMsg | undefined {
    if (!isObj(v)) return undefined;
    switch (v.type) {
        case "start":
            if (isText(v.seed) && isField(v.field) && Array.isArray(v.peers) && v.peers.length > 0 && v.peers.length <= MAX_PLAYERS && v.peers.every((p) => isText(p))) {
                return { type: "start", seed: v.seed, field: v.field, peers: v.peers };
            }
            return undefined;
        case "shot":
            if (isCount(v.turn) && Array.isArray(v.exprs) && (v.exprs.length === 1 || v.exprs.length === 2) && v.exprs.every((e) => isText(e, MAX_EXPR))) {
                return { type: "shot", turn: v.turn, exprs: v.exprs as Shot["exprs"] };
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
 * Decides what to do with a game-room payload (ADR 12). A payload from the host must be a
 * sequenced broadcast; the host additionally takes a bare `shot` from other peers as a
 * request; everything else is dropped.
 */
export function routeIncoming(
    hostId: string,
    self: string,
    from: string,
    data: unknown,
): { kind: "relayed"; seq: number; msg: GameMsg } | { kind: "request"; shot: Shot } | undefined {
    if (from === hostId) {
        if (!isObj(data) || !isCount(data.seq)) return undefined;
        const msg = parseGameMsg(data.msg);
        return msg && { kind: "relayed", seq: data.seq, msg };
    }
    const msg = self === hostId ? parseGameMsg(data) : undefined;
    return msg?.type === "shot" ? { kind: "request", shot: msg } : undefined;
}

/**
 * Applies the host's broadcasts in order. Everything is dropped until `start` (seq 0) arrives,
 * so a late joiner never sees a game it missed the beginning of. After that, a repeat is
 * dropped and a gap (a message we never got) calls `onDesync`, since our state can no
 * longer match the others'.
 */
export function sequencer(deliver: (msg: GameMsg) => void, onDesync: () => void) {
    let next: number | null = null;
    return function accept(seq: number, msg: GameMsg) {
        if (next === null) {
            if (seq !== 0 || msg.type !== "start") return;
        } else if (seq < next) {
            return;
        } else if (seq > next) {
            onDesync();
            return;
        }
        next = seq + 1;
        deliver(msg);
    };
}

/** Returns the listing if `v` has the right shape and sizes, otherwise undefined. */
export function parseListing(v: unknown): Listing | undefined {
    if (!isObj(v) || !isText(v.id) || !isText(v.name) || !isField(v.field) || !isCount(v.players, MAX_PLAYERS) || !isCount(v.seats, MAX_PLAYERS)) {
        return undefined;
    }
    return { id: v.id, name: v.name, field: v.field, players: v.players, seats: v.seats };
}

/**
 * The open-games list built from lobby announcements. Entries are keyed by the event's
 * pubkey (so a sender can only overwrite its own entry), ignore our own game, expire
 * `expireMs` after their last refresh, and stop growing at `MAX_LISTINGS`. `apply` and
 * `expire` return true when the list changed.
 */
export function lobbyBook(self: string, expireMs = EXPIRE_MS) {
    const entries = new Map<string, { game: OpenGame; at: number }>();

    function apply(key: string, content: unknown, now: number): boolean {
        if (isObj(content) && content.withdraw === true) return entries.delete(key);
        const game = parseListing(content);
        if (!game || game.id === self) return false;
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
    const book = lobbyBook(selfId);
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
            const event = parseRelayEvent(String(e.data));
            if (event && book.apply(event.pubkey, event.content, Date.now())) emit();
        };
        ws.onclose = () => {
            sockets.delete(ws);
            setTimeout(() => connect(url, opened ? RECONNECT_MS : Math.min(delay * 2, MAX_RECONNECT_MS)), delay);
        };
    }

    async function publish(content: Listing | { withdraw: true }, to: Iterable<WebSocket> = sockets) {
        const event = await createEvent(LOBBY_TOPIC, JSON.stringify(content));
        for (const ws of to) if (ws.readyState === WebSocket.OPEN) ws.send(event);
    }
    // A lost announcement is replaced by the next one, so failures are only logged.
    const logFailure = (err: unknown) => console.warn("lobby publish failed", err);
    function announceMine(to?: Iterable<WebSocket>) {
        if (mine) publish({ ...mine, id: selfId }, to).catch(logFailure);
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

export type GameHandlers = {
    /**
     * A broadcast from the host, in the order the host sent it. On the host this also fires
     * for its own `relay` calls, so every peer applies the same sequence.
     */
    onMessage(msg: GameMsg): void;
    /**
     * Host only: a shooter asks for its `shot` to be applied (also called for the host's own
     * `shoot`). The handler checks `from` is the current shooter and `shot.turn` is the
     * current turn, then calls `relay(shot)`; otherwise it ignores the request.
     */
    onShotRequest?(from: string, shot: Shot): void;
    /** We missed a broadcast, so we left the room: the game cannot continue for us. */
    onDesync(): void;
    /** A send failed; the message may not have reached everyone. */
    onSendError(err: unknown): void;
    onPeerJoin?(peer: string): void;
    /** Connectivity only. The host learns of departures through the relayed `leave`. */
    onPeerLeave?(peer: string): void;
};

export type Game = {
    /** Ask the host to apply our shot. It takes effect only when the host broadcasts it. */
    shoot(shot: Shot): void;
    /**
     * Host only: broadcast `msg` to every peer and deliver it to our own `onMessage`. The
     * first message must be `start`.
     */
    relay(msg: GameMsg): void;
    leave(): void;
};

/**
 * Join room `game-<hostId>`; the host joins with its own `selfId`. Peers accept messages only
 * from the host. On the host, a peer leaving after `start` is relayed as a `leave` message.
 * Peer ids are announced by the peers themselves during signalling, so a modified client can
 * claim any id; that is accepted under ADR 7's trusted-peers model.
 */
export function joinGame(hostId: string, handlers: GameHandlers): Game {
    const room = joinRoom({ appId: APP_ID }, `game-${hostId}`);
    const action = room.makeAction<JsonValue>("msg");
    const isHost = hostId === selfId;
    let left = false;

    function leave() {
        left = true;
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

    let seq = -1; // -1 until the host relays `start`
    function relay(msg: GameMsg) {
        if (!isHost) throw new Error("only the host relays");
        if (msg.type === "start") seq = 0;
        else if (seq < 0) throw new Error("relay before start");
        else seq++;
        const relayed: Relayed = { seq, msg };
        action.send(relayed).catch(handlers.onSendError);
        deliverLocal(msg);
    }

    const accept = sequencer(handlers.onMessage, () => {
        leave();
        handlers.onDesync();
    });

    action.onMessage = (data, { peerId }) => {
        if (left) return;
        const routed = routeIncoming(hostId, selfId, peerId, data);
        if (routed?.kind === "relayed") accept(routed.seq, routed.msg);
        else if (routed?.kind === "request") handlers.onShotRequest?.(peerId, routed.shot);
    };
    room.onPeerJoin = (id) => handlers.onPeerJoin?.(id);
    room.onPeerLeave = (id) => {
        if (isHost && seq >= 0) relay({ type: "leave", peer: id });
        handlers.onPeerLeave?.(id);
    };

    return {
        shoot(shot) {
            if (isHost) handlers.onShotRequest?.(selfId, shot);
            else action.send(shot, { target: hostId }).catch(handlers.onSendError);
        },
        relay,
        leave,
    };
}
