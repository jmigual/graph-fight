// The lobby: the list of open games, the host form and joining with a password (ADR 12, 17, 24).
import { DEFAULT_K, joinLobby, MAX_PLAYERS, newToken, selfId, stretchPassword } from "./net";
import type { Announce, OpenGame } from "./net";
import { $ } from "./dom";
import { enterRoom, hostRoom, room } from "./room";

/** Long and short (below 480 px) names of a field in the lobby (ADR 17, section 6). */
export const FIELD_NAMES = { xy: ["XY plane", "XY"], disc: ["Polar disc", "Disc"] };
/** Long and short names of a shot frame, shown after the field (ADR 20). */
export const FRAME_NAMES = { map: ["map-centred", "map"], player: ["player-centred", "player"] };

/** How a game is made up: "4 seats", or "2 teams of 2" in team mode, then "1 character each" unless the default (ADR 27). */
export function gameSize({ seats, teams, k }: Announce) {
    const size = teams.length ? [`${teams.length} teams of ${seats / teams.length}`] : [`${seats} seats`];
    return k === DEFAULT_K ? size : [...size, `${k} ${k === 1 ? "character" : "characters"} each`];
}

// One lobby connection for the page's lifetime; the host withdraws its listing once the game starts.
export const lobby = joinLobby(renderLobby);
/** The open games the lobby last listed (ADR 17, section 6). */
export let games: OpenGame[] = [];

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
                const [long, short] = FIELD_NAMES[g.field].map((name, i) => [name, FRAME_NAMES[g.frame][i], ...makeUp(g)].join(", "));
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

/**
 * A listed game's make-up after its field (ADR 27): in team mode "2 teams of 2" and each side's open
 * seats ("Team 2: 1 open"), then "1 character each" unless the default.
 */
function makeUp(g: OpenGame) {
    const size = g.seats / g.teams.length;
    const sides = g.teams.length ? [`${g.teams.length} teams of ${size}`, ...g.teams.flatMap((n, t) => (n < size ? [`Team ${t + 1}: ${size - n} open`] : []))] : [];
    return [...sides, ...gameSize(g).slice(1)];
}

const hostField = $<HTMLSelectElement>("host-field");
const hostMode = $<HTMLSelectElement>("host-mode");
const hostSeats = $<HTMLInputElement>("host-seats");
const hostTeams = $<HTMLInputElement>("host-teams");
const hostTeamSize = $<HTMLInputElement>("host-team-size");
hostSeats.max = String(MAX_PLAYERS);
/**
 * Shows the fields the field and the mode need; CSS hides a disabled one. A free-for-all on the disc
 * has Seats; Teams has the number of teams on the disc and the players per team, at most
 * `MAX_PLAYERS` seats in all. The xy field is exactly two players (ADR 5), or two teams (ADR 27).
 */
function syncHostForm() {
    const xy = hostField.value === "xy";
    const teams = hostMode.value === "teams";
    hostSeats.disabled = xy || teams;
    hostTeams.disabled = xy || !teams;
    hostTeamSize.disabled = !teams;
    if (xy) hostSeats.value = hostTeams.value = "2";
    hostTeamSize.max = String(Math.floor(MAX_PLAYERS / Math.max(2, Number(hostTeams.value) || 2)));
}
hostField.onchange = hostMode.onchange = hostTeams.oninput = syncHostForm;
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
    const hidden = hostVisibility.value === "link";
    const share = hostVisibility.value !== "public" && $<HTMLInputElement>("host-share").checked;
    // In team mode the room fills `teams` with each side's players (ADR 27).
    const sides = hostMode.value === "teams" ? Number(hostTeams.value) : 0;
    const seats = sides ? sides * Number(hostTeamSize.value) : Number(hostSeats.value);
    const k = Number($<HTMLSelectElement>("host-characters").value);
    const offer: Announce = { name: $<HTMLInputElement>("host-name").value, field, frame, players: 1, seats, locked: hostVisibility.value === "password", teams: Array<number>(sides).fill(0), k };
    forget("host-password");
    hostRoom(offer, hidden, share, password);
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

export const passwordDialog = $<HTMLDialogElement>("password-dialog");
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
