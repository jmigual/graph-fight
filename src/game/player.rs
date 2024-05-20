use crate::geometry::*;
use crate::utils;
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::*;

pub mod style {
    pub mod colour {
        pub const TEAM_0: &str = "#F00";
        pub const TEAM_1: &str = "#00F";
        pub const TEAM_2: &str = "#0F0";
        pub const TEAM_3: &str = "#f6ff52";
        pub const TEAM_4: &str = "#F0F";
        pub const TEAM_5: &str = "#0FF";
        pub const TEAM_6: &str = "#A4C639";
        pub const TEAM_7: &str = "#ffaf19";
        pub const TEAM_8: &str = "#DFFF00";
        pub const TEAM_9: &str = "#b219ff";

        pub const TEAMS: &[&'static str] = &[
            TEAM_0, TEAM_1, TEAM_2, TEAM_3, TEAM_4, TEAM_5, TEAM_6, TEAM_7, TEAM_8, TEAM_9,
        ];

        pub fn get_team_colour(idx: usize) -> &'static str {
            TEAMS[idx % TEAMS.len()]
        }
    }
}

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
