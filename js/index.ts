// Only for the types
import type { Game, Arena, Circle, Player } from "../pkg/index.js";
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

        this.xLenToWidth = width / (2*xMax);
        this.yLenToHeight = height / (2*yMax);
    }

    public toCanvasPos(x: number, y: number): [number, number] {
        // Canvas coordinates go from top left to bottom right
        // Arena coordinates go from center to top right

        const x_canvas = (x + this.xMax) * this.xLenToWidth;
        const y_canvas = (this.yMax - y) * this.yLenToHeight;

        return [x_canvas, y_canvas];
    }

    public mapLengthToWidth(x: number): number {
        return x * this.xLenToWidth;
    }
}

const TEAM_COLORS = [
    'red',
    'blue',
    'green',
    'yellow',
    'purple',
    'orange',
    'brown',
    'pink',
    'cyan',
    'magenta',
    'lime',
    'teal',
    'indigo',
    'maroon',
    'navy',
    'olive',
    'grey',
    'black',
    'white',
];

let game = null;
let arenaToCanvasPosMapper = null;
let changed = false;

function main(GF: GraphFight_t) {
    try {
        game = new GF.Game(20, 10, 30, .2, 2, new Uint32Array([4, 4]), .3, 3n);

        let canvas = <HTMLCanvasElement>document.getElementById('arena');
        let arena = game.arena();
        arenaToCanvasPosMapper = new ArenaToCanvasPosMapper(arena.xMax, arena.yMax, canvas.width, canvas.height);
        changed = true;
    } catch (e) {
        console.error("Error creating game:", e);
        return;
    }

    window.requestAnimationFrame(draw);
}

function draw(timestamp: number) {
    if (!changed) {
        window.requestAnimationFrame(draw);
        return;
    }

    let canvas = <HTMLCanvasElement>document.getElementById('arena');
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // We clone it because the user might mutate the game state in the draw function
    const arena = game.arena();
    paintArena(ctx, arena);

    changed = false;
    window.requestAnimationFrame(draw);
}

function paintArena(ctx: CanvasRenderingContext2D, arena: Arena) {
    paintObstacles(ctx, arena.obstacles);

    arena.teams.forEach((team, idx) => {
        paintPlayers(ctx, team.players, TEAM_COLORS[idx % TEAM_COLORS.length]);
    });
}

function paintObstacles(ctx: CanvasRenderingContext2D, obstacles: Array<Circle>) {
    ctx.fillStyle = 'black';
    for (let obstacle of obstacles) {
        let [x, y] = arenaToCanvasPosMapper.toCanvasPos(obstacle.pos.x, obstacle.pos.y);
        let radius = obstacle.radius;

        ctx.beginPath();
        ctx.arc(x, y, arenaToCanvasPosMapper.mapLengthToWidth(radius), 0, 2 * Math.PI);
        ctx.fill();
    }
}

function paintPlayers(ctx: CanvasRenderingContext2D, players: Array<Player>, color: string) {
    ctx.fillStyle = color;
    for (let player of players) {
        const pShape = player.shape;
        let [x, y] = arenaToCanvasPosMapper.toCanvasPos(pShape.pos.x, pShape.pos.y);

        ctx.beginPath();
        ctx.arc(x, y, arenaToCanvasPosMapper.mapLengthToWidth(pShape.radius), 0, 2 * Math.PI);
        ctx.fill();
    }
}
