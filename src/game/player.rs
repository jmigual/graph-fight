use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;
use crate::geometry::*;
use crate::utils;


mod style {
    pub mod colour {
        pub const PLAYER: &str = "#F00";
    }
}


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
    
    pub fn draw(&self, canvas: &web_sys::HtmlCanvasElement, helper: &math::CanvasHelper) {
        // For now let's draw red circles

        let ctx = utils::ctx_from_canvas(&canvas);

        ctx.set_fill_style(&JsValue::from_str(style::colour::PLAYER));
        ctx.begin_path();

        let center = helper.map_point(self.shape().pos());
        let r = self.shape().radius();
        let radius = helper.map_point(&math::Point::new(r, r));
        ctx.ellipse(
            center.0,
            center.1,
            radius.0,
            radius.1,
            0.0,
            0.0,
            2.0*std::f64::consts::PI
        ).unwrap();
    }
}



