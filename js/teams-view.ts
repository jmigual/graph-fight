// Team mode's views (ADR 27): the waiting room's side lists and the roster grouped by side. DOM
// only; room.ts and game.ts pass in what they know.
import type { Arena } from "../pkg/index.js";
import { isHostRun } from "./net";
import type { Lineup } from "./net";
import { replaceRoster, seatName, short, teamColour } from "./status";
import { seatsOf } from "./teams";
import type { Teams } from "./teams";

/**
 * The waiting room in team mode: `#room-players` holds one list per side ("Team 1, 2 of 2"), then
 * the joiners waiting for a seat. `row` builds a seat's row. The host (`move`) gets a **Move to
 * Team N** button on every row for each other side with room; a seated guest (`ask`) gets **Join
 * Team N** on each other side with room. The keyboard stays on the button it was on, or goes to the
 * list when that button is gone.
 */
export function renderLineup(lineup: Lineup, me: string, row: (id: string) => HTMLLIElement, { move, ask }: { move?: (id: string, team: number) => void; ask?: (team: number) => void }) {
    const list = document.getElementById("room-players")!;
    const active = document.activeElement;
    const focused = active instanceof HTMLButtonElement && list.contains(active) ? (active.getAttribute("aria-label") ?? active.textContent) : null;
    const button = (text: string, label: string | null, onclick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        b.textContent = text;
        if (label) b.setAttribute("aria-label", label);
        b.onclick = onclick;
        return b;
    };
    const room = (t: number) => lineup.teams[t].length < lineup.size;
    const mine = lineup.teams.findIndex((t) => t.includes(me));
    const group = (head: HTMLElement, ids: string[], className: string) => {
        const li = document.createElement("li");
        li.className = className;
        li.append(head);
        const seats = li.appendChild(document.createElement("ul"));
        seats.className = "seats";
        for (const id of ids) {
            const seat = seats.appendChild(row(id));
            if (!move || className !== "side") continue;
            // The row's own buttons (Remove) go after its Move buttons, in one group on the right.
            const actions = document.createElement("span");
            actions.className = "row-actions";
            lineup.teams.forEach((t, ti) => {
                if (!t.includes(id) && room(ti)) actions.append(button(`Move to Team ${ti + 1}`, `Move ${seatName(id)} to Team ${ti + 1}`, () => move(id, ti)));
            });
            actions.append(...seat.querySelectorAll("button"));
            seat.append(actions);
        }
        return li;
    };
    list.replaceChildren(
        ...lineup.teams.map((ids, ti) => {
            const head = document.createElement("div");
            head.className = "side-head";
            head.append(`Team ${ti + 1}, ${ids.length} of ${lineup.size}`);
            if (ask && mine >= 0 && mine !== ti && room(ti)) head.append(button(`Join Team ${ti + 1}`, null, () => ask(ti)));
            return group(head, ids, "side");
        }),
        ...(lineup.waiting.length ? [group(Object.assign(document.createElement("div"), { className: "side-head", textContent: "Waiting for a seat" }), lineup.waiting, "waiting")] : []),
    );
    if (focused === null) return;
    const again = [...list.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === focused);
    if (again) again.focus();
    else {
        list.tabIndex = -1;
        list.focus();
    }
}

/** What the grouped roster shows of a game in team mode. */
export type SidesView = {
    arena: Arena;
    /** `start.peers` and `start.teams`. */
    start: Teams;
    /** Seats whose `leave` was applied. */
    left: ReadonlySet<string>;
    /** Our seat id. */
    me: string;
    /** The current team, null once the game is over. */
    current: number | null;
    /** The seat aiming now. */
    shooter: string;
    /** Seats this page knows are disconnected. */
    absent: string[];
    /** The current shooter plays on this page. */
    mine: boolean;
};

/**
 * The roster in team mode: one entry per side with its pips, then its seats, each with "you",
 * "aiming" on the current seat, "disconnected" or "left". With `kick` (the host, in a game), each
 * guest's seat still in gets a Kick button named after it (ADR 23, 27).
 */
export function renderSides({ arena, start, left, me, current, shooter, absent, mine }: SidesView, kick?: (seat: string) => void) {
    replaceRoster(
        arena.teams.map((t, ti) => {
            const li = document.createElement("li");
            li.style.setProperty("--team", teamColour(ti));
            const add = (parent: HTMLElement, cls: string, text: string) => {
                const el = parent.appendChild(document.createElement("span"));
                el.className = cls;
                el.textContent = text;
                return el;
            };
            const alive = t.players.filter((pl) => pl.alive).length;
            add(li, "swatch", String(ti + 1)).setAttribute("aria-hidden", "true");
            add(li, "team", `Team ${ti + 1}`);
            if (alive === 0) add(li, "state", "out");
            const pips = add(li, "pips", "●".repeat(alive) + "○".repeat(t.players.length - alive));
            pips.setAttribute("role", "img");
            pips.setAttribute("aria-label", `${alive} of ${t.players.length} players left`);
            const seats = li.appendChild(document.createElement("ul"));
            seats.className = "seats";
            for (const seat of seatsOf(start, ti)) {
                const row = seats.appendChild(document.createElement("li"));
                add(row, "id", seatName(seat));
                if (seat === me) add(row, "you", "you");
                const state = left.has(seat) ? "left" : absent.includes(seat) ? "disconnected" : current === ti && seat === shooter ? "aiming" : "";
                if (state) add(row, "state", state);
                if (kick && seat !== start.peers[0] && !isHostRun(seat) && !left.has(seat) && alive > 0) {
                    const button = row.appendChild(document.createElement("button"));
                    button.type = "button";
                    button.className = "secondary";
                    button.textContent = "Kick";
                    button.setAttribute("aria-label", `Kick ${short(seat)}`);
                    button.onclick = () => kick(seat);
                }
            }
            li.classList.toggle("out", alive === 0);
            li.classList.toggle("current", current === ti && mine);
            return li;
        }),
    );
}
