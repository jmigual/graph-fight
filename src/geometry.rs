pub mod math;

pub use self::math::*;
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Circle {
    pos: Point,
    radius: f64,
}

impl Circle {
    pub fn radius(&self) -> f64 {
        self.radius
    }

    pub fn new(pos: Point, radius: f64) -> Circle {
        assert!(radius > 0.0, "A circle must have a positive radius");
        Circle { pos, radius }
    }

    pub fn pos(&self) -> &Point {
        &self.pos
    }

    pub fn collision_circle(&self, other: &Circle) -> bool {
        self.pos.distance_to(&other.pos) <= self.radius + other.radius
    }

    pub fn collision_rec(&self, other: &Rectangle) -> bool {
        let x_pos = if self.pos.x <= other.left() {
            other.left()
        } else if self.pos.x >= other.right() {
            other.right()
        } else {
            self.pos.x
        };

        let y_pos = if self.pos.y <= other.bottom() {
            other.bottom()
        } else if self.pos.y >= other.top() {
            other.top()
        } else {
            self.pos.y
        };

        self.pos.distance_to(&(x_pos, y_pos).into()) <= self.radius
    }
}

#[derive(Clone, Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Rectangle {
    pos: Point,
    width: f64,
    height: f64,
}


impl Rectangle {
    pub fn new(pos: Point, width: f64, height: f64) -> Rectangle {
        Rectangle { pos, width, height }
    }

    pub fn pos_s(&self) -> Point {
        self.pos.clone()
    }

    pub fn width(&self) -> f64 {
        self.width
    }

    pub fn height(&self) -> f64 {
        self.height
    }

    pub fn left(&self) -> f64 {
        self.pos.x - self.width / 2.0
    }

    pub fn right(&self) -> f64 {
        self.pos.x + self.width / 2.0
    }

    pub fn top(&self) -> f64 {
        self.pos.y + self.height / 2.0
    }

    pub fn bottom(&self) -> f64 {
        self.pos.y - self.height / 2.0
    }
}

impl Rectangle {
    pub fn pos(&self) -> &Point {
        &self.pos
    }

    pub fn range_h(&self) -> Range {
        Range::new(self.left(), self.right())
    }

    pub fn range_v(&self) -> Range {
        Range::new(self.bottom(), self.top())
    }

    /// Partition the rectangle in n rectangles with similar area
    pub fn partition(&self, n: u64) -> Vec<Rectangle> {
        match n {
            1 => vec![self.clone()],
            2..=u64::MAX => {
                let recs = if self.width > self.height {
                    let n_width = Point::new(self.width / 4.0, 0.0);
                    (
                        Rectangle::new(&self.pos - &n_width, self.width / 2.0, self.height),
                        Rectangle::new(&self.pos + &n_width, self.width / 2.0, self.height),
                    )
                } else {
                    let n_heigh = Point::new(0.0, self.height / 4.0);
                    (
                        Rectangle::new(&self.pos - &n_heigh, self.width, self.height / 2.0),
                        Rectangle::new(&self.pos + &n_heigh, self.width, self.height / 2.0),
                    )
                };

                let mut all_recs = if n % 2 == 0 {
                    (recs.0.partition(n / 2), recs.1.partition(n / 2))
                } else {
                    (recs.0.partition(n / 2 + 1), recs.1.partition(n / 2))
                };

                all_recs.0.append(&mut all_recs.1);
                all_recs.0
            }
            0 => panic!("The minimum of squares is 1"),
        }
    }

    pub fn collision_rec(&self, other: &Rectangle) -> bool {
        self.right() >= other.left()
            && self.left() <= other.right()
            && self.top() >= other.bottom()
            && self.bottom() <= other.top()
    }

    pub fn collision_circle(&self, other: &Circle) -> bool {
        other.collision_rec(&self)
    }

    pub fn inside(&self, pos: &Point) -> bool {
        self.left() <= pos.x
            && pos.x <= self.right()
            && self.bottom() <= pos.y
            && pos.y <= self.top()
    }

    pub fn circle_inside(&self, c: &Circle) -> bool {
        let pos = c.pos();
        self.left() + c.radius() <= pos.x
            && self.right() - c.radius() >= pos.x
            && self.bottom() + c.radius() <= pos.y
            && self.top() - c.radius() >= pos.y
    }
}

#[cfg(test)]
mod tests {
    use float_cmp::approx_eq;

    use super::*;

    #[test]
    fn test_collision_no() {
        let a = Circle::new(Point::new(0.0, 0.0), 5.0);
        let b = Circle::new(Point::new(10.0, 10.0), 5.0);

        assert_eq!(a.collision_circle(&b), false);
    }

