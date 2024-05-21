use crate::geometry::*;
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::*;


#[derive(Clone, Serialize,Tsify)]
#[tsify(into_wasm_abi)]
pub struct Player {
    shape: Circle,
    alive: bool,
    formula: String,
}

impl Player {
    pub fn from_circle(shape: Circle) -> Player {
        Player {
            shape,
            alive: true,
            formula: String::new(),
        }
    }

    pub fn new(pos: Point, radius: f64) -> Player {
        Player {
            shape: Circle::new(pos, radius),
            alive: true,
            formula: String::new(),
        }
    }

    pub fn shape_js(&self) -> Circle {
        self.shape.clone()
    }

    pub fn alive(&self) -> bool {
        self.alive
    }

    pub fn formula_js(&self) -> String {
        self.formula.clone()
    }

    pub fn set_formula(&mut self, formula: String) {
        self.formula = formula;
    }
}

impl Player {
    pub fn shape(&self) -> &Circle {
        &self.shape
    }

    pub fn formula(&self) -> &str {
        &self.formula
    }
}
