// Only for the types
import type { Game, Arena } from "../pkg/index.js";
type GraphFight_t = typeof import("../pkg/index.js");

(async () => {
    try {
        main(await import("../pkg/index.js"));
    } catch (e) {
        console.error("Error importing `index.ts`:", e);
    }
})();

class ArenaToCanvasPosMapper {
    private xMax: number;
    private yMax: number;

    private width: number;
    private height: number;

    private xLenToWidth: number;
    private yLenToHeight: number;

    constructor(xMax: number, yMax: number, width: number, height: number) {
        this.xMax = xMax;
        this.yMax = yMax;

        this.width = width;
        this.height = height;

        this.xLenToWidth = width / xMax;
        this.yLenToHeight = height / yMax;
    }

    public toCanvasPos(x: number, y: number): [number, number] {
        // Canvas coordinates go from top left to bottom right
        // Arena coordinates go from center to top right

        const x_canvas = (x + this.xMax) * this.xLenToWidth;
        const y_canvas = (this.yMax - y) * this.yLenToHeight;

        console.debug(`(${x}, ${y}) -> (${x_canvas}, ${y_canvas})`);
        return [x_canvas, y_canvas];
    }
}

let game = null;
let arenaToCanvasPosMapper = null;

function main(GF: GraphFight_t) {
    try {
        game = new GF.Game(20, 10, 30, .2, 2, new Uint32Array([4, 4]), .5, 1n);

        let canvas = <HTMLCanvasElement>document.getElementById('arena');
        let arena = game.arena();
        arenaToCanvasPosMapper = new ArenaToCanvasPosMapper(arena.xMax(), arena.yMax(), canvas.width, canvas.height);
    } catch (e) {
        console.error("Error creating game:", e);
        return;
    }

    window.requestAnimationFrame(draw);
}

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // We clone it because the user might mutate the game state in the draw function
    const tmpGame = game.clone();



    window.requestAnimationFrame(draw);
}

function paint_arena(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, arena: Arena) {

}

