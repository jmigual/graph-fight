// The test arena (ADR 25): an offline sandbox on the game's board and formula editor. Players and
// obstacles are placed by hand and any player fires; nothing is permanent and nothing is sent.
import { Field as WasmField, Frame as WasmFrame, Game as Sim } from "../pkg/index.js";
import type { Point, TrialShot } from "../pkg/index.js";
import { MAX_PLAYERS } from "./net";
import type { Field, Frame } from "./net";
import { sliderError } from "./editor";
import { describeTrial, draw, lookAfterShot, lookKey, pickAt, playerName, toWorld } from "./render";
import type { Disc, LastShot, Look, Pick, View } from "./render";
import { clearError, setLive, showError } from "./status";

/** A field's arena constants, which `js/index.ts` keeps for games (ADR 15). */
export type Extents = { x: number; y: number; obstacles: number; minSize: number; maxSize: number };

/** A press this close (CSS px) to the edge of a player or obstacle is on it, so small faces can be tapped. */
const SLACK_PX = 10;
/** Moving this far (CSS px) with a mouse or pen turns a press into a drag; a finger needs `SLACK_PX`. */
const DRAG_PX = 4;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const same = (a: Pick | null, b: Pick | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Wires the lobby's Test arena button and the arena's controls. The arena reuses the game section:
 * `#game[data-mode=test]` hides the match's parts. `editor` is the game's (`initEditor`), `show`
 * switches sections, `arenas` and `radius` are the game's constants. Returns the redraw that the
 * page runs when the board's size, theme or fonts change.
 */
export function initArena(editor: { refresh(field: Field, parametric: boolean): void }, show: (...names: string[]) => void, arenas: Record<Field, Extents>, radius: number) {
    const canvas = $<HTMLCanvasElement>("arena");
    let active = false;
    let field: Field = "xy";
    let frame: Frame = "map";
    /** Players by team in the engine's order, so `teams[t][i]` is `[t, i]` in a shot's hits and in `lookKey`. */
    let teams: Point[][] = [];
    let obstacles: Disc[] = [];
    /** What Delete removes; choosing a player also makes it the shooter, which an obstacle's selection keeps. */
    let selected: Pick | null = null;
    let shooter: [number, number] | null = null;
    let sim: Sim | undefined;
    // As in a game (ADR 17): the newest shot, each player's last one and the gaze it left; and the newest's hits.
    let shot: LastShot | null = null;
    let shots = new Map<string, LastShot>();
    let looks = new Map<string, Look>();
    let hits: View["hits"];
    let view: View | undefined;

    /** As many teams as a game on this field can have: 2 on XY, `MAX_PLAYERS` on the disc (ADR 5, 15). */
    const teamCount = () => (field === "xy" ? 2 : MAX_PLAYERS);
    const parametric = () => $<HTMLInputElement>("mode-parametric").checked;
    const clockwise = () => field === "disc" && $<HTMLInputElement>("dir-cw").checked;

    function clearPaths() {
        shot = null;
        shots = new Map();
        looks = new Map();
        hits = undefined;
        setLive($("last-shot"), "");
    }

    /**
     * Makes this the setup if the engine accepts it, and clears the paths, which belonged to the
     * old one. A refused setup changes nothing; with `failure`, it is shown with the engine's reason.
     */
    function commit(nextTeams: Point[][], nextObstacles: Disc[], failure?: string): boolean {
        let next: Sim;
        try {
            const players = nextTeams.flatMap((spots, team) => spots.map(({ x, y }) => ({ x, y, team })));
            const a = arenas[field];
            next = Sim.sandbox(field === "xy" ? WasmField.Xy : WasmField.Disc, frame === "map" ? WasmFrame.Map : WasmFrame.Player, a.x, a.y, radius, players, nextObstacles);
        } catch (err) {
            if (failure) setLive($("test-error"), `${failure} ${err}.`);
            return false;
        }
        sim?.free();
        sim = next;
        teams = nextTeams;
        obstacles = nextObstacles;
        setLive($("test-error"), "");
        clearPaths();
        return true;
    }

    function render(animate = false) {
        if (!sim) return;
        const at = shooter;
        const arena = sim.arena();
        // The selected player is the shooter: the board rings it and shows where its formula starts.
        if (at) arena.teams[at[0]].currentPlayer = at[1];
        const picked = selected && "obstacle" in selected ? selected.obstacle : undefined;
        const next: View = { field, frame, arena, current: at && at[0], mine: true, cw: clockwise(), shot, shots: new Map(shots), looks: new Map(looks), absent: [], hits, picked };
        // A new shot is drawn with a pen on the board as it was, unless motion is reduced (ADR 17).
        const before = animate && view && !matchMedia("(prefers-reduced-motion: reduce)").matches ? { ...view, hits: undefined } : undefined;
        draw(canvas, next, before);
        view = next;
        renderItems();
        $<HTMLButtonElement>("fire").disabled = !at;
    }

    /** The keyboard's way to the board: one button per player and obstacle, pressed when selected. */
    function renderItems() {
        const list = $("test-items");
        const focused = [...list.querySelectorAll("button")].indexOf(document.activeElement as HTMLButtonElement);
        const where = (p: Point) => `at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
        const item = (text: string, pick: Pick) => {
            const li = document.createElement("li");
            const button = li.appendChild(document.createElement("button"));
            button.type = "button";
            button.className = "secondary";
            button.textContent = text;
            button.setAttribute("aria-pressed", String(same(pick, selected)));
            button.onclick = () => select(pick);
            button.onkeydown = (e) => {
                if (e.key !== "Delete" && e.key !== "Backspace") return;
                e.preventDefault();
                selected = pick;
                remove();
            };
            return li;
        };
        list.replaceChildren(
            ...teams.flatMap((spots, t) => spots.map((p, i) => item(`${playerName(t, i)} ${where(p)}${same({ player: [t, i] }, shooter && { player: shooter }) ? ", shooter" : ""}`, { player: [t, i] }))),
            ...obstacles.map((o, i) => item(`Obstacle ${i + 1}, radius ${o.r.toFixed(1)}, ${where(o)}`, { obstacle: i })),
        );
        $("test-empty").hidden = list.childElementCount > 0;
        // Keep the keyboard in the list: on the same row, or the one before if the last row went.
        if (focused >= 0) (list.querySelectorAll("button")[Math.min(focused, list.childElementCount - 1)] ?? $("test-items-heading")).focus();
    }

    function select(pick: Pick) {
        selected = pick;
        if ("player" in pick) shooter = pick.player;
        setLive($("test-error"), "");
        render();
    }

    function remove() {
        const pick = selected;
        if (!pick) return setLive($("test-error"), "Choose a player or an obstacle to remove.");
        selected = null;
        if ("obstacle" in pick) commit(teams, obstacles.filter((_, i) => i !== pick.obstacle));
        else {
            const [team, i] = pick.player;
            commit(teams.map((spots, t) => (t === team ? spots.filter((_, j) => j !== i) : spots)), obstacles);
            // The shooter goes with it, or moves up a place when an earlier teammate went.
            if (shooter?.[0] === team) shooter = shooter[1] === i ? null : [team, shooter[1] - (shooter[1] > i ? 1 : 0)];
        }
        render();
    }

    /** Puts what `#test-panel`'s Place chooses at `p`; a player placed while there is no shooter becomes it. */
    function place(p: Point) {
        const tool = document.querySelector<HTMLInputElement>("input[name=place]:checked")?.value;
        if (tool === "obstacle") {
            if (commit(teams, [...obstacles, { ...p, r: $<HTMLInputElement>("obstacle-size").valueAsNumber }], "Can't place an obstacle there.")) render();
            return;
        }
        const team = Number($<HTMLSelectElement>("test-team").value);
        const next = teams.map((spots, t) => (t === team ? [...spots, p] : spots));
        if (!commit(next, obstacles, "Can't place a player there.")) return;
        if (!shooter) select({ player: [team, next[team].length - 1] });
        else render();
    }

    const move = ([team, i]: [number, number], p: Point, failure?: string) =>
        commit(teams.map((spots, t) => (t === team ? spots.map((q, j) => (j === i ? p : q)) : spots)), obstacles, failure);

    // A click on a player or an obstacle selects it, and one elsewhere places. Dragging a player moves
    // it without choosing it as the shooter; it only moves through valid spots, and letting go on an
    // invalid one says why.
    const worldAt = (e: PointerEvent) => {
        const box = canvas.getBoundingClientRect();
        return toWorld(e.clientX - box.left, e.clientY - box.top, box.width, arenas[field].x, arenas[field].y);
    };
    // A press follows one pointer. `moved` is set once it goes `threshold` px from where it started,
    // larger for a finger: then it is a drag (on a player) or a swipe, never a click.
    type Press = { id: number; pick: Pick | null; x: number; y: number; threshold: number; moved: boolean; refused: boolean };
    let press: Press | null = null;
    const ours = (e: PointerEvent) => press?.id === e.pointerId;
    const far = (p: Press, e: PointerEvent) => p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= p.threshold;
    canvas.addEventListener("pointerdown", (e) => {
        if (!active || !e.isPrimary) return;
        const slack = (SLACK_PX * 2 * arenas[field].x) / canvas.clientWidth;
        const pick = pickAt(teams, obstacles, worldAt(e), radius, slack);
        press = { id: e.pointerId, pick, x: e.clientX, y: e.clientY, threshold: e.pointerType === "touch" ? SLACK_PX : DRAG_PX, moved: false, refused: false };
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
        if (!press || !ours(e) || !far(press, e)) return;
        press.moved = true;
        if (!press.pick || !("player" in press.pick)) return;
        press.refused = !move(press.pick.player, worldAt(e));
        if (!press.refused) render();
    });
    canvas.addEventListener("pointerup", (e) => {
        if (!press || !ours(e)) return;
        const p = press;
        press = null;
        if (!active) return;
        if (far(p, e)) {
            if (p.refused && p.pick && "player" in p.pick) move(p.pick.player, worldAt(e), "Can't move it there.");
        } else if (p.pick) select(p.pick);
        else place(worldAt(e));
    });
    canvas.addEventListener("pointercancel", (e) => {
        if (ours(e)) press = null;
    });
    // Delete or Backspace removes the selection after a click on the board, where the focus is on the page.
    document.addEventListener("keydown", (e) => {
        if (!active || (e.key !== "Delete" && e.key !== "Backspace") || e.target !== document.body) return;
        e.preventDefault();
        remove();
    });

    /** Starts over on the chosen field and frame, with nothing on the board. */
    function reset() {
        field = $<HTMLSelectElement>("test-field").value === "disc" ? "disc" : "xy";
        frame = $<HTMLSelectElement>("test-frame").value === "player" ? "player" : "map";
        $("game").dataset.field = field;
        // The direction is shown on the disc only, as in a game (ADR 17).
        $("direction").hidden = field !== "disc";
        editor.refresh(field, parametric());
        selected = shooter = null;
        // The team list follows the field; a team the field has stays chosen.
        const choice = $<HTMLSelectElement>("test-team");
        const team = Math.min(Number(choice.value) || 0, teamCount() - 1);
        choice.replaceChildren(
            ...Array.from({ length: teamCount() }, (_, t) => {
                const option = document.createElement("option");
                option.value = String(t);
                option.textContent = `Team ${t + 1}`;
                return option;
            }),
        );
        choice.value = String(team);
        showTeam();
        commit(Array.from({ length: teamCount() }, () => []), []);
        render();
    }
    /** The swatch beside the team list: the team's number on its colour, as on the board (ADR 17). */
    function showTeam() {
        const t = Number($<HTMLSelectElement>("test-team").value);
        const swatch = $("test-swatch");
        swatch.textContent = String(t + 1);
        swatch.style.setProperty("--team", `var(--team-${t + 1})`);
    }
    $("test-team").onchange = showTeam;
    $("test-field").onchange = reset;
    $("test-frame").onchange = () => {
        frame = $<HTMLSelectElement>("test-frame").value === "player" ? "player" : "map";
        commit(teams, obstacles);
        render();
    };

    $("test-open").onclick = () => {
        active = true;
        $("game").dataset.mode = "test";
        // A game we were out of hid the editor, and leaving it does not bring it back.
        $("shot-form").hidden = false;
        clearError();
        reset();
        show("game");
    };
    $("test-exit").onclick = () => {
        active = false;
        delete $("game").dataset.mode;
        sim?.free();
        sim = view = undefined;
        clearError();
        setLive($("last-shot"), "");
        setLive($("test-error"), "");
        show("lobby");
        $("test-open").focus();
    };

    const size = $<HTMLInputElement>("obstacle-size");
    size.oninput = () => ($("obstacle-size-value").textContent = size.valueAsNumber.toFixed(1));
    $("random-obstacles").onclick = () => {
        if (!sim) return;
        const a = arenas[field];
        let random: Sim;
        try {
            random = sim.with_random_obstacles(a.obstacles, a.minSize, a.maxSize, crypto.getRandomValues(new BigUint64Array(1))[0]);
        } catch (err) {
            return setLive($("test-error"), `No room for random obstacles. ${err}.`);
        }
        const next = random.arena().obstacles.map((o) => ({ x: o.pos.x, y: o.pos.y, r: o.radius }));
        random.free();
        if (selected && "obstacle" in selected) selected = null;
        commit(teams, next);
        render();
    };
    $("clear-obstacles").onclick = () => {
        if (selected && "obstacle" in selected) selected = null;
        commit(teams, []);
        render();
    };
    $("clear-paths").onclick = () => {
        clearPaths();
        render();
    };
    $("remove-selected").onclick = remove;

    document.querySelectorAll("input[name=mode]").forEach((el) => el.addEventListener("change", () => active && editor.refresh(field, parametric())));
    // The direction moves our shooter's sweep marks and gaze (ADR 17).
    document.querySelectorAll("input[name=dir]").forEach((el) => el.addEventListener("change", () => active && render()));

    // Fire: the editor's form, checked and fired by the engine from the selected player, on a copy
    // of the arena. Errors show as in a game; the page's own handler ignores the form outside a game.
    $<HTMLFormElement>("shot-form").addEventListener("submit", (e) => {
        if (!active) return;
        e.preventDefault();
        const at = shooter;
        if (!sim || !at) return;
        const a = $<HTMLInputElement>("input-a").value;
        const exprs = parametric() ? [a, $<HTMLInputElement>("input-b").value] : [a];
        clearError();
        const unfilled = sliderError(exprs);
        if (unfilled) return showError(unfilled);
        const cw = clockwise();
        let trial: TrialShot;
        try {
            trial = exprs.length === 1 ? sim.fire_from(at[0], at[1], exprs[0], cw) : sim.fire_param_from(at[0], at[1], exprs[0], exprs[1], cw);
        } catch (err) {
            return showError(String(err));
        }
        const key = lookKey(...at);
        shot = { team: at[0], exprs, cw, points: trial.points };
        shots.set(key, shot);
        const look = lookAfterShot(field, looks.get(key), trial.points);
        if (look) looks.set(key, look);
        hits = { players: trial.hits.map(([t, i]) => lookKey(t, i)), obstacles: trial.obstacles };
        setLive($("last-shot"), describeTrial(field, at, exprs, cw, trial.hits, trial.obstacles));
        render(true);
    });

    return { redraw: () => active && view && draw(canvas, view) };
}
