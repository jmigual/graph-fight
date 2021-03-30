use std::cmp::PartialOrd;
use std::ops::Add;

pub struct Point {
    x: f64,
    y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    pub fn random(x_range: &Range<f64>, y_range: &Range<f64>) -> Point {
        let x = rand::random::<f64>() * (x_range.max() - x_range.min());
        let y = rand::random::<f64>() * (y_range.max() - y_range.min());

        Point { x, y }
    }
}

impl Add for Point {
    type Output = Self;

    fn add(self, rhs: Point) -> Self {
        Point {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

pub struct Circle {
    pos: Point,
    radius: f32,
}

pub struct Range<T: PartialOrd> {
    min: T,
    max: T,
}

impl<T: PartialOrd + Copy> Range<T> {
    pub fn new(min: T, max: T) -> Range<T> {
        if min > max {
            panic!("min must be smaller or equal than max");
        }

        Range { min, max }
    }

    pub fn min(&self) -> T {
        self.min
    }

    pub fn max(&self) -> T {
        self.max
    }
}
