// Team mode (ADR 27): which seat plays each character, and who sits on which side in the waiting
// room. Pure, so every peer derives the same answer from `start` and the `leave`s it applied.
import type { Lineup } from "./net";

/** What `start` says about sides: `teams[i]` is the side of `peers[i]`. */
export type Teams = { peers: string[]; teams?: number[] };

/** The side of each seat in `peers`: `teams`, or one side per seat in a free-for-all. */
export const sidesOf = (start: Teams): number[] => start.teams ?? start.peers.map((_, i) => i);

/** The seats of side `t`, in `peers` order. */
export const seatsOf = (start: Teams, t: number): string[] => start.peers.filter((_, i) => sidesOf(start)[i] === t);

/** The side of `seat`, or undefined for a seat not in `peers`. */
export function sideOf(start: Teams, seat: string): number | undefined {
    const i = start.peers.indexOf(seat);
    return i < 0 ? undefined : sidesOf(start)[i];
}

/**
 * The engine's `players_per_team`: every side gets `c = k × S` characters, `k` being the characters
 * per player (`start.k ?? DEFAULT_K`, from `./net`) and S the largest side's seat count, so a
 * smaller side's seats play more of them.
 */
export function charactersPerSide(start: Teams, k: number): number[] {
    const sides = sidesOf(start);
    const sizes = Array.from({ length: Math.max(...sides) + 1 }, (_, t) => sides.filter((s) => s === t).length);
    return sizes.map(() => k * Math.max(...sizes));
}

/**
 * The seat that plays character `j` of side `t`: the side's seat `j mod n`, or when that one has
 * `left`, the next one on, cyclically, that has not. Undefined once every seat of the side has left:
 * the side is out.
 */
export function owner(start: Teams, left: ReadonlySet<string>, t: number, j: number): string | undefined {
    const seats = seatsOf(start, t);
    for (let i = 0; i < seats.length; i++) {
        const seat = seats[(j + i) % seats.length];
        if (!left.has(seat)) return seat;
    }
    return undefined;
}

/** An empty team-mode waiting room of `count` sides of `size` seats. */
export const newLineup = (count: number, size: number): Lineup => ({ size, teams: Array.from({ length: count }, () => []), waiting: [] });

/**
 * Seats `id` on the side with the most open seats, the lowest on a tie; when every side is full, `id`
 * waits. Returns `room` itself when `id` is already seated or waiting.
 */
export function join(room: Lineup, id: string): Lineup {
    if (room.waiting.includes(id) || room.teams.some((s) => s.includes(id))) return room;
    const open = room.teams.map((s) => room.size - s.length);
    const t = open.indexOf(Math.max(...open));
    if (open[t] <= 0) return { ...room, waiting: [...room.waiting, id] };
    return { ...room, teams: room.teams.map((s, i) => (i === t ? [...s, id] : s)) };
}

/** Takes `id` out of the room; the waiting joiners, in join order, take any seat that opens. */
export function leave(room: Lineup, id: string): Lineup {
    const rest = { ...room, teams: room.teams.map((s) => s.filter((p) => p !== id)), waiting: [] };
    return room.waiting.filter((p) => p !== id).reduce(join, rest);
}

/**
 * Moves seated `id` to side `t`. Undefined, changing nothing, when `id` has no seat, `t` is not a
 * side, or `t` is `id`'s side or full. Nobody waits while a side has room, so none is seated after.
 */
export function move(room: Lineup, id: string, t: number): Lineup | undefined {
    const side = room.teams[t];
    if (!side || side.length >= room.size || side.includes(id) || !room.teams.some((s) => s.includes(id))) return undefined;
    return { ...room, teams: room.teams.map((s, i) => (i === t ? [...s, id] : s.filter((p) => p !== id))) };
}
