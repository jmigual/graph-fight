pub mod math;

use self::math::*;

pub struct Circle {
    pos: Point,
    radius: f64,
}

impl Circle {
    pub fn new(pos: Point, radius: f64) -> Circle {
        Circle { pos, radius }
    }

    pub fn pos(&self) -> &Point {
        &self.pos
    }
    
    pub fn collision(&self, other: &Circle) -> bool {
        self.pos.distance_to(&other.pos) <= self.radius + other.radius
    }
}


