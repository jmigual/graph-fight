// The game screen's words: status bar, roster, last-shot text and the error line (ADR 17, sections 6, 10, 11).
// DOM only; it holds no game state, so index.ts passes in what it knows.
import type { Arena } from "../pkg/index.js";
import { parseBot } from "./net";
import type { Field, Shot, Timeout } from "./net";
import { shotText } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export const TITLE = document.title;
const LIVE_DELAY_MS = 50;
const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

export const short = (id: string) => id.slice(0, 6);
/** What a seat is called: "Bot 1, hard" for a bot (ADR 21), a human's short id otherwise. */
export function seatName(id: string) {
    const bot = parseBot(id);
    return bot ? `Bot ${bot.n}, ${bot.level}` : short(id);
}
const teamColour = (team: number) => `var(--team-${(team % 8) + 1})`;
export const aliveCounts = (arena: Arena) => arena.teams.map((t) => t.players.filter((pl) => pl.alive).length);

/** Writes only a changed text, since some screen readers announce a live region on every write, even of the same text. */
export function setText(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
}

/**
 * Replaces the text of a live region. It is emptied first and filled `LIVE_DELAY_MS` later,
 * because some screen readers do not announce a text identical to the last one. `then` runs on fill.
 */
export function setLive(el: HTMLElement, text: string, then?: () => void) {
    clearTimeout(timers.get(el));
    el.textContent = "";
    if (!text) return;
    timers.set(
        el,
        setTimeout(() => {
            el.textContent = text;
            then?.();
        }, LIVE_DELAY_MS),
    );
}

/** The formula inputs a shown error refers to: the second one only while it is visible. */
const formulaInputs = () => [$<HTMLInputElement>("input-a"), $<HTMLInputElement>("input-b")].filter((input) => !input.closest("[hidden]"));

/** Empties the error line; the formula inputs stop being invalid. */
export function clearError() {
    setLive($("error"), "");
    for (const input of [$("input-a"), $("input-b")]) input.removeAttribute("aria-invalid");
}

/** Shows `message` in the alert line. `invalid` (a formula problem, not a send failure) also marks the inputs. */
export function showError(message: string, invalid = true) {
    clearError();
    setLive($("error"), message, () => invalid && formulaInputs().forEach((input) => input.setAttribute("aria-invalid", "true")));
}

/** Says "Your turn" to screen readers when `mine`, once per turn start. */
export function cueTurn(mine: boolean) {
    setLive($("turn-cue"), mine ? "Your turn" : "");
}

export type Status = {
    over: boolean;
    team: number;
    /** The current shooter is ours. */
    mine: boolean;
    /** We are a guest and our link to the host is down (ADR 16). */
    hostDown: boolean;
    /** The current shooter's seat is disconnected. */
    away: boolean;
};

/** Status bar, tab title and team colour: the host link, a disconnected shooter, or whose turn it is. */
export function renderStatus({ over, team, mine, hostDown, away }: Status) {
    $("game").style.setProperty("--team", over ? "" : teamColour(team));
    setText($("turn-swatch"), over ? "" : String(team + 1));
    const words = hostDown ? "Reconnecting to the host…" : away ? `Team ${team + 1} is disconnected. The timer will skip its turn.` : mine ? "Your turn" : `Team ${team + 1} is aiming`;
    setText($("turn"), over ? "" : words);
    $("turn").classList.toggle("quiet", !over && hostDown);
    $("timer").hidden = over;
    document.title = mine && !over && !hostDown ? `Your turn | ${TITLE}` : TITLE;
}

/** The board's text alternative for a shot or timeout: who fired what, and who lost players. */
export function describeTurn(field: Field, team: number, msg: Shot | Timeout, fired: boolean, before: number[], after: number[]) {
    let text = `Team ${team + 1} `;
    if (msg.type === "timeout") text += "ran out of time.";
    else if (!fired) text += "fired a formula that failed, so the turn was skipped.";
    else text += `fired ${shotText(field, msg.exprs)}${field === "disc" ? (msg.cw ? ", clockwise" : ", counterclockwise") : ""}.`;
    after.forEach((n, t) => {
        const lost = before[t] - n;
        if (lost > 0) text += ` Team ${t + 1} lost ${lost === 1 ? "a player" : `${lost} players`}.`;
    });
    return text;
}

/** The roster: one row per team, with players left and what the team is doing (ADR 17, section 10). */
export function renderRoster(arena: Arena, peers: string[], me: string, current: number | null, absent: number[]) {
    $("roster").replaceChildren(
        ...arena.teams.map((t, ti) => {
            const li = document.createElement("li");
            li.style.setProperty("--team", teamColour(ti));
            const add = (cls: string, text: string) => {
                const el = li.appendChild(document.createElement("span"));
                el.className = cls;
                el.textContent = text;
                return el;
            };
            const left = t.players.filter((pl) => pl.alive).length;
            add("swatch", String(ti + 1)).setAttribute("aria-hidden", "true");
            add("team", `Team ${ti + 1}`);
            add("id", seatName(peers[ti]));
            if (peers[ti] === me) add("you", "you");
            const state = left === 0 ? "out" : absent.includes(ti) ? "disconnected" : current === ti ? "aiming" : "";
            if (state) add("state", state);
            const pips = add("pips", "●".repeat(left) + "○".repeat(t.players.length - left));
            pips.setAttribute("role", "img");
            pips.setAttribute("aria-label", `${left} of ${t.players.length} players left`);
            li.classList.toggle("out", left === 0);
            li.classList.toggle("current", current === ti && peers[ti] === me);
            return li;
        }),
    );
}
