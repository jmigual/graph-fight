use crate::geometry::*;
use crate::utils;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

pub mod style {
    pub mod colour {
        pub const PLAYER_RIGHT: &str = "#F00";
        pub const PLAYER_LEFT: &str = "#00F";
    }

    pub enum Team {
        Right,
        Left,
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Player {
    shape: Circle,
    alive: bool,
}

#[allow(dead_code)]
impl Player {
    pub fn from_circle(shape: Circle) -> Player {
        Player { shape, alive: true }
    }

    pub fn new(pos: Point, radius: f64) -> Player {
        Player {
            shape: Circle::new(pos, radius),
            alive: true,
        }
    }

    pub fn shape_js(&self) -> Circle {
        self.shape.clone()
    }
}

impl Player {
    pub fn shape(&self) -> &Circle {
        &self.shape
    }
    pub fn draw(
        &self,
        canvas: &web_sys::HtmlCanvasElement,
        helper: &math::CanvasHelper,
        team: style::Team,
    ) {
        // For now let's draw red circles

        let ctx = utils::ctx_from_canvas(&canvas);

        ctx.set_fill_style(&JsValue::from_str(match team {
            style::Team::Right => style::colour::PLAYER_RIGHT,
            style::Team::Left => style::colour::PLAYER_LEFT,
        }));
        ctx.set_stroke_style(&JsValue::from_str("rgba(1, 1, 1, 0)"));
        ctx.begin_path();

        let center = helper.to_canvas_point(self.shape().pos());
        let r = self.shape().radius();
        let radius = helper.to_canvas_vector(&(r, r).into());
        ctx.ellipse(
            center.0,
            center.1,
            radius.0,
            radius.1,
            0.0,
            0.0,
            2.0 * std::f64::consts::PI,
        )
        .unwrap();
        ctx.fill();
    }
}