    #[test]
    fn test_collision_yes() {
        let a = Circle::new(Point::new(0.0, 0.0), 5.0);
        let b = Circle::new(Point::new(5.0, 0.0), 5.0);

        assert_eq!(a.collision_circle(&b), true);
    }

    #[test]
    fn test_collision_rec_yes() {
        let a = Rectangle::new((0.0, 0.0).into(), 10.0, 10.0);

        let pos = vec![
            (5.0, 5.0),   // top right
            (-5.0, 5.0),  // top left
            (-5.0, -5.0), // bottom left
            (5.0, -5.0),  // bottom right
        ];

        for t in pos {
            let b = Rectangle::new(t.into(), 10.0, 10.0);
            assert_eq!(a.collision_rec(&b), true);
            assert_eq!(b.collision_rec(&a), true);
        }
    }

    #[test]
    fn test_collision_rec_no() {
        let a = Rectangle::new((0.0, 0.0).into(), 10.0, 10.0);

        let pos = vec![
            (10.0, 10.0),   // top right
            (-10.0, 10.0),  // top left
            (-10.0, -10.0), // bottom left
            (10.0, -10.0),  // bottom right
        ];

        for t in pos {
            let b = Rectangle::new(t.into(), 5.0, 5.0);
            assert_eq!(a.collision_rec(&b), false);
            assert_eq!(b.collision_rec(&a), false);
        }
    }

    #[test]
    fn test_collision_rec_circ_yes() {
        let a = Rectangle::new((0.0, 0.0).into(), 10.0, 10.0);

        let pos = vec![
            (0.0, 0.0),   // Circle inside
            (5.0, 0.0),   // Circle centre right
            (5.0, 5.0),   // Circle top right
            (0.0, 5.0),   // Circle top centre
            (-5.0, 5.0),  // Circle top left
            (-5.0, 0.0),  // Circle centre left
            (-5.0, -5.0), // Circle bottom left
            (0.0, -5.0),  // Circle bottom centre
            (5.0, -5.0),  // Circle bottom right
        ];

        for t in pos {
            let b = Circle::new(t.into(), 4.0);
            assert_eq!(a.collision_circle(&b), true);
            assert_eq!(b.collision_rec(&a), true);
        }
    }

    #[test]
    fn test_collision_rec_circ_no() {
        let a = Rectangle::new((0.0, 0.0).into(), 2.0, 2.0);

        let pos = vec![
            (5.0, 0.0),   // Circle centre right
            (5.0, 5.0),   // Circle top right
            (0.0, 5.0),   // Circle top centre
            (-5.0, 5.0),  // Circle top left
            (-5.0, 0.0),  // Circle centre left
            (-5.0, -5.0), // Circle bottom left
            (0.0, -5.0),  // Circle bottom centre
            (5.0, -5.0),  // Circle bottom right
        ];

        for t in pos {
            let b = Circle::new(t.into(), 2.0);
            assert_eq!(a.collision_circle(&b), false);
            assert_eq!(b.collision_rec(&a), false);
        }
    }

    #[test]
    fn test_inside_rectangle() {
        let a = Rectangle::new((0.0, 0.0).into(), 10.0, 10.0);

        let pos = vec![
            ((0.0, 0.0), true),
            ((4.0, 4.0), true),
            ((-4.0, 4.0), true),
            ((-4.0, -4.0), true),
            ((4.0, -4.0), true),
            ((10.0, 10.0), false),
            ((-10.0, 10.0), false),
            ((-10.0, -10.0), false),
            ((10.0, -10.0), false),
        ];

        for (p, r) in pos {
            let b: Point = p.into();
            assert_eq!(a.inside(&b), r);
        }
    }

    #[test]
    fn test_valid_pos() {
        let area = Rectangle::new((0.0, 0.0).into(), 20.0, 20.0);

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
            assert_eq!(area.circle_inside(&c), r);
        }
    }

    #[test]
    fn test_partition() {
        let a = Rectangle::new((0.0, 0.0).into(), 10.0, 10.0);

        let parts = a.partition(4);
        let expect = vec![(-2.5, -2.5), (2.5, -2.5), (-2.5, 2.5), (2.5, 2.5)];

        for (p, e) in parts.iter().zip(expect.iter()) {
            let result = approx_eq!(f64, p.pos.x, e.0) && approx_eq!(f64, p.pos.y, e.1);
            assert!(
                result,
                "Expected values are not equal, expected: {:?}, got: {:?}",
                e, p.pos
            );
            let result = approx_eq!(f64, p.width, 5.0) && approx_eq!(f64, p.height, 5.0);
            assert!(
                result,
                "Expected values are not equal, expected: {:?}, got: {:?}",
                (5.0, 5.0),
                (p.width, p.height)
            );
        }
    }
}
