import { Game } from "graph-fight";

let game = null;

function draw(timestamp: number) {
    let canvas = <HTMLCanvasElement>document.getElementById('arena');

    // We clone it because the user might mutate the game state in the draw function
    const tmpGame = game.clone();

    

    window.requestAnimationFrame(draw);
}


function main() {
    game = new Game(20, 10, 30, .2, 2, new Uint32Array([4, 4, 4, 4]), .5, 1);
    game.init();
    window.requestAnimationFrame(draw);
}

main();
