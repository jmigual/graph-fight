use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;
use crate::geometry::*;


#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Player {
    shape: Circle,
    alive: bool,
}

#[wasm_bindgen]
#[allow(dead_code)]
impl Player {
    pub fn from_circle(shape: Circle) -> Player {
        Player { shape, alive: true }
    }

    #[wasm_bindgen(constructor)]
    pub fn new(pos: Point, radius: f64) -> Player {
        Player {
            shape: Circle::new(pos, radius),
            alive: true,
        }
    }

    #[wasm_bindgen(js_name = shape)]
    pub fn shape_js(&self) -> Circle {
        self.shape.clone()
    }

}

#[allow(dead_code)]
impl Player {

    pub fn shape(&self) -> &Circle {
        &self.shape
    }
    
}



