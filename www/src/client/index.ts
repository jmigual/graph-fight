import * as wasm from "graph-fight";

let game = new wasm.Game(20, 10, 2, .2, 4, 4, .05);
window.requestAnimationFrame(draw);

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement> document.getElementById('arena');

    game.draw(canvas);
    window.requestAnimationFrame(draw);
}
