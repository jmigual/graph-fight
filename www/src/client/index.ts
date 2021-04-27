import { Game } from "graph-fight";

let game = null;

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');

    game?.draw(canvas);
    window.requestAnimationFrame(draw);
}


function main() {
    game = new Game(20, 10, 30, .2, 2, new Float64Array([4, 4, 4, 4]), .5, 0);
    window.requestAnimationFrame(draw);
}

main();
