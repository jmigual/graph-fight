import * as wasm from "graph-fight";

let game = null;

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');

    // We clone it because the user might mutate the game state in the draw function
    const tmpGame = game.clone();

    

    window.requestAnimationFrame(draw);
}


function main() {
    game = new wasm.Game(20, 10, 15, 4, 4, 4, .5, BigInt(0));
    window.requestAnimationFrame(draw);
}

main();
