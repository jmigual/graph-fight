use crate::geometry::*;
use crate::utils;
use wasm_bindgen::prelude::*;

pub mod style {
    pub mod colour {
        pub const TEAM_0: &str = "#F00";
        pub const TEAM_1: &str = "#00F";
        pub const TEAM_2: &str = "#0F0";
        pub const TEAM_3: &str = "#FF0";
        pub const TEAM_4: &str = "#F0F";
        pub const TEAM_5: &str = "#0FF";
        pub const TEAM_6: &str = "#4287f5";
        pub const TEAM_7: &str = "#f542c5";
        pub const TEAM_8: &str = "#ffaf19";
        pub const TEAM_9: &str = "#b219ff";

        pub const TEAMS: &[&'static str] = &[
            TEAM_0, TEAM_1, TEAM_2, TEAM_3, TEAM_4, TEAM_5, TEAM_6, TEAM_7, TEAM_8, TEAM_9,
        ];

        pub fn get_team_colour(idx: usize) -> &'static str {
            TEAMS[idx % TEAMS.len()]
        }
    }
}

#[derive(Clone)]
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
        team: usize,
    ) {
        // For now let's draw red circles

        let ctx = utils::ctx_from_canvas(&canvas);

        ctx.set_fill_style(&JsValue::from_str(style::colour::get_team_colour(team)));
        ctx.set_stroke_style(&JsValue::from_str("rgba(1, 1, 1, 0)"));
        ctx.begin_path();

        let center = helper.to_canvas_point(self.shape.pos());
        let r = self.shape.radius();
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
