use crate::geometry::*;
use crate::utils;
use wasm_bindgen::prelude::*;

pub mod style {
    pub mod colour {
        pub const OBSTACLE: &str = "#000";
    }
}

#[derive(Clone)]
pub struct Obstacle {
    shape: Circle,
    holes: Vec<Circle>,
}

impl Obstacle {
    pub fn from_circle(circle: Circle) -> Obstacle {
        Obstacle {
            shape: circle,
            holes: Vec::new(),
        }
    }
    pub fn shape(&self) -> &Circle {
        &self.shape
    }

    pub fn draw(&self, canvas: &web_sys::HtmlCanvasElement, helper: &math::CanvasHelper) {
        let ctx = utils::ctx_from_canvas(&canvas);
        ctx.set_fill_style(&JsValue::from_str(style::colour::OBSTACLE));

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

        for hole in &self.holes {
            let center = helper.to_canvas_point(hole.pos());
            let r = hole.radius();
            let radius = helper.to_canvas_vector(&(r, r).into());
            ctx.ellipse_with_anticlockwise(
                center.0,
                center.1,
                radius.0,
                radius.1,
                0.0,
                0.0,
                2.0 * std::f64::consts::PI,
                false,
            )
            .unwrap();
        }
        ctx.fill();
    }
}
