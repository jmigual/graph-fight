mod utils;

use wasm_bindgen::prelude::*;
use std::vec::Vec;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

struct Point {
    x: f32,
    y: f32
}

struct Player {
    pos: Point,
    radius: f32
}

struct Circle {
    pos: Point,
    radius: f32
}

#[wasm_bindgen]
pub struct GraphFight {
    playerA: Vec<Player>,
    playerB: Vec<Player>,
    obstacles: Vec<Circle>,
    x_range: (f32, f32),
    y_range: (f32, f32)
}

#[wasm_bindgen]
impl GraphFight {
    fn new(x_range: (f32, f32), y_range: (f32, f32), obstacles: u32, obstacle_size: f32) -> GraphFight {
        utils::set_panic_hook();

        if x_range.0 >= x_range.1 {
            panic!("The first value of the x-range tuple should be smaller than the second value");
        }

        if y_range.0 >= y_range.1 {
            panic!("The first value of the y-range tuple should be smaller than the second value");
        }

        let mut playerA = Vec::new();
        let mut playerB = Vec::new();
        let mut obstacles = Vec::new();

        GraphFight {
            playerA,
            playerB,
            obstacles,
            x_range,
            y_range
        }
    }
}

