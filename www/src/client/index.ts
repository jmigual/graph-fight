import * as wasm from "graph-fight";

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement> document.getElementById('arena');

    // game.draw(canvas);
    window.requestAnimationFrame(draw);
}

try {
    let game = new wasm.Game(20, 10, 2, .2, 4, 4, .05);
} catch (e) {
    console.error("Error when creating game:", e);
}
window.requestAnimationFrame(draw);
