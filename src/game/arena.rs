use rand::Rng;
use rand_distr::{Distribution, Normal};
use web_sys::HtmlCanvasElement;

use crate::geometry::{
    math::{CanvasHelper, Point},
    Circle, Rectangle,
};

use super::Obstacle;

pub struct Arena {
    area: Rectangle,
    obstacles: Vec<Obstacle>,
}

impl Arena {
    pub fn new(width: f64, height: f64) -> Arena {
        Arena {
            area: Rectangle::new((0.0, 0.0).into(), width, height),
            obstacles: Vec::new(),
        }
    }

    pub fn add_obstacles<R: Rng + ?Sized>(
        &mut self,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        rng: &mut R,
    ) {
        let distr = Normal::new((max_obstacle_size - min_obstacle_size) / 2.0, 0.8).unwrap();
        let x_range = self.area.range_h();
        let y_range = self.area.range_v();

        self.obstacles.reserve(num_obstacles);
        for _ in 0..num_obstacles {
            let obstacle_size = distr.sample(rng).clamp(min_obstacle_size, max_obstacle_size);
            let pos = Point::random(&x_range, &y_range, rng);
            self.obstacles
                .push(Obstacle::from_circle(Circle::new(pos, obstacle_size)));
        }
    }

    pub fn is_inside_bounds(&self, shape: &Circle) -> bool {
        let pos = shape.pos();
        self.area.left() + shape.radius() <= pos.x
            && self.area.right() - shape.radius() >= pos.x
            && self.area.bottom() + shape.radius() <= pos.y
            && self.area.top() - shape.radius() >= pos.y
    }

    pub fn is_inside(&self, p: Point) -> bool {
        self.area.inside(&p)
    }

    pub fn is_free_pos(&self, shape: &Circle) -> bool {
        let f = |p: &Obstacle| !p.shape().collision_circle(shape);

        // Collision with obstacles
        if !self.obstacles.iter().all(f) {
            return false;
        }

        self.is_inside_bounds(&shape)
    }

    pub fn area(&self) -> &Rectangle {
        &self.area
    }

    pub fn draw(&self, canvas: &HtmlCanvasElement, helper: &CanvasHelper) {
        for obstacle in &self.obstacles {
            obstacle.draw(&canvas, &helper);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_valid_pos() {
        let arena = Arena::new(20.0, 20.0);

        let pos = vec![
            ((0.0, 0.0), true),
            ((5.0, 5.0), true),
            ((-5.0, 5.0), true),
            ((-5.0, -5.0), true),
            ((5.0, -5.0), true),
            ((20.0, 20.0), false),
            ((-20.0, 20.0), false),
            ((-20.0, -20.0), false),
            ((20.0, -20.0), false),
            ((7.0, 0.0), false),
            ((7.0, 7.0), false),
        ];

        for (p, r) in pos {
            let c = Circle::new(p.into(), 4.0);
            assert_eq!(arena.is_free_pos(&c), r);
        }
    }
}
