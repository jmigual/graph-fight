import * as wasm from "graph-fight";

let game = null;

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');

    game?.draw(canvas);
    window.requestAnimationFrame(draw);
}


function main() {
    game = new wasm.Game(20, 10, 2, .2, 4, 4, .5, 0);
    window.requestAnimationFrame(draw);
}

main();
