// Networking layer (ADR 12): host-relayed game rooms over Trystero. It only carries and
// validates messages; it knows nothing about the game rules.
import { joinRoom, selfId } from "trystero";
import type { JsonValue } from "trystero";

export { selfId };

const APP_ID = "graph-fight";

/** Upper bound on players in a room; also bounds `start.peers`. */
export const MAX_PLAYERS = 8;
/** Longest formula the Rust parser accepts. */
const MAX_EXPR = 256;
/** Longest id, seed or name accepted off the wire. */
const MAX_TEXT = 64;

export type Field = "xy" | "disc";

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
