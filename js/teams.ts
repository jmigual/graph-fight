// Team mode (ADR 27): which seat plays each character, and who sits on which side in the waiting
// room. Pure, so every peer derives the same answer from `start` and the `leave`s it applied.

/** What `start` says about sides: `teams[i]` is the side of `peers[i]`, `k` the characters per player. */
export type Teams = { peers: string[]; teams?: number[]; k?: number };

/** Characters per player when `start` has no `k` (ADR 27). */
const DEFAULT_K = 3;

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
 * The engine's `players_per_team`: every side gets `c = k × S` characters, S being the largest
 * side's seat count, so a smaller side's seats play more of them.
 */
export function charactersPerSide(start: Teams): number[] {
    const sides = sidesOf(start);
    const sizes = Array.from({ length: Math.max(...sides) + 1 }, (_, t) => sides.filter((s) => s === t).length);
    return sizes.map(() => (start.k ?? DEFAULT_K) * Math.max(...sizes));
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

/** The waiting room in team mode: the seat ids on each side, at most `size` each, then the joiners waiting for a seat, in join order. */
export type Seating = { size: number; sides: string[][]; waiting: string[] };

/** An empty waiting room of `count` sides of `size` seats. */
export const newSeating = (count: number, size: number): Seating => ({ size, sides: Array.from({ length: count }, () => []), waiting: [] });

/** Seats `id` on the side with the most open seats, the lowest on a tie; when every side is full, `id` waits. */
export function join(room: Seating, id: string): Seating {
    const open = room.sides.map((s) => room.size - s.length);
    const t = open.indexOf(Math.max(...open));
    if (open[t] <= 0) return { ...room, waiting: [...room.waiting, id] };
    return { ...room, sides: room.sides.map((s, i) => (i === t ? [...s, id] : s)) };
}

/** Takes `id` out of the room; the waiting joiners, in join order, take any seat that opens. */
export function leave(room: Seating, id: string): Seating {
    const rest = { ...room, sides: room.sides.map((s) => s.filter((p) => p !== id)), waiting: [] };
    return room.waiting.filter((p) => p !== id).reduce(join, rest);
}

/**
 * Moves seated `id` to side `t`. Undefined, changing nothing, when `id` has no seat, `t` is not a
 * side, or `t` is `id`'s side or full. Nobody waits while a side has room, so none is seated after.
 */
export function move(room: Seating, id: string, t: number): Seating | undefined {
    const side = room.sides[t];
    if (!side || side.length >= room.size || side.includes(id) || !room.sides.some((s) => s.includes(id))) return undefined;
    return { ...room, sides: room.sides.map((s, i) => (i === t ? [...s, id] : s.filter((p) => p !== id))) };
}
