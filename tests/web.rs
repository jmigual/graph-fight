//! Test suite for the Web and headless browsers.

// #![cfg(target_arch = "wasm32")]

// extern crate wasm_bindgen_test;
// use wasm_bindgen_test::*;
use graph_fight::game::*;

// wasm_bindgen_test_configure!(run_in_browser);

#[test]
fn create() {
    let _game = Game::new(20.0, 10.0, 2, 0.2, 4, 4, 0.05);
}
