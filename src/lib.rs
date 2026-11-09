// tsify 0.5 deprecates `into_wasm_abi` (it leaks on a failed conversion); every type using it only
// serializes, which cannot fail, and `Ts<T>` would change the signatures the Rust tests call.
#![allow(deprecated)]

pub mod formula;
pub mod game;
pub mod geometry;
mod utils;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
