// Team mode's views (ADR 27): the roster grouped by side. DOM only; game.ts passes in what it knows.
import type { Arena } from "../pkg/index.js";
import { isHostRun } from "./net";
import { replaceRoster, seatName, short, teamColour } from "./status";
import { seatsOf } from "./teams";
import type { Teams } from "./teams";

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
