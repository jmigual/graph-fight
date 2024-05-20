import * as wasm from "graph-fight";

let game = null;

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');

    window.requestAnimationFrame(draw);
}


function main() {
    game = new wasm.Game(20, 10, 15, 4, 4, 4, .5, BigInt(0));
    window.requestAnimationFrame(draw);
}

main();
