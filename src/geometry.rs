pub mod math;

pub use self::math::*;
use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;


#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Circle {
    pos: Point,
    radius: f64,
}

#[wasm_bindgen]
impl Circle {
    #[wasm_bindgen(constructor)]
    pub fn new(pos: Point, radius: f64) -> Circle {
        Circle { pos, radius }
    }

    #[wasm_bindgen(js_name = pos)]
    pub fn pos_js(&self) -> Point {
        self.pos.clone()
    }

    pub fn radius(&self) -> f64 {
        self.radius
    }
}

impl Circle {
    pub fn pos(&self) -> &Point {
        &self.pos
    }
    
    pub fn collision(&self, other: &Circle) -> bool {
        self.pos.distance_to(&other.pos) <= self.radius + other.radius
    }
}


#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Obstacle {
    shape: Circle,
    holes: Vec<Circle>,
}

#[wasm_bindgen]
#[allow(dead_code)]
impl Obstacle {
    
    #[wasm_bindgen(constructor)]
    pub fn new(pos: Point, radius: f64) -> Obstacle {
        Obstacle {
            shape: Circle::new(pos, radius),
            holes: Vec::new(),
        }
    }

    #[wasm_bindgen(js_name = shape)]
    pub fn shape_js(&self) -> Circle {
        self.shape.clone()
    }
}

impl Obstacle {
    pub fn shape(&self) -> &Circle {
        &self.shape
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collision_no() {
        let a = Circle::new(Point::new(0.0, 0.0), 5.0);
        let b = Circle::new(Point::new(10.0, 10.0), 5.0);

        assert_eq!(a.collision(&b), false);
    }

    #[test]
    fn test_collision_yes() {
        let a = Circle::new(Point::new(0.0, 0.0), 5.0);
        let b = Circle::new(Point::new(5.0, 0.0), 5.0);

        assert_eq!(a.collision(&b), true);
    }
}